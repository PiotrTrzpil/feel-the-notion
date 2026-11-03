import { EditorView } from "@codemirror/view";
import { Editor, FileSystemAdapter, MarkdownFileInfo, MarkdownView, Notice, TFile, TFolder, editorInfoField } from "obsidian";
import type NotionBlock from "./main";
import { toMarkdownLink } from "./attachmentLink";
import { availableNotePath, isImageFile, saveAttachment } from "./blockTransform";
import { joinPath, parentPath } from "./folderNotes";
import { subPageFolder } from "./folderNoteView";
import { dispatchBlockEdit } from "./history";
import { t } from "./locale/helpers";
import {
	attachUriPaths,
	filePathsFromUriList,
	isDirectorySelfDrop,
	isMarkdownDrop,
	isMarkdownFileName,
	normalizeNoteText,
	noteNameFromFile,
	planDirectoryDrop,
	planNoteDrop,
	vaultRelativePath,
	type DropTreeEntry,
} from "./noteDrop";

/**
 * Dropping files onto a note.
 *
 * Obsidian already saves a dropped image and embeds it at the pointer. A
 * dropped markdown file is handled here instead, and only while folder notes
 * are on: the current note becomes a folder note if it is not one yet, the
 * file is copied into that folder, and a link is written where it was dropped.
 * A folder from the desktop is the same, for the whole tree: it is copied in
 * as a subfolder, made into a folder note (its own `<name>.md` when it has
 * one, otherwise an empty note), and linked where it was dropped. A file or
 * folder that is already in the vault is moved rather than copied, so the drop
 * does not leave a second copy behind.
 *
 * Any other file in the same drop is saved the way an inserted attachment is.
 * Taking the drop over at all means the core handler will not see those files,
 * so they have to be saved here too.
 *
 * The claim has to happen on the drop event itself, in the capture phase.
 * Obsidian imports a Finder drop from CodeMirror's drop handler, and that
 * handler bails only when the event is already cancelled. `editor-drop` is
 * fired from inside the handler, so it is the fallback for a drag whose files
 * were not readable yet during capture — not the thing that stops the import.
 * A markdown file that slips through is saved under the attachment folder and
 * inserted as an embed (`![[…]]`).
 */

interface DroppedFile {
	/** File name, extension included when the desktop gave one. */
	name: string;
	file: File | null;
	/** Absolute path, when the desktop told us one. Null in a browser drag. */
	fsPath: string | null;
	/** MIME type from the drag item or File, when given. */
	mime: string | null;
	/** A Finder folder. Its contents are copied, and it is linked as one page. */
	isDirectory: boolean;
}

/** Drops this plugin has already taken, so the fallback cannot insert twice. */
const claimedDrops = new WeakSet<Event>();

export function registerNoteDrop(plugin: NotionBlock): void {
	const watch = (win: Window) => {
		plugin.registerDomEvent(win, "drop", (evt) => onCaptureDrop(plugin, evt), { capture: true });
	};
	watch(window);
	plugin.registerEvent(plugin.app.workspace.on("window-open", (_opened, win) => watch(win)));
	plugin.registerEvent(
		plugin.app.workspace.on("editor-drop", (evt, editor, info) => onEditorDrop(plugin, evt, editor, info))
	);
}

/**
 * A markdown drop on an editor, taken before CodeMirror's drop handler runs.
 *
 * `preventDefault` is the whole claim: that handler bails when the event is
 * already cancelled, which is what stops the attachment embed. The event is
 * left to propagate so the editor can clear its drop cursor. Propagation is
 * not stopped — the import itself checks `defaultPrevented` and does nothing.
 */
function onCaptureDrop(plugin: NotionBlock, evt: DragEvent): void {
	if (claimedDrops.has(evt) || evt.defaultPrevented) return;
	if (!plugin.settings.enabled || !plugin.settings.folderNotes) return;
	if (isInternalDrag(plugin)) return;
	const target = markdownDropTarget(plugin, evt);
	if (!target) return;
	acceptDrop(plugin, evt, target.editor, target.note);
}

