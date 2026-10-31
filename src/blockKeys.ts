import { SelectionRange, Text } from "@codemirror/state";
import {
	LineSpan,
	allowedIndents,
	indentString,
	indentWidth,
	isBlank,
	resolveDragRange,
} from "./dragRange";
import { MoveChange, MoveSource, planBlockSwap } from "./planMove";
import { planCut } from "./fileDrop";

/**
 * The text arithmetic behind Notion's block keyboard commands: moving a block
 * past its sibling, duplicating it, and the Esc block selection (navigate,
 * extend, delete, indent).
 *
 * "Block" means exactly what a drag picks up — a line plus everything nested
 * under it, a fence as one unit — so every span here comes from
 * resolveDragRange rather than a second definition that could drift from it.
 *
 * Pure, so it is testable without a DOM. See test/blockKeys.test.mjs.
 */

/**
 * Last line hidden by a fold that covers `lineNo`, or null when it is visible.
 *
 * Passed in rather than read here: folds live in editor state this module
 * does not know about, and Notion's arrow keys never land on a hidden block.
 */
export type HiddenEnd = (lineNo: number) => number | null;

const NOTHING_HIDDEN: HiddenEnd = () => null;

/** The block at `lineNo`: the line, its nested children, or a whole fence. */
export function blockSpanAt(doc: Text, lineNo: number): LineSpan {
	const range = resolveDragRange(doc, lineNo, "paragraph");
	return { firstLine: range.firstLine, lastLine: range.lastLine };
}

/**
 * Every block a text selection touches, children included.
 *
 * A selection that ends at the very start of a line (a triple-clicked line
 * carries its newline) does not reach into that line: nothing of it is
 * selected, so it is not something the user meant to move.
 */
export function touchedBlocks(doc: Text, range: SelectionRange): LineSpan {
	const end = !range.empty && doc.lineAt(range.to).from === range.to ? range.to - 1 : range.to;
	const firstBlock = blockSpanAt(doc, doc.lineAt(range.from).number);
	const lastBlock = blockSpanAt(doc, doc.lineAt(Math.max(range.from, end)).number);
	return {
		firstLine: Math.min(firstBlock.firstLine, lastBlock.firstLine),
		lastLine: Math.max(firstBlock.lastLine, lastBlock.lastLine),
	};
}

/**
 * First line of the visible block before the one starting at `lineNo`, or
 * null at the top. This is Up in a block selection: it steps into the last
 * child of an open block above, the way Notion does, and over a closed one.
 */
export function previousBlockLine(doc: Text, lineNo: number, hiddenEnd: HiddenEnd = NOTHING_HIDDEN): number | null {
	for (let n = lineNo - 1; n >= 1; n--) {
		if (isBlank(doc.line(n).text) || hiddenEnd(n) !== null) continue;
		return blockSpanAt(doc, n).firstLine;
	}
	return null;
}

/**
 * First line of the visible block after the one starting at `lineNo`, or null
 * at the bottom. An open block's first child counts as the next block; a
 * folded block's hidden children do not.
 */
export function nextBlockLine(doc: Text, lineNo: number, hiddenEnd: HiddenEnd = NOTHING_HIDDEN): number | null {
	// A fence is one block, so the search starts past its closing marker; any
	// other block's children are blocks of their own and are visited.
	const own = resolveDragRange(doc, lineNo, "paragraph");
	let n = own.isFence ? own.lastLine + 1 : lineNo + 1;

	while (n <= doc.lines) {
		const hidden = hiddenEnd(n);
		if (hidden !== null) {
			n = hidden + 1;
			continue;
		}
		// Blank lines separate blocks, and a continuation line belongs to the
		// block that started above it; neither is a block of its own.
		if (!isBlank(doc.line(n).text)) {
			const start = blockSpanAt(doc, n).firstLine;
			if (start > lineNo) return start;
		}
		n++;
	}
	return null;
}

/**
 * The block just above `span` at the same depth, or null when there is none:
 * at the top of the note, or as the first child of its parent.
 */
export function previousSibling(doc: Text, span: LineSpan): LineSpan | null {
	const indent = indentWidth(doc.line(span.firstLine).text);
	let n = span.firstLine - 1;

	while (n >= 1) {
		if (isBlank(doc.line(n).text)) {
			n--;
			continue;
		}
		const range = resolveDragRange(doc, n, "paragraph");
		// Deeper: a child of the sibling (or a fence nested in one). Jump to
		// its start and keep climbing towards the sibling itself.
		if (range.indent > indent) {
			n = range.firstLine - 1;
			continue;
		}
		// Shallower is the parent; nothing at this depth lies above.
		if (range.indent < indent) return null;
		return { firstLine: range.firstLine, lastLine: range.lastLine };
	}
	return null;
}

/** The block just below `span` at the same depth, or null when there is none. */
export function nextSibling(doc: Text, span: LineSpan): LineSpan | null {
	const indent = indentWidth(doc.line(span.firstLine).text);
	let n = span.lastLine + 1;
	while (n <= doc.lines && isBlank(doc.line(n).text)) n++;
	if (n > doc.lines) return null;

	const range = resolveDragRange(doc, n, "paragraph");
	if (range.firstLine !== n || range.indent !== indent) return null;
	return { firstLine: range.firstLine, lastLine: range.lastLine };
}

/** A block edit, plus how far the edited span's own text travelled. */
export interface BlockShift {
	changes: MoveChange[];
	/** Offset added to any position inside the span: where a caret follows. */
	offset: number;
	/** Lines added to the span's line numbers: where a block selection follows. */
	lines: number;
}

