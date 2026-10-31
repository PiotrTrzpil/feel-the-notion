/**
 * Page block text: a database over any folder name stays valid YAML.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { databaseBlock, subpagesBlock } from "./.build/pageBlocks.js";

test("the sub-pages block is an empty fence", () => {
	assert.equal(subpagesBlock(), "```subpages\n```");
});

test("the database filters on the folder and leaves out its own note", () => {
	const block = databaseBlock("Travel/Madeira");
	assert.match(block, /^```base\n/);
	assert.match(block, /- 'file\.inFolder\("Travel\/Madeira"\)'/);
	assert.match(block, /- 'file\.path != this\.file\.path'/);
	assert.match(block, /\n```$/);
});

test("quotes in a folder name cannot end the YAML string", () => {
	assert.match(databaseBlock("Bob's: \"notes\""), /- 'file\.inFolder\("Bob''s: \\"notes\\""\)'/);
});