/** Same claim, for a drop whose files were not visible yet during capture. */
function onEditorDrop(
	plugin: NotionBlock,
	evt: DragEvent,
	editor: Editor,
	info: MarkdownView | MarkdownFileInfo
): void {
	if (isInternalDrag(plugin)) return;
	const note = info.file;
	if (!note) return;
	acceptDrop(plugin, evt, editor, note);
}

function acceptDrop(plugin: NotionBlock, evt: DragEvent, editor: Editor, note: TFile): void {
	if (claimedDrops.has(evt) || evt.defaultPrevented) return;
	if (!plugin.settings.enabled || !plugin.settings.folderNotes) return;
	if (note.extension !== "md") return;

	const dropped = droppedFiles(evt);
	if (!dropped.some(isPageDrop)) return;

	// Before any position lookup. A throw after this still leaves the drop
	// cancelled, so Obsidian cannot fall through to the attachment embed.
	claimedDrops.add(evt);
	evt.preventDefault();

	try {
		const snapshot = editor.getValue();
		const fromTo = dropOffsets(editor, evt);
		void placeDropped(plugin, editor, note, dropped, snapshot, fromTo.from, fromTo.to);
	} catch (error) {
		console.error("feel-the-notion: drop position failed", error);
		new Notice(t("notice.dropNoteFailed"));
	}
}

async function placeDropped(
	plugin: NotionBlock,
	editor: Editor,
	note: TFile,
	dropped: DroppedFile[],
	snapshot: string,
	from: number,
	to: number
): Promise<void> {
	try {
		// Resolve in-vault notes before subPageFolder: turning a plain note
		// into a folder note moves it, so a self-drop has to be recognised
		// while the note is still at its original path.
		const sourceBefore = note.path;
		const prepared = dropped.map((item) => {
			const markdown = !item.isDirectory && isMarkdownDrop(item.name, item.fsPath, item.mime);
			const existing = markdown ? vaultMarkdown(plugin, item.fsPath) : null;
			const vaultDir = item.isDirectory ? vaultFolderPath(plugin, item.fsPath) : null;
			const self = existing?.path === sourceBefore || (vaultDir !== null && isDirectorySelfDrop(sourceBefore, vaultDir));
			return { item, markdown, existing, vaultDir, self };
		});

		const actionable = prepared.filter((entry) => !entry.self);
		let skippedSelf = prepared.length - actionable.length;
		if (actionable.length === 0) {
			if (skippedSelf > 0) new Notice(t("notice.dropOntoSelf"));
			return;
		}

		// Before any link is generated: the move changes the note's path, and
		// the link has to be written from where the note ends up.
		const folder = await subPageFolder(plugin, note);
		const sourcePath = note.path;
		const dest = folder ?? note.parent?.path ?? "";

		const links: string[] = [];
		let failed = 0;
		for (const { item, markdown, existing, vaultDir } of actionable) {
			try {
				const link = item.isDirectory
					? await placeDirectory(plugin, dest, sourcePath, sourceBefore, item, vaultDir)
					: markdown
						? await placeMarkdown(plugin, note, dest, sourcePath, item, existing)
						: await placeAttachment(plugin, sourcePath, item);
				if (link === null) skippedSelf++;
				else links.push(link);
			} catch (error) {
				failed++;
				console.error(`feel-the-notion: dropping ${item.name} failed`, error);
			}
		}

		if (links.length > 0) insertDrop(editor, snapshot, from, to, links);
		if (failed > 0) new Notice(t("notice.dropNoteFailed"));
		else if (links.length === 0 && skippedSelf > 0) new Notice(t("notice.dropOntoSelf"));
	} catch (error) {
		console.error("feel-the-notion: dropping a page failed", error);
		new Notice(t("notice.dropNoteFailed"));
	}
}

/**
 * The dropped markdown file as a page under `dest`, and the link to write.
 *
 * Null when the file is the note it was dropped on: a page cannot become a
 * sub-page of itself. A note already in the vault moves into `dest`. Anything
 * else is copied, which is what a file from outside the vault has to be.
 */
