/**
 * Which line's number the hover handle hides, and that it stays on the same
 * line while text is edited above it.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { gutterLineClass } from "@codemirror/view";
import { handleLineField, setHandleLine } from "./.build/handleGutter.js";

const doc = "one\ntwo\nthree";

function marked(state) {
	const lines = [];
	for (const set of state.facet(gutterLineClass)) {
		set.between(0, state.doc.length, (from) => {
			lines.push(state.doc.lineAt(from).number);
		});
	}
	return lines;
}

test("no handle hides nothing", () => {
	const state = EditorState.create({ doc, extensions: [handleLineField] });
	assert.deepEqual(marked(state), []);
});

test("the handle's line is marked, and cleared again", () => {
	let state = EditorState.create({ doc, extensions: [handleLineField] });
	state = state.update({ effects: setHandleLine.of(state.doc.line(2).from) }).state;
	assert.deepEqual(marked(state), [2]);
	state = state.update({ effects: setHandleLine.of(null) }).state;
	assert.deepEqual(marked(state), []);
});

test("an edit above keeps the mark on the same text", () => {
	let state = EditorState.create({ doc, extensions: [handleLineField] });
	state = state.update({ effects: setHandleLine.of(state.doc.line(3).from) }).state;
	state = state.update({ changes: { from: 0, insert: "zero\n" } }).state;
	assert.deepEqual(marked(state), [4]);
});
