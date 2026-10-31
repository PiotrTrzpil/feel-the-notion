import { TFile, debounce } from "obsidian";
import type NotionBlock from "./main";
import { folderOfNote } from "./folderNotes";
import { parseIcon } from "./pageMeta";
import { buildExplorerCss, IconStyle } from "./explorerStyles";
import { iconStyle, noteIcon } from "./pageIcons";

/**
 * Keeps the explorer stylesheet in step with the vault: rebuilt, debounced,
 * whenever a note's properties, a path, the open note or the settings change.
 *
 * Rebuilding is one pass over the notes' cached metadata, cheap enough that
 * working out what changed would cost more than it saves.
 */
export class ExplorerDecor {
	private readonly styleEl: HTMLStyleElement;
	readonly refresh = debounce(() => this.apply(), 150, true);

	constructor(private readonly plugin: NotionBlock) {
		this.styleEl = document.head.createEl("style", { attr: { id: "ftn-explorer-decor" } });
		plugin.register(() => this.styleEl.remove());

		const { app } = plugin;
		plugin.registerEvent(app.metadataCache.on("changed", () => this.refresh()));
		plugin.registerEvent(app.metadataCache.on("resolved", () => this.refresh()));
		plugin.registerEvent(app.vault.on("create", () => this.refresh()));
		plugin.registerEvent(app.vault.on("delete", () => this.refresh()));
		plugin.registerEvent(app.vault.on("rename", () => this.refresh()));
		plugin.registerEvent(app.workspace.on("file-open", () => this.refresh()));
		app.workspace.onLayoutReady(() => this.apply());
	}

	private apply(): void {
		const { app, settings } = this.plugin;
		const folderNotes = settings.enabled && settings.folderNotes ? this.folderNotes() : new Map<string, TFile>();
		const fileIcons = new Map<string, IconStyle>();
		const folderIcons = new Map<string, IconStyle>();

		if (settings.enabled && settings.pageHeader) {
			for (const file of app.vault.getMarkdownFiles()) {
				const icon = noteIcon(app, file);
				const style = icon && iconStyle(icon);
				if (!style) continue;
				// A hidden folder note shows its icon on the folder instead.
				const folder = folderOfNote(file.path);
				if (folder !== null && folderNotes.has(folder)) folderIcons.set(folder, style);
				else fileIcons.set(file.path, style);
			}
			for (const [folder, value] of Object.entries(settings.folderIcons)) {
				const icon = parseIcon(value);
				const style = icon && iconStyle(icon);
				if (style && !folderIcons.has(folder)) folderIcons.set(folder, style);
			}
		}

		const active = app.workspace.getActiveFile();
		const activeOwner = active ? folderOfNote(active.path) : null;

		this.styleEl.textContent = buildExplorerCss({
			hiddenFiles: [...folderNotes.values()].map((file) => file.path),
			pageFolders: [...folderNotes.keys()],
			fileIcons,
			folderIcons,
			activeFolder: activeOwner !== null && folderNotes.has(activeOwner) ? activeOwner : null,
		});
	}

	/** Every folder that has a note, mapped to it. */
	private folderNotes(): Map<string, TFile> {
		const notes = new Map<string, TFile>();
		for (const file of this.plugin.app.vault.getMarkdownFiles()) {
			const folder = folderOfNote(file.path);
			if (folder !== null) notes.set(folder, file);
		}
		return notes;
	}
}