/**
 * Cmd+Shift+Up/Down: steps `span` over its previous or next sibling.
 *
 * Null when there is no sibling that way. Notion does nothing there either,
 * rather than changing the block's depth to get it past its parent.
 */
export function planMoveBlock(doc: Text, span: LineSpan, direction: "up" | "down"): BlockShift | null {
	if (direction === "up") {
		const above = previousSibling(doc, span);
		if (!above) return null;
		return {
			changes: planBlockSwap(doc, above, span),
			offset: doc.line(above.firstLine).from - doc.line(span.firstLine).from,
			lines: above.firstLine - span.firstLine,
		};
	}

	const below = nextSibling(doc, span);
	if (!below) return null;
	return {
		changes: planBlockSwap(doc, span, below),
		offset: doc.line(below.lastLine).to - doc.line(span.lastLine).to,
		lines: below.lastLine - span.lastLine,
	};
}

/** Cmd+D: a copy of `span`, children included, directly below it. */
export function planDuplicateBlock(doc: Text, span: LineSpan): BlockShift {
	const from = doc.line(span.firstLine).from;
	const to = doc.line(span.lastLine).to;
	const text = doc.sliceString(from, to);
	return {
		changes: [{ from: to, insert: "\n" + text }],
		offset: text.length + 1,
		lines: span.lastLine - span.firstLine + 1,
	};
}

/**
 * The whole lines of `span`, as copied from a block selection: full lines,
 * children included, without a trailing newline so a paste into an empty
 * line leaves no stray blank behind.
 */
export function blockText(doc: Text, span: LineSpan): string {
	return doc.sliceString(doc.line(span.firstLine).from, doc.line(span.lastLine).to);
}

/**
 * Removes `span` with its line break, leaving no blank line where it was.
 * The caret lands where the blocks used to start.
 */
export function planDeleteBlocks(doc: Text, span: LineSpan): { changes: MoveChange[]; caret: number } {
	const cut = planCut(doc, moveSource(doc, span));
	return { changes: [cut], caret: cut.from };
}

function moveSource(doc: Text, span: LineSpan): MoveSource {
	const from = doc.line(span.firstLine).from;
	const to = doc.line(span.lastLine).to;
	return {
		from,
		to,
		text: doc.sliceString(from, to),
		indent: indentWidth(doc.line(span.firstLine).text),
		firstLine: span.firstLine,
		lastLine: span.lastLine,
	};
}

/**
 * Tab / Shift+Tab on a block selection: every line of `span` one level in or
 * out, so the blocks keep their internal shape.
 *
 * Null when the step is not legal, and the key then does nothing — as in
 * Notion, where Tab on a block with no block above to nest under is ignored.
 * In markdown it matters more than polish: indenting a top-level paragraph
 * under another paragraph turns it into an indented code block. The legal
 * depths are the ones a drag would offer at the block's own position.
 *
 * Indent is added in the document's own style: a tab where the note indents
 * with tabs (Obsidian's default), spaces otherwise. Rewriting tabs as spaces
 * would desynchronise every sibling still indented with tabs.
 */
export function planIndentBlocks(
	doc: Text,
	span: LineSpan,
	unit: number,
	direction: "in" | "out"
): MoveChange[] | null {
	const current = indentWidth(doc.line(span.firstLine).text);
	if (direction === "out" && current === 0) return null;
	if (direction === "in" && !allowedIndents(doc, span.firstLine, unit, span).includes(current + unit)) {
		return null;
	}

	const step = indentsWithTabs(doc) ? "\t" : " ".repeat(unit);
	const changes: MoveChange[] = [];

	for (let n = span.firstLine; n <= span.lastLine; n++) {
		const line = doc.line(n);
		// Blank lines inside the span stay blank rather than collecting
		// whitespace.
		if (isBlank(line.text)) continue;
		if (direction === "in") {
			changes.push({ from: line.from, insert: step });
			continue;
		}
		const removed = outdentWidth(indentString(line.text), unit);
		if (removed > 0) changes.push({ from: line.from, to: line.from + removed });
	}
	return changes;
}

/**
 * Characters to strip for one level out: a leading tab, or up to one unit of
 * spaces. The same rule Backspace uses to step out of a nested item.
 */
function outdentWidth(indent: string, unit: number): number {
	if (indent.startsWith("\t")) return 1;
	return Math.min(unit, indent.length - indent.replace(/^ +/, "").length);
}

/** Whether the note's first indented line indents with a tab. */
export function indentsWithTabs(doc: Text): boolean {
	const limit = Math.min(doc.lines, 500); // enough to infer, cheap to scan
	for (let n = 1; n <= limit; n++) {
		const indent = indentString(doc.line(n).text);
		if (indent.length > 0 && !isBlank(doc.line(n).text)) return indent.startsWith("\t");
	}
	return false;
}

/**
 * The anchor and head of an Esc block selection, as the first lines of the
 * block each end sits on. Shift+Up/Down moves the head; the anchor stays.
 */
export interface BlockSelectionEnds {
	anchor: number;
	head: number;
}

/** The lines a block selection covers: both end blocks and everything between. */
export function blockSelectionSpan(doc: Text, ends: BlockSelectionEnds): LineSpan {
	const anchor = blockSpanAt(doc, ends.anchor);
	const head = blockSpanAt(doc, ends.head);
	return {
		firstLine: Math.min(anchor.firstLine, head.firstLine),
		lastLine: Math.max(anchor.lastLine, head.lastLine),
	};
}

/**
 * The editor selection that stands for a block selection: whole lines, edge
 * to edge. Native copy, paste and drag then act on exactly the blocks shown.
 */
export function spanRange(doc: Text, span: LineSpan): { from: number; to: number } {
	return { from: doc.line(span.firstLine).from, to: doc.line(span.lastLine).to };
}
