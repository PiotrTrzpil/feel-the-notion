/**
 * Tests for Notion's block keys: Cmd+Shift+Up/Down, Cmd+D, and the Esc block
 * selection (navigate, extend, delete, indent).
 *
 * Like the drag tests, these assert on the finished document TEXT. A move
 * that loses a blank line or glues two blocks together does not throw; it
 * only shows up in the text the user is left with.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, EditorSelection } from "@codemirror/state";
import {
	blockSelectionSpan,
	blockText,
	indentsWithTabs,
	nextBlockLine,
	nextSibling,
	planDeleteBlocks,
	planDuplicateBlock,
	planIndentBlocks,
	planMoveBlock,
	previousBlockLine,
	previousSibling,
	touchedBlocks,
} from "./.build/blockKeys.js";
import { applyChanges, planBlockSwap } from "./.build/planMove.js";
import { blockSelectionField, setBlockSelection } from "./.build/blockSelection.js";

const docOf = (lines) => EditorState.create({ doc: lines.join("\n") }).doc;
const span = (firstLine, lastLine = firstLine) => ({ firstLine, lastLine });

/** Moves `s` up or down and returns the resulting lines, or null for no move. */
function move(lines, s, direction) {
	const plan = planMoveBlock(docOf(lines), s, direction);
	if (!plan) return null;
	return applyChanges(lines.join("\n"), plan.changes).split("\n");
}

// ── moving past a sibling ──────────────────────────────────────────────────

test("a list item moves down past its next sibling", () => {
	assert.deepEqual(move(["- a", "- b", "- c"], span(1), "down"), ["- b", "- a", "- c"]);
});

test("a list item moves up past its previous sibling", () => {
	assert.deepEqual(move(["- a", "- b", "- c"], span(3), "up"), ["- a", "- c", "- b"]);
});

test("children travel with their parent", () => {
	assert.deepEqual(
		move(["- a", "    - a1", "    - a2", "- b"], span(1, 3), "down"),
		["- b", "- a", "    - a1", "    - a2"]
	);
});

test("moving up steps over the whole previous sibling, children and all", () => {
	assert.deepEqual(
		move(["- a", "    - a1", "- b"], span(3), "up"),
		["- b", "- a", "    - a1"]
	);
});

test("blank lines between paragraphs stay where they were", () => {
	// A drag would carry the gap along; a keyboard step must not.
	assert.deepEqual(move(["alpha", "", "bravo", "", "charlie"], span(1), "down"), [
		"bravo",
		"",
		"alpha",
		"",
		"charlie",
	]);
	assert.deepEqual(move(["alpha", "", "bravo"], span(3), "up"), ["bravo", "", "alpha"]);
});

test("the first child does not climb out of its parent", () => {
	assert.equal(move(["- a", "    - b", "    - c"], span(2), "up"), null);
});

test("the last child does not fall out of its parent", () => {
	assert.equal(move(["- a", "    - b", "- c"], span(2), "down"), null);
});

test("nothing moves past the top or bottom of the note", () => {
	assert.equal(move(["- a", "- b"], span(1), "up"), null);
	assert.equal(move(["- a", "- b"], span(2), "down"), null);
});

test("a fenced code block is one sibling", () => {
	const lines = ["- a", "```", "code", "```", "after"];
	assert.deepEqual(move(lines, span(5), "up"), ["- a", "after", "```", "code", "```"]);
	assert.deepEqual(move(lines, span(2, 4), "down"), ["- a", "after", "```", "code", "```"]);
});

test("a code line that looks shallow does not hide a nested fence's owner", () => {
	// The fence belongs to "- a"; its unindented code line must not read as a
	// parent of "- b" and block the move.
	const lines = ["- a", "    ```", "x = 1", "    ```", "- b"];
	assert.equal(previousSibling(docOf(lines), span(5))?.firstLine, 1);
});

