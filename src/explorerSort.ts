import { App, TAbstractFile, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import type NotionBlock from "./main";
import { TreeChild, childForTarget, orderSubpages } from "./explorerOrder";
import { folderOfNote } from "./folderNotes";
import { folderNote } from "./pageIcons";

/**
 * Lists a folder note's children in the file explorer in the order its
 * sub-pages appear in the note.
 *
 * The explorer virtualizes its rows and sorts them itself, folders first.
 * Reordering the DOM would be thrown away on the next sort, so the sort is
 * the thing that changes: `getSortedFolderItems` for a folder that has a note.
 */

interface FileExplorerView {
	getSortedFolderItems(folder: TFolder): FileExplorerItem[];
	requestSort(): void;
}

interface FileExplorerItem {
	file: TAbstractFile;
}

export class ExplorerSort {
	private readonly originals = new Map<FileExplorerView, FileExplorerView["getSortedFolderItems"]>();

	constructor(private readonly plugin: NotionBlock) {
		const { app } = plugin;
		plugin.register(() => this.restore());
		// A new explorer leaf needs the same patch. Sorting the ones already
		// patched would fight a resize, so only a leaf seen for the first time
		// is re-sorted.
		plugin.registerEvent(app.workspace.on("layout-change", () => {
			if (this.patch()) this.resort();
		}));
		// Editing the note changes the order without adding or removing a file,
		// which is the only thing that makes the explorer sort on its own.
		plugin.registerEvent(app.metadataCache.on("changed", (file) => {
			if (folderOfNote(file.path) !== null) this.resort();
		}));
		app.workspace.onLayoutReady(() => {
			this.patch();
			this.resort();
		});
	}

	/** Re-read the order after a setting change. */
	refresh(): void {
		this.patch();
		this.resort();
	}

	private get active(): boolean {
		const settings = this.plugin.settings;
		return settings.enabled && settings.folderNotes;
	}

	/** @returns whether a file explorer was patched for the first time. */
	private patch(): boolean {
		const live = new Set<FileExplorerView>();
		let added = false;
		for (const leaf of this.plugin.app.workspace.getLeavesOfType("file-explorer")) {
			const view = explorerView(leaf);
			if (!view || this.originals.has(view)) {
				if (view) live.add(view);
				continue;
			}
			const original = view.getSortedFolderItems.bind(view);
			this.originals.set(view, original);
			view.getSortedFolderItems = (folder) => this.ordered(original, folder);
			live.add(view);
			added = true;
		}
		for (const [view, original] of [...this.originals]) {
			if (live.has(view)) continue;
			view.getSortedFolderItems = original;
			this.originals.delete(view);
		}
		return added;
	}

	private ordered(original: (folder: TFolder) => FileExplorerItem[], folder: TFolder): FileExplorerItem[] {
		const items = original(folder);
		if (!this.active) return items;
		const note = folderNote(this.plugin.app, folder);
		if (!note) return items;

		const mentioned = mentionedChildPaths(this.plugin.app, folder.path, note);
		const wrapped = items.map((item) => ({ item, ...describe(item.file, note.path) }));
		return orderSubpages(wrapped, mentioned).map((entry) => entry.item);
	}

	private resort(): void {
		for (const view of this.originals.keys()) view.requestSort();
	}

	private restore(): void {
		for (const [view, original] of this.originals) view.getSortedFolderItems = original;
		this.originals.clear();
	}
}

function explorerView(leaf: WorkspaceLeaf): FileExplorerView | null {
	const view = leaf.view as unknown as Partial<FileExplorerView>;
	if (typeof view.getSortedFolderItems !== "function" || typeof view.requestSort !== "function") return null;
	return view as FileExplorerView;
}

/** Child paths in the order `note` links them. */
export function mentionedChildPaths(app: App, folderPath: string, note: TFile): string[] {
	const links = app.metadataCache.getFileCache(note)?.links ?? [];
	const sorted = [...links].sort((a, b) => a.position.start.offset - b.position.start.offset);
	const out: string[] = [];
	const seen = new Set<string>();
	for (const link of sorted) {
		const dest = app.metadataCache.getFirstLinkpathDest(link.link, note.path);
		if (!dest) continue;
		const child = childForTarget(folderPath, dest.path, note.path);
		if (!child || seen.has(child)) continue;
		seen.add(child);
		out.push(child);
	}
	return out;
}

function describe(file: TAbstractFile, ownNote: string): TreeChild {
	const folder = file instanceof TFolder;
	const page = folder || (file instanceof TFile && file.extension === "md" && file.path !== ownNote);
	return {
		path: file.path,
		name: file instanceof TFile && file.extension === "md" ? file.basename : file.name,
		page,
	};
}
