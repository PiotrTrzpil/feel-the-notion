/**
 * The stylesheet that decorates the file explorer: page icons before names,
 * folder notes hidden inside their folders, folders with a note underlined.
 *
 * A stylesheet rather than DOM edits because the explorer rebuilds its rows
 * whenever it likes (expanding a folder, sorting, renaming). Selectors keyed
 * on `data-path` apply to whatever rows exist, now or later, with nothing to
 * re-run when they are rebuilt.
 *
 * Pure. See test/explorerStyles.test.mjs.
 */

/** How an icon is drawn: as text (an emoji), or an SVG used as a mask. */
export type IconStyle = { kind: "text"; text: string } | { kind: "mask"; url: string };

export interface ExplorerDecor {
	/** Folder note paths, hidden from the explorer. */
	hiddenFiles: readonly string[];
	/** Folders that have a note, marked as clickable pages. */
	pageFolders: readonly string[];
	fileIcons: ReadonlyMap<string, IconStyle>;
	folderIcons: ReadonlyMap<string, IconStyle>;
	/**
	 * The folder whose note is open. Its own row is hidden, so Obsidian's
	 * active-file highlight has nowhere to show; the folder takes it instead.
	 */
	activeFolder: string | null;
}

const EXPLORER = '.workspace-leaf-content[data-type="file-explorer"]';

/** A CSS string literal: safe for `content:` and attribute selector values. */
export function cssString(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\a ")}"`;
}

/** An SVG's markup as a `url(...)` for `mask-image`. */
export function svgMaskUrl(svg: string): string {
	return `url(${cssString(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`)})`;
}

export function buildExplorerCss(decor: ExplorerDecor): string {
	const rules: string[] = [];

	if (decor.hiddenFiles.length > 0) {
		const selectors = decor.hiddenFiles.map(
			(path) => `${EXPLORER} .nav-file:has(> .nav-file-title[data-path=${cssString(path)}])`
		);
		rules.push(`${selectors.join(",\n")} { display: none; }`);
	}

	if (decor.pageFolders.length > 0) {
		const selectors = decor.pageFolders.map(
			(path) => `${EXPLORER} .nav-folder-title[data-path=${cssString(path)}] .nav-folder-title-content`
		);
		rules.push(`${selectors.join(",\n")} { text-decoration: underline; text-decoration-color: var(--text-faint); text-underline-offset: 3px; }`);
	}

	if (decor.activeFolder !== null) {
		rules.push(
			`${EXPLORER} .nav-folder-title[data-path=${cssString(decor.activeFolder)}] `
			+ "{ background-color: var(--nav-item-background-active); color: var(--nav-item-color-active); }"
		);
	}

	for (const [path, icon] of decor.fileIcons) {
		rules.push(iconRule(`${EXPLORER} .nav-file-title[data-path=${cssString(path)}] .nav-file-title-content::before`, icon));
	}
	for (const [path, icon] of decor.folderIcons) {
		rules.push(iconRule(`${EXPLORER} .nav-folder-title[data-path=${cssString(path)}] .nav-folder-title-content::before`, icon));
	}

	return rules.join("\n");
}

/**
 * One icon. Spacing shared by both kinds is in styles.css, which matches the
 * same pseudo-elements; it draws nothing there, since a pseudo-element with
 * no `content` does not exist.
 */
function iconRule(selector: string, icon: IconStyle): string {
	return icon.kind === "text"
		? `${selector} { content: ${cssString(icon.text)}; }`
		: `${selector} { content: ""; width: 1em; height: 1em; vertical-align: -0.15em; `
			+ `-webkit-mask: ${icon.url} center / contain no-repeat; mask: ${icon.url} center / contain no-repeat; `
			+ `background-color: currentColor; }`;
}