async function placeMarkdown(
	plugin: NotionBlock,
	note: TFile,
	dest: string,
	sourcePath: string,
	item: DroppedFile,
	resolvedExisting?: TFile | null
): Promise<string | null> {
	const { fileManager } = plugin.app;
	const existing = resolvedExisting !== undefined ? resolvedExisting : vaultMarkdown(plugin, item.fsPath);
	if (existing) {
		if (existing.path === note.path) return null;
		if (parentPath(existing.path) !== dest) {
			const name = noteNameFromFile(existing.name) || t("page.untitled");
			await fileManager.renameFile(existing, availableNotePath(plugin, dest, name));
		}
		return pageLink(plugin, existing, sourcePath);
	}

	const name = noteNameFromFile(item.fsPath ?? item.name) || noteNameFromFile(item.name) || t("page.untitled");
	const created = await plugin.app.vault.create(
		availableNotePath(plugin, dest, name),
		normalizeNoteText(await droppedText(item))
	);
	return pageLink(plugin, created, sourcePath);
}

/**
 * The dropped folder as a sub-page of `dest`, and the link to write.
 *
 * Null when the folder is the page it was dropped on. A folder already in
 * the vault is moved under `dest`. Anything else is copied file by file.
 * The folder becomes a folder note: an existing `<name>.md` at its top is
 * that note, and a folder without one gets an empty note so the link opens.
 */
async function placeDirectory(
	plugin: NotionBlock,
	dest: string,
	sourcePath: string,
	sourceBefore: string,
	item: DroppedFile,
	vaultDir: string | null
): Promise<string | null> {
	const fsPath = item.fsPath;
	if (!fsPath) throw new Error("dropped folder has no path");
	const entries = await readDropTree(fsPath);
	const plan = planDirectoryDrop({
		parent: dest,
		dirName: item.name || fsPath,
		entries,
		fallbackName: t("page.untitled"),
		exists: (path) => plugin.app.vault.getAbstractFileByPath(path) != null,
		sourceNotePath: sourceBefore,
		vaultDir,
	});
	if ("skip" in plan) return null;

	if (plan.moveFrom !== null) await moveDroppedFolder(plugin, plan.moveFrom, plan.folder, plan.noteSource, plan.notePath);
	else await copyDroppedFolder(plugin, fsPath, plan.directories, plan.copies, plan.noteSource, plan.notePath);

	const created = plugin.app.vault.getAbstractFileByPath(plan.notePath);
	if (!(created instanceof TFile)) throw new Error("folder note was not created");
	return pageLink(plugin, created, sourcePath);
}

/** Move a vault folder into place, then make sure its folder note has the folder's name. */
async function moveDroppedFolder(
	plugin: NotionBlock,
	moveFrom: string,
	folder: string,
	noteSource: string | null,
	notePath: string
): Promise<void> {
	const { fileManager, vault } = plugin.app;
	if (moveFrom !== folder) {
		const existing = vault.getAbstractFileByPath(moveFrom);
		if (!(existing instanceof TFolder)) throw new Error("dropped folder is not in the vault");
		await fileManager.renameFile(existing, folder);
	}
	if (noteSource) {
		const current = joinPath(folder, noteSource);
		if (current === notePath) return;
		const file = vault.getAbstractFileByPath(current);
		if (file instanceof TFile) {
			await fileManager.renameFile(file, notePath);
			return;
		}
	}
	if (!vault.getAbstractFileByPath(notePath)) await vault.create(notePath, "");
}

/** Copy an outside folder in, then write its folder note. */
async function copyDroppedFolder(
	plugin: NotionBlock,
	root: string,
	directories: readonly string[],
	copies: readonly { relative: string; dest: string }[],
	noteSource: string | null,
	notePath: string
): Promise<void> {
	const { vault } = plugin.app;
	for (const dir of directories) {
		if (!vault.getAbstractFileByPath(dir)) await vault.createFolder(dir);
	}
	for (const copy of copies) {
		await writeDroppedFile(plugin, droppedAbsolute(root, copy.relative), copy.dest);
	}
	if (noteSource) await writeDroppedFile(plugin, droppedAbsolute(root, noteSource), notePath);
	else if (!vault.getAbstractFileByPath(notePath)) await vault.create(notePath, "");
}

