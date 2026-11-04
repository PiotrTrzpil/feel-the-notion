import { App, Notice, TFile, TFolder, normalizePath } from "obsidian";
import { EditorView } from "@codemirror/view";
import { Text } from "@codemirror/state";
import { dispatchBlockEdit } from "./history";
import { appendBlock, findLinks, NoteLink, planCut, rewriteLinks } from "./fileDrop";
import type { MoveSource } from "./planMove";
import { t } from "./locale/helpers";

/** An attachment that goes with the block, and where it is going. */
interface AttachmentMove {
	file: TFile;
	to: string;
}

/**
 * Moves a dragged block from the note open in `view` to the end of `target`,
 * taking its attachments along.
 *
 * An image or file the block embeds or links moves into the folder Obsidian
 * would save a new attachment for `target` in (Settings → Files and links →
 * Default location for new attachments). Only attachments nothing else uses
 * move: one linked from another note, or from elsewhere in the source note,
 * stays put, and the moved block keeps a link to it.
 *
 * Order matters for losing nothing:
 *   1. attachments move, without Obsidian's link updater (the source copy of
 *      the block is about to be cut, and nothing else links them);
 *   2. the block, its links pointing at the new paths, is appended to target;
 *   3. the block is cut from the source, only if that note did not change in
 *      the meantime, since the captured offsets would then cut the wrong text.
 */
export async function moveBlockToNote(
	app: App,
	view: EditorView,
	source: MoveSource,
	doc: Text,
	sourceFile: TFile,
	target: TFile
): Promise<void> {
	const fail = (error: unknown) => {
		console.error("feel-the-notion: moving block to note failed", error);
		new Notice(t("notice.moveToNoteFailed").replace("{name}", target.basename));
	};

	// Resolved before anything moves: afterwards the old paths name nothing.
	const links = findLinks(source.text);
	const linked = new Map(links.map((link) => [link, resolve(app, link, sourceFile)]));
	let moved: Set<TFile>;
	try {
		const moves = await planAttachmentMoves(app, [...linked.values()], doc, source, sourceFile, target);
		for (const move of moves) {
			await ensureFolder(app, parentPath(move.to));
			await app.vault.rename(move.file, move.to);
		}
		moved = new Set(moves.map((m) => m.file));
	} catch (error) {
		fail(error);
		return;
	}

	// A renamed TFile is the same object, now reporting its new path.
	const text = rewriteLinks(source.text, links, (link) => {
		const file = linked.get(link);
		if (!file || !moved.has(file)) return null;
		const alias = link.alias === file.basename || link.alias === file.name ? "" : link.alias;
		return (link.embed ? "!" : "") + app.fileManager.generateMarkdownLink(file, target.path, link.subpath, alias);
	});

	try {
		await app.vault.process(target, (content) => appendBlock(content, text, source.indent));
	} catch (error) {
		fail(error);
		return;
	}

	if (!view.dom.isConnected || view.state.doc !== doc) {
		new Notice(t("notice.copiedToNote").replace("{name}", target.basename));
		return;
	}
	dispatchBlockEdit(view, { changes: planCut(doc, source), userEvent: "delete.block" });
	new Notice(t("notice.movedToNote").replace("{name}", target.basename));
}

/** The attachments only this block uses, each with its new path near `target`. */
async function planAttachmentMoves(
	app: App,
	linked: (TFile | null)[],
	doc: Text,
	source: MoveSource,
	sourceFile: TFile,
	target: TFile
): Promise<AttachmentMove[]> {
	const inBlock = new Set(linked.filter((file): file is TFile => file !== null && file.extension !== "md"));
	if (inBlock.size === 0) return [];

	// What the source note still links once the block is gone. Parsed from
	// the text rather than read from the metadata cache, which lags behind
	// edits made moments before the drag.
	const rest = doc.sliceString(0, source.from) + doc.sliceString(source.to);
	const stillUsed = new Set(findLinks(rest).map((link) => resolve(app, link, sourceFile)));

	const moves: AttachmentMove[] = [];
	for (const file of inBlock) {
		if (stillUsed.has(file) || linkedFromOtherNotes(app, file, sourceFile)) continue;
		const to = normalizePath(await app.fileManager.getAvailablePathForAttachment(file.name, target.path));
		if (parentPath(to) === folderPath(file.parent)) continue;
		moves.push({ file, to });
	}
	return moves;
}

function resolve(app: App, link: NoteLink, from: TFile): TFile | null {
	return app.metadataCache.getFirstLinkpathDest(link.path, from.path);
}

function linkedFromOtherNotes(app: App, file: TFile, sourceFile: TFile): boolean {
	return Object.entries(app.metadataCache.resolvedLinks).some(
		([note, targets]) => note !== sourceFile.path && (targets[file.path] ?? 0) > 0
	);
}

/** The vault root's path is "/", but `parentPath` gives "" for a root file. */
function folderPath(folder: TFolder | null): string {
	return !folder || folder.path === "/" ? "" : folder.path;
}

function parentPath(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? "" : path.slice(0, slash);
}

/** Creates `path` and any missing parents; the vault root needs nothing. */
async function ensureFolder(app: App, path: string): Promise<void> {
	if (path === "" || app.vault.getAbstractFileByPath(path)) return;
	await ensureFolder(app, parentPath(path));
	await app.vault.createFolder(path);
}