test("the moved text lands where offset and lines say", () => {
	const lines = ["- a", "", "- bravo", "    - child", "- c"];
	const doc = docOf(lines);
	for (const [s, direction] of [[span(1), "down"], [span(3, 4), "up"], [span(3, 4), "down"]]) {
		const plan = planMoveBlock(doc, s, direction);
		const out = applyChanges(lines.join("\n"), plan.changes);
		const from = doc.line(s.firstLine).from + plan.offset;
		const text = blockText(doc, s);
		assert.equal(out.slice(from, from + text.length), text, `${direction} from line ${s.firstLine}`);
		const outDoc = EditorState.create({ doc: out }).doc;
		assert.equal(outDoc.line(s.firstLine + plan.lines).from, from, "line shift agrees with offset");
	}
});

test("planBlockSwap keeps the gap between the two spans", () => {
	const doc = docOf(["- a", "", "", "- b"]);
	assert.equal(applyChanges(doc.toString(), planBlockSwap(doc, span(1), span(4))), "- b\n\n\n- a");
});

test("nextSibling refuses a shallower line", () => {
	assert.equal(nextSibling(docOf(["- a", "    - b", "- c"]), span(2)), null);
});

// ── which blocks a selection touches ───────────────────────────────────────

test("a caret touches its block, children included", () => {
	const doc = docOf(["- a", "    - b", "- c"]);
	assert.deepEqual(touchedBlocks(doc, EditorSelection.cursor(1)), span(1, 2));
});

test("a selection across blocks touches every one, plus the last one's children", () => {
	const doc = docOf(["- a", "- b", "    - b1", "- c"]);
	assert.deepEqual(touchedBlocks(doc, EditorSelection.range(1, doc.line(2).from + 2)), span(1, 3));
});

test("a selection ending at a line start does not touch that line", () => {
	const doc = docOf(["- a", "- b", "- c"]);
	assert.deepEqual(touchedBlocks(doc, EditorSelection.range(0, doc.line(2).from)), span(1));
});

// ── duplicate ──────────────────────────────────────────────────────────────

test("Cmd+D puts a copy, children included, directly below", () => {
	const lines = ["- a", "    - a1", "- b"];
	const doc = docOf(lines);
	const plan = planDuplicateBlock(doc, span(1, 2));
	assert.deepEqual(applyChanges(lines.join("\n"), plan.changes).split("\n"), [
		"- a",
		"    - a1",
		"- a",
		"    - a1",
		"- b",
	]);
	assert.equal(plan.lines, 2);
	assert.equal(plan.offset, "- a\n    - a1\n".length, "a caret lands in the copy at the same place");
});

test("Cmd+D on the last line of the note", () => {
	const plan = planDuplicateBlock(docOf(["x", "last"]), span(2));
	assert.equal(applyChanges("x\nlast", plan.changes), "x\nlast\nlast");
});

// ── block selection: navigation ────────────────────────────────────────────

const OUTLINE = [
	"- a", // 1
	"    - a1", // 2
	"", // 3
	"- b", // 4
	"```", // 5
	"code", // 6
	"```", // 7
	"end", // 8
];

test("Down visits an open block's children, then skips blank lines", () => {
	const doc = docOf(OUTLINE);
	assert.equal(nextBlockLine(doc, 1), 2);
	assert.equal(nextBlockLine(doc, 2), 4);
});

test("Down treats a fence as one block", () => {
	const doc = docOf(OUTLINE);
	assert.equal(nextBlockLine(doc, 4), 5);
	assert.equal(nextBlockLine(doc, 5), 8);
	assert.equal(nextBlockLine(doc, 8), null);
});

test("Up lands on a fence's first line and on the last visible child", () => {
	const doc = docOf(OUTLINE);
	assert.equal(previousBlockLine(doc, 8), 5);
	assert.equal(previousBlockLine(doc, 4), 2);
	assert.equal(previousBlockLine(doc, 1), null);
});

test("folded children are skipped both ways", () => {
	const doc = docOf(OUTLINE);
	const hidden = (n) => (n === 2 ? 2 : null); // "- a" is folded
	assert.equal(nextBlockLine(doc, 1, hidden), 4);
	assert.equal(previousBlockLine(doc, 4, hidden), 1);
});

test("a continuation line is not a block of its own", () => {
	const doc = docOf(["para", "    continued", "next"]);
	assert.equal(nextBlockLine(doc, 1), 3);
	assert.equal(previousBlockLine(doc, 3), 1);
});

