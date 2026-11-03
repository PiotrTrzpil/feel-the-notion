/**
 * Which links are Notion page blocks: a sub-page of the current page, or a
 * page nested under one of those.
 *
 * A page block is one unit. The markdown link stays in the file, but the
 * editor draws the page's icon and title in its place, and the caret cannot
 * sit between the letters of the link. See pageLinkView.ts.
 *
 * Path arithmetic only. See test/pageLink.test.mjs.
 */

import { basename, folderOfNote, isWithin, joinPath, parentPath } from "./folderNotes";

/**
 * The folder a page's sub-pages live in, whether or not it exists yet.
 *
 * A folder note's sub-pages are the notes in its folder. A plain note's are
 * the notes in a folder of its own name beside it (`Notes/Trip.md` →
 * `Notes/Trip/`).
 */
export function subpageFolderOf(notePath: string): string {
	const own = folderOfNote(notePath);
	if (own !== null) return own;
	const name = basename(notePath).replace(/\.md$/, "");
	return joinPath(parentPath(notePath), name);
}

/**
 * Whether `targetPath` is a sub-page of `sourcePath`, or a page nested under
 * one of those: any markdown note inside the source page's sub-page folder,
 * other than the source page itself.
 */
export function isNestedPage(sourcePath: string, targetPath: string): boolean {
	if (sourcePath === "" || !targetPath.endsWith(".md") || targetPath === sourcePath) return false;
	const root = subpageFolderOf(sourcePath);
	if (root === "" || root === "/") return false;
	return isWithin(targetPath, root);
}

/**
 * Quote markers, indent, and one list marker (`-`, `1.`, `- [ ]`) in front
 * of a link. A callout tag or any other text means the link shares its line.
 */
const WHOLE_LINE_BEFORE = /^(?:[ \t]*(?:>[ \t]?)*)?(?:[ \t]*(?:[-*+]|\d+\.)[ \t]+(?:\[[ xX]\][ \t]+)?)?[ \t]*$/;

/**
 * The link owns its line when, apart from a blockquote or list marker, the
 * line holds nothing else. Those render as a full row. A link sitting in a
 * sentence renders as a chip, still one unit.
 */
export function isWholeLineLink(line: string, from: number, to: number): boolean {
	if (line.slice(to).trim() !== "") return false;
	return WHOLE_LINE_BEFORE.test(line.slice(0, from));
}
