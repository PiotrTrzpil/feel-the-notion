/**
 * The text of the page blocks the insert menu writes: a live list of
 * sub-pages, an inline database (an Obsidian Base) over them, and a toggle.
 *
 * Pure. See test/pageBlocks.test.mjs.
 */

/** The fenced block the sub-pages renderer (subpages.ts) draws as a list. */
export const SUBPAGES_LANGUAGE = "subpages";

export function subpagesBlock(): string {
	return "```" + SUBPAGES_LANGUAGE + "\n```";
}

/**
 * Notion's toggle, as a folded callout. The `toggle` type is styled in
 * styles.css to drop the callout's box, leaving the chevron and the title.
 */
export const TOGGLE_PREFIX = "> [!toggle]- ";

/** A YAML single-quoted scalar: safe for any folder name, colons and quotes included. */
function yamlQuote(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

/**
 * An inline Base listing the pages in `folder`, the note holding it excluded
 * (`this` is the embedding note in a base code block). Notion's inline
 * database: rows are pages, and the views can be changed from the table.
 */
export function databaseBlock(folder: string): string {
	return [
		"```base",
		"filters:",
		"  and:",
		`    - ${yamlQuote(`file.inFolder(${JSON.stringify(folder)})`)}`,
		"    - 'file.ext == \"md\"'",
		"    - 'file.path != this.file.path'",
		"views:",
		"  - type: table",
		"    name: Pages",
		"    order:",
		"      - file.name",
		"      - file.mtime",
		"```",
	].join("\n");
}