/**
 * One file of a dropped folder, as the vault should store it.
 *
 * Markdown is normalised the same way a dropped note is. Everything else is
 * copied byte for byte, so an image is not re-encoded on the way in.
 */
async function writeDroppedFile(plugin: NotionBlock, absolute: string, dest: string): Promise<void> {
	const { vault } = plugin.app;
	if (isMarkdownFileName(dest)) {
		await vault.create(dest, normalizeNoteText(await readDroppedText(absolute)));
		return;
	}
	await vault.createBinary(dest, await readDroppedBytes(absolute));
}

/** A markdown file or a folder. A folder named `Notes.md` is a folder, not a note. */
function isPageDrop(item: DroppedFile): boolean {
	return item.isDirectory || isMarkdownDrop(item.name, item.fsPath, item.mime);
}

/** A page link, never an embed. `generateMarkdownLink` can come back with a leading `!`. */
function pageLink(plugin: NotionBlock, file: TFile, sourcePath: string): string {
	const link = plugin.app.fileManager.generateMarkdownLink(file, sourcePath);
	return link.startsWith("!") ? link.slice(1) : link;
}

/** A non-markdown file from the same drop, saved where attachments go. */
async function placeAttachment(plugin: NotionBlock, sourcePath: string, item: DroppedFile): Promise<string> {
	const file = await droppedAsFile(item);
	const saved = await saveAttachment(plugin, file, sourcePath);
	const generated = plugin.app.fileManager.generateMarkdownLink(saved, sourcePath);
	if (isImageFile(file)) return generated.startsWith("!") ? generated : `!${generated}`;
	return toMarkdownLink(generated, saved.path, plugin.settings.embedAttachments);
}

/**
 * The editor and note under the pointer, when the drop landed in a markdown editor.
 *
 * `EditorView.findFromDOM` only checks `.cm-content` descendants of the node
 * passed to it and the node's own `cmView` property — both are missing on
 * `<br>` inside an empty line, widget children (`.ftn-page-link-name`), the
 * inline title, headers and gutters. Climbing to `.cm-editor` first lets
 * `findFromDOM` reach `.cm-content` from anywhere in the editor, and the leaf
 * check also matches `editorCm.dom` and source-mode `contentEl` directly.
 */
function markdownDropTarget(plugin: NotionBlock, evt: DragEvent): { editor: Editor; note: TFile } | null {
	const el = eventElement(evt.target);
	if (!el) return null;
	const editorEl = el.closest<HTMLElement>(".cm-editor") ?? el;
	const cm = EditorView.findFromDOM(editorEl) ?? EditorView.findFromDOM(el);
	if (cm) {
		const info = cm.state.field(editorInfoField, false);
		if (info?.editor && info.file && info.file.extension === "md") {
			return { editor: info.editor, note: info.file };
		}
	}

	let found: { editor: Editor; note: TFile } | null = null;
	plugin.app.workspace.iterateAllLeaves((leaf) => {
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) return;
		const note = view.file;
		if (!note || note.extension !== "md") return;
		const editorCm = (view.editor as unknown as { cm?: EditorView }).cm;
		if (cm && editorCm === cm) found = { editor: view.editor, note };
		else if (
			!found
			&& (editorCm?.dom.contains(el) || (view.getMode() === "source" && view.contentEl.contains(el)))
		) {
			found = { editor: view.editor, note };
		}
	});
	return found;
}

function eventElement(target: EventTarget | null): HTMLElement | null {
	let node: Node | null = target instanceof Node ? target : null;
	while (node) {
		if (node instanceof HTMLElement) return node;
		node = node.parentElement;
	}
	return null;
}

/**
 * A drag that started in the file explorer.
 *
 * Obsidian inserts a link for that itself and never emits `editor-drop`.
 * Claiming it here would move the note instead.
 */
function isInternalDrag(plugin: NotionBlock): boolean {
	const manager = (plugin.app as unknown as { dragManager?: { draggable?: unknown } }).dragManager;
	return manager?.draggable != null;
}

