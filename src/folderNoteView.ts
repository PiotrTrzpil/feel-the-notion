import { Keymap, Menu, Notice, TAbstractFile, TFile, TFolder } from "obsidian";
import type NotionBlock from "./main";
import { folderNotePath, isWithin, planFollowRename, planSubPageFolder, remapPath } from "./folderNotes";
import { folderIcon, folderNote, noteIcon, setFolderIcon, setNoteIcon } from "./pageIcons";
import { IconPickerModal } from "./pagePickers";

const FOLDER_TITLE = '.workspace-leaf-content[data-type="file-explorer"] .nav-folder-title[data-path]';

/**
 * Folder notes in the file explorer: a click on a folder that has a note
 * opens the note, renames keep the pair named alike, and the explorer's
 * context menu gets "Create folder note" and the icon items.
 */
export class FolderNotes {
	constructor(private readonly plugin: NotionBlock) {
		const { app } = plugin;
		// Capture phase on the document, so the explorer's own click handler,
		// which would toggle the folder open or shut, never sees the click.
		plugin.registerDomEvent(document, "click", (evt) => this.onClick(evt), { capture: true });
		plugin.registerEvent(app.vault.on("rename", (file, oldPath) => this.onRename(file, oldPath)));
		plugin.registerEvent(app.vault.on("delete", (file) => this.onDelete(file)));
		plugin.registerEvent(app.workspace.on("file-menu", (menu, file) => this.onFileMenu(menu, file)));
	}

	private get active(): boolean {
		return this.plugin.settings.enabled && this.plugin.settings.folderNotes;
	}

	private onClick(evt: MouseEvent): void {
		if (!this.active || evt.button !== 0 || evt.shiftKey || evt.altKey) return;
		const target = evt.target as HTMLElement | null;
		const title = target?.closest<HTMLElement>(FOLDER_TITLE);
		// The chevron still folds, a title being renamed is text to edit, and
		// the "+" button is its own action.
		if (!title || target?.closest(".collapse-icon, [contenteditable='true'], .ftn-explorer-add")) return;

		const note = folderNote(this.plugin.app, title.dataset.path ?? "");
		if (!note) return;
		evt.preventDefault();
		evt.stopPropagation();
		void this.plugin.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(note);
	}

	private onRename(file: TAbstractFile, oldPath: string): void {
		this.remapFolderIcons(oldPath, file.path);
		if (!this.active) return;

		const plan = planFollowRename(oldPath, file.path, file instanceof TFolder);
		if (!plan) return;
		const { vault, fileManager } = this.plugin.app;
		const subject = vault.getAbstractFileByPath(plan.from);
		const isRightKind = plan.kind === "folder" ? subject instanceof TFolder : subject instanceof TFile;
		if (!subject || !isRightKind) return;
		if (vault.getAbstractFileByPath(plan.to)) {
			new Notice(`Could not rename ${plan.from} to match: ${plan.to} already exists`);
			return;
		}
		// After the vault has finished reporting this rename: a folder's
		// rename is followed by one event per file inside it.
		window.setTimeout(() => void fileManager.renameFile(subject, plan.to), 0);
	}

	/** Folder icons kept in settings follow their folder. */
	private remapFolderIcons(oldPath: string, newPath: string): void {
		const icons = this.plugin.settings.folderIcons;
		let changed = false;
		for (const [path, icon] of Object.entries(icons)) {
			const moved = remapPath(path, oldPath, newPath);
			if (moved === null) continue;
			delete icons[path];
			icons[moved] = icon;
			changed = true;
		}
		if (changed) void this.plugin.saveSettings();
	}

	private onDelete(deleted: TAbstractFile): void {
		if (!(deleted instanceof TFolder)) return;
		const icons = this.plugin.settings.folderIcons;
		const gone = Object.keys(icons).filter((path) => isWithin(path, deleted.path));
		gone.forEach((path) => delete icons[path]);
		if (gone.length > 0) void this.plugin.saveSettings();
	}

	private onFileMenu(menu: Menu, file: TAbstractFile): void {
		const { settings, app } = this.plugin;
		if (!settings.enabled) return;

		if (file instanceof TFolder && settings.folderNotes && !folderNote(app, file)) {
			const path = folderNotePath(file.path);
			if (path) {
				menu.addItem((item) => item
					.setTitle("Create folder note")
					.setIcon("file-plus")
					.setSection("action")
					.onClick(() => void this.createFolderNote(path)));
			}
		}

		if (!settings.pageHeader) return;
		if (file instanceof TFolder && !file.isRoot()) {
			const hasIcon = folderIcon(this.plugin, file.path) !== null;
			this.addIconItems(menu, hasIcon, (icon) => void setFolderIcon(this.plugin, file, icon));
		} else if (file instanceof TFile && file.extension === "md") {
			const hasIcon = noteIcon(app, file) !== null;
			this.addIconItems(menu, hasIcon, (icon) => void setNoteIcon(app, file, icon));
		}
	}

	private addIconItems(menu: Menu, hasIcon: boolean, set: (icon: Parameters<typeof setNoteIcon>[2]) => void): void {
		menu.addItem((item) => item
			.setTitle(hasIcon ? "Change icon" : "Add icon")
			.setIcon("smile-plus")
			.setSection("action")
			.onClick(() => new IconPickerModal(this.plugin.app, hasIcon, set).open()));
		if (hasIcon) {
			menu.addItem((item) => item
				.setTitle("Remove icon")
				.setIcon("smile")
				.setSection("action")
				.onClick(() => set(null)));
		}
	}

	private async createFolderNote(path: string): Promise<void> {
		const { app } = this.plugin;
		try {
			const note = await app.vault.create(path, "");
			await app.workspace.getLeaf(false).openFile(note);
		} catch (error) {
			console.error("feel-the-notion: creating folder note failed", error);
			new Notice(`Could not create ${path}`);
		}
	}
}

/**
 * The folder a new sub-page of `note` goes in. A note that is not a folder
 * note yet becomes one first, moved into a folder of its own name, which is
 * what a page with sub-pages is.
 *
 * Null when that move is blocked by a note already at the destination; the
 * caller then creates the page beside the note instead.
 */
export async function subPageFolder(plugin: NotionBlock, note: TFile): Promise<string | null> {
	const { vault, fileManager } = plugin.app;
	const plan = planSubPageFolder(note.path);
	if (!plan.move) return plan.folder;
	if (vault.getAbstractFileByPath(plan.move.to)) return null;

	const existing = vault.getAbstractFileByPath(plan.folder);
	if (existing && !(existing instanceof TFolder)) return null;
	if (!existing) await vault.createFolder(plan.folder);
	// renameFile, not vault.rename: it rewrites links to the note elsewhere.
	await fileManager.renameFile(note, plan.move.to);
	return plan.folder;
}
