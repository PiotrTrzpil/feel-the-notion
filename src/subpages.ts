import { Keymap, MarkdownRenderChild, TAbstractFile, TFile, TFolder, debounce, setIcon } from "obsidian";
import type NotionBlock from "./main";
import { basename, folderOfNote, joinPath, parentPath } from "./folderNotes";
import { folderIcon, folderNote, noteIcon, renderIcon } from "./pageIcons";
import { SUBPAGES_LANGUAGE } from "./pageBlocks";

/**
 * The ```subpages block: a live list of a page's sub-pages, as Notion shows
 * child pages inside their parent.
 *
 * A page's sub-pages are the notes in its folder: for a folder note, the
 * folder it belongs to; for a plain note, a folder of its own name beside it,
 * if there is one. A sub-folder counts as one sub-page, its folder note.
 * The list redraws as pages are added, renamed or removed.
 */
export function registerSubpages(plugin: NotionBlock): void {
	plugin.registerMarkdownCodeBlockProcessor(SUBPAGES_LANGUAGE, (_source, el, ctx) => {
		ctx.addChild(new SubpagesList(el, plugin, ctx.sourcePath));
	});
}

interface Entry {
	/** What the row opens: a note, or nothing for a folder without one. */
	note: TFile | null;
	name: string;
	isFolder: boolean;
	path: string;
}

class SubpagesList extends MarkdownRenderChild {
	private readonly redraw = debounce(() => this.render(), 100, true);

	constructor(containerEl: HTMLElement, private readonly plugin: NotionBlock, private readonly sourcePath: string) {
		super(containerEl);
	}

	onload(): void {
		const { vault, metadataCache } = this.plugin.app;
		this.registerEvent(vault.on("create", () => this.redraw()));
		this.registerEvent(vault.on("delete", () => this.redraw()));
		this.registerEvent(vault.on("rename", () => this.redraw()));
		this.registerEvent(metadataCache.on("changed", () => this.redraw()));
		this.render();
	}

	private folder(): TFolder | null {
		const { vault } = this.plugin.app;
		const own = folderOfNote(this.sourcePath);
		const path = own ?? joinPath(parentPath(this.sourcePath), basename(this.sourcePath).replace(/\.md$/, ""));
		const folder = vault.getAbstractFileByPath(path);
		return folder instanceof TFolder ? folder : null;
	}

	private entries(folder: TFolder): Entry[] {
		const entries: Entry[] = [];
		for (const child of folder.children) {
			if (child instanceof TFolder) {
				entries.push({ note: folderNote(this.plugin.app, child), name: child.name, isFolder: true, path: child.path });
			} else if (isPage(child) && child.path !== this.sourcePath) {
				entries.push({ note: child, name: child.basename, isFolder: false, path: child.path });
			}
		}
		return entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
	}

	private render(): void {
		const el = this.containerEl;
		el.empty();
		el.addClass("ftn-subpages");

		const folder = this.folder();
		const entries = folder ? this.entries(folder) : [];
		if (entries.length === 0) {
			el.createDiv({ cls: "ftn-subpages-empty", text: "No sub-pages yet. Add one with the Page item in the insert menu." });
			return;
		}
		for (const entry of entries) this.renderEntry(el, entry);
	}

	private renderEntry(parent: HTMLElement, entry: Entry): void {
		const { app } = this.plugin;
		const row = parent.createEl("a", { cls: "ftn-subpage internal-link" });
		const iconEl = row.createSpan({ cls: "ftn-subpage-icon" });
		const icon = entry.isFolder
			? folderIcon(this.plugin, entry.path)
			: entry.note && noteIcon(app, entry.note);
		if (icon) renderIcon(iconEl, icon);
		else setIcon(iconEl, entry.isFolder && !entry.note ? "folder" : "file-text");
		row.createSpan({ cls: "ftn-subpage-name", text: entry.name });

		const note = entry.note;
		if (!note) {
			row.addClass("is-unresolved");
			return;
		}
		row.dataset.href = note.path;
		row.setAttr("href", note.path);
		row.addEventListener("click", (evt) => {
			evt.preventDefault();
			void app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(note);
		});
		row.addEventListener("mouseover", (event) => {
			app.workspace.trigger("hover-link", {
				event,
				source: "preview",
				hoverParent: this,
				targetEl: row,
				linktext: note.path,
				sourcePath: this.sourcePath,
			});
		});
	}
}

function isPage(file: TAbstractFile): file is TFile {
	return file instanceof TFile && file.extension === "md";
}