async function droppedText(item: DroppedFile): Promise<string> {
	if (item.file) return item.file.text();
	const path = item.fsPath;
	if (!path) throw new Error("dropped note has no data");
	// fs is a node builtin, external in the bundle, present in desktop Obsidian.
	// @ts-ignore fs is provided by the desktop host, not by this package
	const fs = require("fs") as { promises: { readFile: (p: string, encoding: "utf8") => Promise<string> } };
	return fs.promises.readFile(path, "utf8");
}

async function droppedAsFile(item: DroppedFile): Promise<File> {
	if (item.file) return item.file;
	const path = item.fsPath;
	if (!path) throw new Error("dropped file has no data");
	// @ts-ignore fs is provided by the desktop host, not by this package
	const fs = require("fs") as { promises: { readFile: (p: string) => Promise<Uint8Array> } };
	const bytes = await fs.promises.readFile(path);
	return new File([bytes], item.name);
}

/** The dropped folder's vault path, when it is a folder the vault already has. */
function vaultFolderPath(plugin: NotionBlock, fsPath: string | null): string | null {
	if (fsPath === null) return null;
	const adapter = plugin.app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) return null;
	const rel = vaultRelativePath(adapter.getBasePath(), fsPath);
	if (rel === null) return null;
	const found = plugin.app.vault.getAbstractFileByPath(rel);
	return found instanceof TFolder ? rel : null;
}

function vaultMarkdown(plugin: NotionBlock, fsPath: string | null): TFile | null {
	if (fsPath === null) return null;
	const adapter = plugin.app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) return null;
	const rel = vaultRelativePath(adapter.getBasePath(), fsPath);
	if (rel === null || !isMarkdownFileName(rel)) return null;
	const found = plugin.app.vault.getAbstractFileByPath(rel);
	return found instanceof TFile ? found : null;
}

/** The CodeMirror view behind an Obsidian editor, when this build exposes it. */
function editorView(editor: Editor): EditorView | null {
	const cm = (editor as unknown as { cm?: EditorView }).cm;
	return cm ?? null;
}

/**
 * One undo step, at the drop the pointer marked.
 *
 * When the note is still the text it was at the drop, the saved offsets are
 * where the pointer was. If it changed during the save, the pointer's old
 * offsets would land in the wrong place, so the links follow the caret instead.
 */
function insertDrop(editor: Editor, snapshot: string, from: number, to: number, links: string[]): void {
	const view = editorView(editor);
	const current = view ? view.state.doc.toString() : editor.getValue();
	const same = current === snapshot;
	const atFrom = same ? from : view ? view.state.selection.main.from : editor.posToOffset(editor.getCursor("from"));
	const atTo = same ? to : view ? view.state.selection.main.to : editor.posToOffset(editor.getCursor("to"));
	const plan = planNoteDrop(current, atFrom, atTo, links);

	if (view) {
		dispatchBlockEdit(view, {
			changes: { from: plan.from, to: plan.to, insert: plan.text },
			selection: { anchor: plan.from + plan.text.length },
			scrollIntoView: true,
			userEvent: "insert.block",
		});
		return;
	}
	editor.replaceRange(plan.text, editor.offsetToPos(plan.from), editor.offsetToPos(plan.to));
	editor.setCursor(editor.offsetToPos(plan.from + plan.text.length));
}

/**
 * Where the pointer was, in document offsets.
 *
 * The caret is only a fallback: a thrown position lookup must not escape, or
 * the drop we already claimed would insert nothing.
 */
function dropOffsets(editor: Editor, evt: DragEvent): { from: number; to: number } {
	const cursorFrom = editor.posToOffset(editor.getCursor("from"));
	const cursorTo = editor.posToOffset(editor.getCursor("to"));
	try {
		const pointed = editorView(editor)?.posAtCoords({ x: evt.clientX, y: evt.clientY }, false);
		if (pointed != null) return { from: pointed, to: pointed };
	} catch (error) {
		console.error("feel-the-notion: drop position failed", error);
	}
	return { from: cursorFrom, to: cursorTo };
}

