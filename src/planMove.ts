import { ChangeSet, Text } from "@codemirror/state";
import { LineSpan, reindentBlock } from "./dragRange";
import { planCut } from "./fileDrop";

/**
 * Works out the exact edits that move a block, as a single change set.
 *
 * Extracted from DragManager so the newline arithmetic can be tested against
 * resulting document TEXT rather than reasoned about. Off-by-one errors here
 * do not throw — they silently leave a stray blank line or glue two blocks
 * together, which is exactly the class of bug that reached the user.
 */

export interface MoveSource {
	from: number;
	to: number;
	text: string;
	indent: number;
	firstLine: number;
	lastLine: number;
}

export interface MoveChange {
	from: number;
	to?: number;
	insert?: string;
}

/**
 * Whether dropping `source` before `toLineNo` at `targetIndent` changes
 * nothing.
 *
 * Strictly inside its own span is always a no-op. On its own edges — its first
 * line, or the line after its last — it is a no-op only at its current depth:
 * at a new depth it is a re-indent in place, which is how the last child of a
 * list steps out to its parent's level.
 *
 * Cheap enough to run every pointer frame, which is what lets the drag hide
 * its indicator over a drop that would do nothing.
 */
export function isNoOpMove(source: MoveSource, toLineNo: number, targetIndent: number): boolean {
	if (toLineNo > source.firstLine && toLineNo <= source.lastLine) return true;
	const atOwnEdge = toLineNo === source.firstLine || toLineNo === source.lastLine + 1;
	return atOwnEdge && targetIndent === source.indent;
}

/**
 * Returns the changes that move `source` so it lands before `toLineNo`, at
 * `targetIndent`. Returns an empty array when the move is a no-op.
 *
 * Both edits are returned together so they apply as one transaction: one undo
 * step, and no intermediate state where the block exists twice or not at all.
 */
export function planBlockMove(
	doc: Text,
	source: MoveSource,
	toLineNo: number,
	targetIndent: number
): MoveChange[] {
	// The no-op test runs first. Dropping exactly at the block's own first line
	// used to emit an insert and a delete that both started at that offset:
	// they overlap, CodeMirror rejects overlapping changes, and the string
	// simulation instead produced a document with a stray leading blank line.
	if (isNoOpMove(source, toLineNo, targetIndent)) return [];

	const text = reindentBlock(source.text, source.indent, targetIndent);

	// On its own edge at a new depth: rewrite the block where it stands. One
	// change, so there is nothing to overlap.
	if (toLineNo === source.firstLine || toLineNo === source.lastLine + 1) {
		return [{ from: source.from, to: source.to, insert: text }];
	}

	const cut = planCut(doc, source);

	// Appending past the last line.
	if (toLineNo > doc.lines) {
		return [{ from: doc.length, insert: "\n" + text }, cut];
	}

	const toLine = doc.line(toLineNo);

	return [{ from: toLine.from, insert: text + "\n" }, cut];
}

/**
 * Swaps two sibling blocks, `upper` above `lower`, as one change.
 *
 * The keyboard move (Cmd+Shift+Up/Down) uses this rather than planBlockMove.
 * A drag drops a block BEFORE a line, so when blank lines separate the two
 * blocks the move carries the gap along: "alpha, blank, bravo" dragged below
 * bravo becomes "blank, bravo, alpha". Stepping one sibling over another has
 * to leave the document's spacing where it was, so whatever lies between the
 * two spans stays between them.
 *
 * One replacement over both spans, so there is nothing to overlap and the
 * whole step is a single undo entry.
 */
export function planBlockSwap(doc: Text, upper: LineSpan, lower: LineSpan): MoveChange[] {
	const upperFrom = doc.line(upper.firstLine).from;
	const upperTo = doc.line(upper.lastLine).to;
	const lowerFrom = doc.line(lower.firstLine).from;
	const lowerTo = doc.line(lower.lastLine).to;
	const gap = doc.sliceString(upperTo, lowerFrom);
	return [
		{
			from: upperFrom,
			to: lowerTo,
			insert: doc.sliceString(lowerFrom, lowerTo) + gap + doc.sliceString(upperFrom, upperTo),
		},
	];
}

/**
 * Where the moved block sits in the document AFTER `changes` apply, excluding
 * the newline that separates it from its neighbours.
 *
 * Relies on planBlockMove's shape: the first change is always the one carrying
 * the block's text. A selection drag uses this to re-select what it moved, the
 * way Notion leaves a dropped block selected.
 */
export function movedBlockRange(doc: Text, changes: MoveChange[]): { from: number; to: number } | null {
	if (changes.length === 0) return null;

	const carrier = changes[0];
	const inserted = carrier.insert ?? "";
	const set = ChangeSet.of(
		changes.map((c) => ({ from: c.from, to: c.to ?? c.from, insert: c.insert ?? "" })),
		doc.length
	);

	// An append carries its separator in front ("\n" + text); every other
	// move carries it behind (text + "\n"); a re-indent in place carries none.
	const lead = inserted.startsWith("\n") ? 1 : 0;
	const trail = !lead && carrier.to === undefined && inserted.endsWith("\n") ? 1 : 0;

	// -1: the position BEFORE the inserted text, not after it.
	const from = set.mapPos(carrier.from, -1) + lead;
	return { from, to: from + inserted.length - lead - trail };
}

/**
 * Applies planned changes to a plain string. Test helper only — the editor
 * applies them through CodeMirror — but it lets tests assert on the document
 * a user would actually see.
 */
export function applyChanges(docText: string, changes: MoveChange[]): string {
	// Apply from the end backwards so earlier offsets stay valid.
	//
	// Ties are applied in reverse listed order, which is what makes two inserts
	// at the same offset land in the order they were written — CodeMirror's own
	// rule, and one that matters when a block insert and its footnote
	// definition both land at the end of the document.
	const ordered = changes
		.map((change, index) => ({ change, index }))
		.sort((a, b) => b.change.from - a.change.from || b.index - a.index)
		.map((entry) => entry.change);
	let out = docText;
	for (const change of ordered) {
		const to = change.to ?? change.from;
		out = out.slice(0, change.from) + (change.insert ?? "") + out.slice(to);
	}
	return out;
}
