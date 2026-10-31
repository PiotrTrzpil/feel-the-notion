import { Text } from "@codemirror/state";
import type { MoveChange, MoveSource } from "./planMove";
import { reindentBlock } from "./dragRange";

/**
 * Moving a block out of its note, onto another note in the file explorer.
 *
 * DOM-free so the text arithmetic can be tested on its own: the drag only
 * decides WHICH note was hit, these decide what both notes look like after.
 */

/**
 * The deletion that takes `source` out of its document, together with the
 * newline that terminates it.
 *
 * When the block runs to the end of the document there is no trailing newline
 * to remove, so the PRECEDING one is taken instead — otherwise the document
 * keeps a blank line where the block used to be.
 */
export function planCut(doc: Text, source: MoveSource): MoveChange {
	const atDocEnd = source.to >= doc.length;
	return {
		from: atDocEnd ? Math.max(0, source.from - 1) : source.from,
		to: atDocEnd ? doc.length : Math.min(source.to + 1, doc.length),
	};
}

/** One link in a block's text, wiki (`[[a|b]]`) or markdown (`[b](a)`). */
export interface NoteLink {
	/** Offsets of the whole link, `!` included, in the text it was found in. */
	from: number;
	to: number;
	embed: boolean;
	/** Linkpath as Obsidian resolves it: no subpath, URL-decoded. */
	path: string;
	/** `#heading` or `#^block`, with its `#`, or "". */
	subpath: string;
	/** Display text, or an embed's size such as `300`; "" when there is none. */
	alias: string;
}

const WIKI_LINK = /(!?)\[\[([^\]|#^]*)([#^][^\]|]*)?(?:\|([^\]]*))?\]\]/g;
const MARKDOWN_LINK = /(!?)\[([^\]]*)\]\((<[^>]+>|[^)\s]+)\)/g;
/** A scheme (`https:`, `mailto:`, `obsidian:`): not a file in the vault. */
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Every link to a vault file in `text`, in order.
 *
 * Only what moving attachments needs: which file each link names and where
 * it sits, so it can be rewritten. Links inside code are not told apart; a
 * block that quotes a link in code and also embeds that file is rare enough
 * that the worst case, the code sample being rewritten too, is acceptable.
 */
export function findLinks(text: string): NoteLink[] {
	const links: NoteLink[] = [];

	for (const m of text.matchAll(WIKI_LINK)) {
		const path = m[2].trim();
		if (path === "") continue;
		links.push({
			from: m.index!,
			to: m.index! + m[0].length,
			embed: m[1] === "!",
			path,
			subpath: m[3] ?? "",
			alias: m[4] ?? "",
		});
	}

	for (const m of text.matchAll(MARKDOWN_LINK)) {
		const raw = m[3].replace(/^<|>$/g, "");
		if (URL_SCHEME.test(raw)) continue;
		const hash = raw.indexOf("#");
		const target = hash === -1 ? raw : raw.slice(0, hash);
		if (target === "") continue;
		let path: string;
		try {
			path = decodeURI(target);
		} catch {
			path = target;
		}
		links.push({
			from: m.index!,
			to: m.index! + m[0].length,
			embed: m[1] === "!",
			path,
			subpath: hash === -1 ? "" : raw.slice(hash),
			alias: m[2],
		});
	}

	return links.sort((a, b) => a.from - b.from);
}

/**
 * `text` with each link `replace` returns a string for swapped out; links it
 * returns null for are left as written.
 */
export function rewriteLinks(
	text: string,
	links: NoteLink[],
	replace: (link: NoteLink) => string | null
): string {
	let out = "";
	let at = 0;
	for (const link of links) {
		const next = replace(link);
		if (next === null) continue;
		out += text.slice(at, link.from) + next;
		at = link.to;
	}
	return out + text.slice(at);
}

/**
 * `content` with `block` appended as its last block.
 *
 * The block is lifted to column zero: the indent it had was nesting in the
 * note it came from, and the end of another note has no parent to nest under.
 * One blank line separates it from what was there, so it never merges into the
 * previous paragraph or list.
 */
export function appendBlock(content: string, block: string, indent: number): string {
	const text = reindentBlock(block, indent, 0);
	const head = content.replace(/\s+$/, "");
	return head === "" ? `${text}\n` : `${head}\n\n${text}\n`;
}