/**
 * Files in a drop.
 *
 * Obsidian reads `dataTransfer.items`, not `files`. On a Finder drop into the
 * editor, `files` is empty while `items` still yields the file — and only a
 * handler that sees the file can stop it being saved as an attachment.
 * `getAsFile` only works during the event, so this runs before the first await.
 */
function droppedFiles(evt: DragEvent): DroppedFile[] {
	const transfer = evt.dataTransfer;
	if (!transfer) return [];
	const out: DroppedFile[] = [];
	const seen = new Set<string>();

	// `items` is what Obsidian's importer reads. `files` is empty for the same
	// Finder drop, so a handler that only looks there never claims it.
	const items = transfer.items;
	if (items) {
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (!item || item.kind !== "file") continue;
			// A folder's entry is only readable during the event. `getAsFile`
			// on a folder is an empty file, so the directory flag has to be
			// taken from the entry itself, here, before the first await.
			const directory = directoryEntry(item);
			let file: File | null = null;
			try {
				file = item.getAsFile();
			} catch (error) {
				console.error("feel-the-notion: reading a dropped file failed", error);
			}
			if (file) pushDropped(out, seen, file, item.type, directory !== null);
			else if (directory) pushPath(out, seen, "", directory, true);
		}
	}
	if (transfer.files) {
		for (let i = 0; i < transfer.files.length; i++) {
			const file = transfer.files[i];
			if (file) pushDropped(out, seen, file, file.type, false);
		}
	}
	// When File objects lack a filesystem path, `text/uri-list` still carries
	// the `file:` URLs (including the `.md` extension macOS may hide on `name`).
	// When no File objects were exposed at all, the uri-list is the fallback.
	if (out.length === 0 || out.some((item) => item.fsPath === null)) {
		const uriPaths = filePathsFromUriList(readUriList(transfer));
		if (out.length > 0) attachUriPaths(out, uriPaths);
		else for (const fsPath of uriPaths) pushPath(out, seen, fsPath, null, false);
	}
	// `webkitGetAsEntry` is missing in some builds. The path is the backup:
	// a folder and a file are the same drag item until something stats it.
	classifyDirectories(out);
	return dedupeByPath(out);
}

function readUriList(transfer: DataTransfer): string {
	try {
		return transfer.getData("text/uri-list") || transfer.getData("URL") || "";
	} catch (error) {
		console.error("feel-the-notion: reading a dropped file failed", error);
		return "";
	}
}

function pushDropped(out: DroppedFile[], seen: Set<string>, file: File, itemType: string | undefined, isDirectory: boolean): void {
	const fsPath = filesystemPath(file);
	const key = fsPath ?? `${file.name}\0${file.size}\0${file.lastModified}`;
	if (seen.has(key)) return;
	seen.add(key);
	const mime = file.type || itemType || null;
	out.push({ name: file.name, file, fsPath, mime, isDirectory });
}

function pushPath(out: DroppedFile[], seen: Set<string>, fsPath: string, name: string | null, isDirectory: boolean): void {
	const key = fsPath || `dir\0${name ?? ""}`;
	if (key === "dir\0" || seen.has(key)) return;
	seen.add(key);
	const base = name ?? fsPath.split(/[/\\]/).pop() ?? fsPath;
	out.push({ name: base, file: null, fsPath: fsPath || null, mime: null, isDirectory });
}

/** The drag item when it is a directory. Null for a file, or when the host has no entry API. */
function directoryEntry(item: DataTransferItem): string | null {
	const getter = (item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory: boolean; name: string } | null }).webkitGetAsEntry;
	if (!getter) return null;
	try {
		const entry = getter.call(item);
		return entry?.isDirectory ? entry.name : null;
	} catch (error) {
		console.error("feel-the-notion: reading a dropped file failed", error);
		return null;
	}
}

/** Set `isDirectory` from the real path. A stat that fails leaves the flag as it was. */
function classifyDirectories(items: DroppedFile[]): void {
	for (const item of items) {
		if (!item.fsPath) continue;
		const dir = isDirectoryPath(item.fsPath);
		if (dir !== null) item.isDirectory = dir;
	}
}

