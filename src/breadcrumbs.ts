import { Keymap, MarkdownView, TFile, WorkspaceLeaf, debounce } from "obsidian";
import type NotionBlock from "./main";
import { folderOfNote, joinPath } from "./folderNotes";
import { folderNote, renderIcon, shownFolderIcon } from "./pageIcons";

const CRUMB = ".view-header-title-parent > .view-header-breadcrumb";

/**
 * Obsidian's own breadcrumbs (the folders before a note's name in its view
 * header) made into Notion's: a folder with a folder note opens that note
 * when clicked, shows its icon, and is underlined like in the explorer.
 *
 * A folder note's own folder is dropped from its trail: `Travel / Travel`
 * would name the same page twice.
 *
 * The crumbs carry no paths, so each one's folder is its position along the
 * open note's parent path, worked out at click and draw time.
 */
export class Breadcrumbs {
	private readonly refresh = debounce(() => this.decorateAll(), 50, true);

	constructor(private readonly plugin: NotionBlock) {
		const { app } = plugin;
		plugin.registerDomEvent(document, "click", (evt) => this.onClick(evt), { capture: true });
		plugin.registerEvent(app.workspace.on("layout-change", () => this.refresh()));
		plugin.registerEvent(app.workspace.on("file-open", () => this.refresh()));
		plugin.registerEvent(app.metadataCache.on("changed", () => this.refresh()));
		plugin.registerEvent(app.vault.on("rename", () => this.refresh()));
		app.workspace.onLayoutReady(() => this.decorateAll());
		plugin.register(() => this.clearAll());
	}

	private get active(): boolean {
		return this.plugin.settings.enabled && this.plugin.settings.folderNotes;
	}

	/** Re-draws after a setting changed. */
	update(): void {
		this.refresh();
	}

	private onClick(evt: MouseEvent): void {
		if (!this.active || evt.button !== 0) return;
		const crumb = (evt.target as HTMLElement | null)?.closest<HTMLElement>(CRUMB);
		const folder = crumb?.dataset.ftnFolder;
		if (!crumb || !folder) return;
		const note = folderNote(this.plugin.app, folder);
		if (!note) return;
		evt.preventDefault();
		evt.stopPropagation();
		void this.plugin.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(note);
	}

	private decorateAll(): void {
		this.plugin.app.workspace.iterateAllLeaves((leaf) => this.decorate(leaf));
	}

	private clearAll(): void {
		document.querySelectorAll<HTMLElement>(CRUMB).forEach((crumb) => clear(crumb));
	}

	private decorate(leaf: WorkspaceLeaf): void {
		if (!(leaf.view instanceof MarkdownView)) return;
		const crumbs = Array.from(leaf.view.containerEl.querySelectorAll<HTMLElement>(CRUMB));
		const file = leaf.view.file;
		crumbs.forEach((crumb) => clear(crumb));
		if (!this.active || !(file instanceof TFile)) return;

		const folders = folderChain(file.parent?.path ?? "");
		// The crumbs are the parent folders in order; anything else means
		// Obsidian changed how it draws them, and guessing would mislabel.
		if (folders.length !== crumbs.length) return;

		const ownFolder = folderOfNote(file.path);
		crumbs.forEach((crumb, i) => {
			const folder = folders[i];
			crumb.dataset.ftnFolder = folder;
			if (folder === ownFolder) {
				crumb.addClass("ftn-crumb-self");
				return;
			}
			const note = folderNote(this.plugin.app, folder);
			if (note) crumb.addClass("ftn-crumb-page");
			if (this.plugin.settings.pageHeader) {
				renderIcon(crumb.createSpan({ cls: "ftn-crumb-icon", prepend: true }), shownFolderIcon(this.plugin, folder));
			}
		});
	}
}

/** `A/B/C` → `["A", "A/B", "A/B/C"]`; the vault root has none. */
function folderChain(path: string): string[] {
	if (path === "" || path === "/") return [];
	const chain: string[] = [];
	let acc = "";
	for (const part of path.split("/")) {
		acc = joinPath(acc, part);
		chain.push(acc);
	}
	return chain;
}

function clear(crumb: HTMLElement): void {
	delete crumb.dataset.ftnFolder;
	crumb.removeClass("ftn-crumb-page", "ftn-crumb-self");
	crumb.querySelectorAll(".ftn-crumb-icon").forEach((el) => el.remove());
}