test("a block selection covers both end blocks and everything between", () => {
	const doc = docOf(OUTLINE);
	assert.deepEqual(blockSelectionSpan(doc, { anchor: 1, head: 1 }), span(1, 2));
	assert.deepEqual(blockSelectionSpan(doc, { anchor: 4, head: 1 }), span(1, 4));
	assert.deepEqual(blockSelectionSpan(doc, { anchor: 4, head: 5 }), span(4, 7));
});

// ── block selection: delete, copy, indent ──────────────────────────────────

test("deleting selected blocks leaves no blank line behind", () => {
	const lines = ["- a", "    - a1", "- b"];
	const plan = planDeleteBlocks(docOf(lines), span(1, 2));
	assert.equal(applyChanges(lines.join("\n"), plan.changes), "- b");
	assert.equal(plan.caret, 0);
});

test("deleting the last blocks takes the preceding newline instead", () => {
	const plan = planDeleteBlocks(docOf(["- a", "- b"]), span(2));
	assert.equal(applyChanges("- a\n- b", plan.changes), "- a");
	assert.equal(plan.caret, 3);
});

test("copying blocks takes full lines without a trailing newline", () => {
	assert.equal(blockText(docOf(["- a", "    - a1", "- b"]), span(1, 2)), "- a\n    - a1");
});

function indent(lines, s, direction, unit = 4) {
	const plan = planIndentBlocks(docOf(lines), s, unit, direction);
	return plan && applyChanges(lines.join("\n"), plan).split("\n");
}

test("Tab nests a block, children included, under the item above", () => {
	assert.deepEqual(indent(["- a", "- b", "    - b1"], span(2, 3), "in"), ["- a", "    - b", "        - b1"]);
});

test("Tab uses the note's tabs when it indents with tabs", () => {
	assert.deepEqual(indent(["- a", "\t- x", "- b"], span(3), "in"), ["- a", "\t- x", "\t- b"]);
	assert.equal(indentsWithTabs(docOf(["- a", "\t- x"])), true);
	assert.equal(indentsWithTabs(docOf(["- a", "  - x"])), false);
});

test("Tab refuses to nest where markdown would not", () => {
	assert.equal(indent(["- a"], span(1), "in"), null, "nothing above");
	assert.equal(indent(["alpha", "bravo"], span(2), "in"), null, "under prose it becomes a code block");
	assert.equal(indent(["- a", "    - b", "    - c"], span(3), "in", 4) !== null, true);
	assert.equal(indent(["- a", "    - b"], span(2), "in"), null, "two levels past the parent");
});

test("Shift+Tab steps out one level, and not past the margin", () => {
	assert.deepEqual(indent(["- a", "    - b", "        - c"], span(2, 3), "out"), ["- a", "- b", "    - c"]);
	assert.deepEqual(indent(["- a", "\t- b"], span(2), "out"), ["- a", "- b"]);
	assert.equal(indent(["- a"], span(1), "out"), null);
});

test("indenting leaves blank lines inside the span blank", () => {
	assert.deepEqual(indent(["- a", "- b", "", "    more"], span(2, 2), "in"), ["- a", "    - b", "", "    more"]);
});

// ── the block selection state ──────────────────────────────────────────────

test("the block selection survives only its own transactions", () => {
	let state = EditorState.create({ doc: "- a\n- b", extensions: [blockSelectionField] });
	const blocks = { anchor: 1, head: 1, caret: 0 };

	state = state.update({ effects: setBlockSelection.of(blocks), selection: EditorSelection.single(0, 3) }).state;
	assert.deepEqual(state.field(blockSelectionField), blocks);

	state = state.update({ effects: [] }).state;
	assert.deepEqual(state.field(blockSelectionField), blocks, "an unrelated transaction keeps it");

	const moved = state.update({ selection: EditorSelection.cursor(5) }).state;
	assert.equal(moved.field(blockSelectionField), null, "a click elsewhere leaves block mode");

	const edited = state.update({ changes: { from: 7, insert: "!" } }).state;
	assert.equal(edited.field(blockSelectionField), null, "so does an edit");
});