/** One entry per filesystem path. A folder listed by both `items` and `files` is one drop. */
function dedupeByPath(items: DroppedFile[]): DroppedFile[] {
	const seen = new Set<string>();
	const out: DroppedFile[] = [];
	for (const item of items) {
		if (item.fsPath !== null) {
			if (seen.has(item.fsPath)) continue;
			seen.add(item.fsPath);
		}
		out.push(item);
	}
	return out;
}

function isDirectoryPath(fsPath: string): boolean | null {
	try {
		// @ts-ignore fs is provided by the desktop host, not by this package
		const fs = require("fs") as { statSync: (p: string) => { isDirectory: () => boolean } };
		return fs.statSync(fsPath).isDirectory();
	} catch {
		return null;
	}
}

/**
 * The absolute path of a file dropped from the desktop, or null.
 *
 * `File.path` is the legacy Electron field. Current Electron only answers
 * through `webUtils.getPathForFile`, and only for a real OS drag — a drag that
 * started inside the window has neither, and is copied from its bytes.
 */
function filesystemPath(file: File): string | null {
	const direct = (file as File & { path?: unknown }).path;
	if (typeof direct === "string" && direct.length > 0) return direct;
	try {
		// electron is external in the bundle and has no types in this package.
		// @ts-ignore electron is provided by the desktop host, not by this package
		const electron = require("electron") as { webUtils?: { getPathForFile?: (f: File) => string } };
		const got = electron.webUtils?.getPathForFile?.(file);
		return typeof got === "string" && got.length > 0 ? got : null;
	} catch {
		return null;
	}
}

interface HostDirent {
	name: string;
	isDirectory(): boolean;
	isFile(): boolean;
	isSymbolicLink(): boolean;
}

interface HostFs {
	readdir(path: string, opts: { withFileTypes: true }): Promise<HostDirent[]>;
	stat(path: string): Promise<{ isFile(): boolean }>;
	readFile(path: string, encoding: "utf8"): Promise<string>;
	readFile(path: string): Promise<Uint8Array>;
}

function hostFs(): HostFs {
	// fs is a node builtin, external in the bundle, present in desktop Obsidian.
	// @ts-ignore fs is provided by the desktop host, not by this package
	return (require("fs") as { promises: HostFs }).promises;
}

/**
 * Files and directories inside a dropped folder.
 *
 * A symlink to a file is copied as a file. A symlink to a directory is
 * skipped: following it can walk back into a parent and never finish.
 * `.DS_Store` is Finder metadata and is not part of the folder.
 */
async function readDropTree(root: string): Promise<DropTreeEntry[]> {
	const out: DropTreeEntry[] = [];
	await walkDropTree(root, "", out);
	return out;
}

async function walkDropTree(dir: string, prefix: string, out: DropTreeEntry[]): Promise<void> {
	const entries = await hostFs().readdir(dir, { withFileTypes: true });
	for (const ent of entries) {
		if (ent.name === ".DS_Store") continue;
		const rel = prefix === "" ? ent.name : `${prefix}/${ent.name}`;
		const abs = droppedAbsolute(dir, ent.name);
		if (ent.isSymbolicLink()) {
			try {
				const followed = await hostFs().stat(abs);
				if (followed.isFile()) out.push({ relative: rel, kind: "file" });
			} catch (error) {
				console.error(`feel-the-notion: skipping ${rel}`, error);
			}
			continue;
		}
		if (ent.isDirectory()) {
			out.push({ relative: rel, kind: "dir" });
			await walkDropTree(abs, rel, out);
			continue;
		}
		if (ent.isFile()) out.push({ relative: rel, kind: "file" });
	}
}

function droppedAbsolute(root: string, relative: string): string {
	// @ts-ignore path is provided by the desktop host, not by this package
	const path = require("path") as { join: (...parts: string[]) => string };
	return path.join(root, ...relative.split("/"));
}

async function readDroppedText(absolute: string): Promise<string> {
	return hostFs().readFile(absolute, "utf8");
}

async function readDroppedBytes(absolute: string): Promise<ArrayBuffer> {
	const bytes = await hostFs().readFile(absolute);
	const copy = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(copy).set(bytes);
	return copy;
}
