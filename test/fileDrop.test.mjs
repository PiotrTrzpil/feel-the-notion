/**
 * Moving a block onto another note: assert both resulting documents as TEXT,
 * the same way planMove.test.mjs does for in-note drags.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { resolveDragRange } from "./.build/dragRange.js";
import { applyChanges } from "./.build/planMove.js";
import { appendBlock, findLinks, planCut, rewriteLinks } from "./.build/fileDrop.js";

/** Grabs `fromLine` of `lines` and moves it to the end of `target`. */
function moveTo(lines, fromLine, target) {
	const text = lines.join("\n");
	const doc = EditorState.create({ doc: text }).doc;
	const range = resolveDragRange(doc, fromLine, "paragraph");
	const source = {
		from: range.from,
		to: range.to,
		text: doc.sliceString(range.from, range.to),
		indent: range.indent,
		firstLine: range.firstLine,
		lastLine: range.lastLine,
	};
	return {
		source: applyChanges(text, [planCut(doc, source)]),
		target: appendBlock(target, source.text, source.indent),
	};
}

test("an image embed moves to the end of another note", () => {
	const out = moveTo(["Intro", "", "![[photo.jpg]]", "", "Outro"], 3, "# Other\n\nText\n");
	assert.equal(out.source, "Intro\n\n\nOutro");
	assert.equal(out.target, "# Other\n\nText\n\n![[photo.jpg]]\n");
});

test("the last block leaves no trailing line behind", () => {
	const out = moveTo(["Intro", "![[photo.jpg]]"], 2, "Other");
	assert.equal(out.source, "Intro");
	assert.equal(out.target, "Other\n\n![[photo.jpg]]\n");
});

test("an empty target note gets just the block", () => {
	assert.equal(appendBlock("", "Hello", 0), "Hello\n");
	assert.equal(appendBlock("\n\n", "Hello", 0), "Hello\n");
});

test("a nested list item lands at column zero with its children", () => {
	const out = moveTo(["- a", "    - b", "        - c", "- d"], 2, "");
	assert.equal(out.source, "- a\n- d");
	assert.equal(out.target, "- b\n    - c\n");
});

test("wiki links and embeds give path, subpath and alias", () => {
	const links = findLinks("See [[Note#Head|here]] and ![[_attachments/photo.jpg|300]].");
	assert.deepEqual(
		links.map(({ embed, path, subpath, alias }) => ({ embed, path, subpath, alias })),
		[
			{ embed: false, path: "Note", subpath: "#Head", alias: "here" },
			{ embed: true, path: "_attachments/photo.jpg", subpath: "", alias: "300" },
		]
	);
});

test("markdown links are decoded; URLs are not vault links", () => {
	const links = findLinks("![](_attachments/my%20photo.png) [doc](<files/a b.pdf#page=2>) [web](https://x.y/z.png)");
	assert.deepEqual(
		links.map(({ embed, path, subpath, alias }) => ({ embed, path, subpath, alias })),
		[
			{ embed: true, path: "_attachments/my photo.png", subpath: "", alias: "" },
			{ embed: false, path: "files/a b.pdf", subpath: "#page=2", alias: "doc" },
		]
	);
});

test("rewriteLinks swaps only the links it is given text for", () => {
	const text = "a ![[x.png]] b [[y]] c ![[z.png]]";
	const out = rewriteLinks(text, findLinks(text), (link) =>
		link.path.endsWith(".png") ? `![[new/${link.path}]]` : null
	);
	assert.equal(out, "a ![[new/x.png]] b [[y]] c ![[new/z.png]]");
});
