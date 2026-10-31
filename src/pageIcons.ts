import { App, TFile, TFolder, getIcon, setIcon } from "obsidian";
import type NotionBlock from "./main";
import { folderNotePath } from "./folderNotes";
import { ICON_KEY, PageIcon, formatIcon, parseIcon } from "./pageMeta";
import { IconStyle, svgMaskUrl } from "./explorerStyles";

/**
 * Where page icons live, and how they are drawn.
 *
 * A note's icon is its `icon` property. A folder's is its folder note's, or,
 * for a folder with no note to hold one, an entry in this plugin's settings.
 */

export function noteIcon(app: App, file: TFile): PageIcon | null {
	return parseIcon(app.metadataCache.getFileCache(file)?.frontmatter?.[ICON_KEY]);
}

/** The folder's note, when it has one. */
export function folderNote(app: App, folder: TFolder | string): TFile | null {
	const path = folderNotePath(typeof folder === "string" ? folder : folder.path);
	const file = path === null ? null : app.vault.getAbstractFileByPath(path);
	return file instanceof TFile ? file : null;
}

export function folderIcon(plugin: NotionBlock, folder: string): PageIcon | null {
	const note = folderNote(plugin.app, folder);
	return (note && noteIcon(plugin.app, note)) ?? parseIcon(plugin.settings.folderIcons[folder]);
}

export async function setNoteIcon(app: App, file: TFile, icon: PageIcon | null): Promise<void> {
	await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
		if (icon) frontmatter[ICON_KEY] = formatIcon(icon);
		else delete frontmatter[ICON_KEY];
	});
}

/** Sets a folder's icon on its note, or in settings while it has none. */
export async function setFolderIcon(plugin: NotionBlock, folder: TFolder, icon: PageIcon | null): Promise<void> {
	const note = folderNote(plugin.app, folder);
	if (note) {
		await setNoteIcon(plugin.app, note, icon);
		// A settings entry left behind would come back if the note went away.
		if (!(folder.path in plugin.settings.folderIcons)) return;
	}
	if (icon && !note) plugin.settings.folderIcons[folder.path] = formatIcon(icon);
	else delete plugin.settings.folderIcons[folder.path];
	await plugin.saveSettings();
}

/** Draws `icon` into `el`, replacing what was there. */
export function renderIcon(el: HTMLElement, icon: PageIcon): void {
	el.empty();
	if (icon.kind === "lucide") setIcon(el, icon.id);
	else el.setText(icon.text);
}

const maskCache = new Map<string, string | null>();

/** How the explorer stylesheet draws `icon`; null for an unknown Lucide id. */
export function iconStyle(icon: PageIcon): IconStyle | null {
	if (icon.kind === "text") return { kind: "text", text: icon.text };
	let url = maskCache.get(icon.id);
	if (url === undefined) {
		const svg = getIcon(icon.id);
		// A data: URL is parsed as a standalone document, which needs the
		// namespace that inline SVG in HTML can leave out.
		svg?.setAttribute("xmlns", "http://www.w3.org/2000/svg");
		url = svg ? svgMaskUrl(svg.outerHTML) : null;
		maskCache.set(icon.id, url);
	}
	return url === null ? null : { kind: "mask", url };
}
