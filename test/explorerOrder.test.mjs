/**
 * A folder note's children follow the note: linked sub-pages first, in the
 * order the note links them, then the rest by name.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { childForTarget, orderSubpages } from "./.build/explorerOrder.js";

const children = [
	{ path: "Travel/Page 10.md", name: "Page 10", page: true },
	{ path: "Travel/Paris", name: "Paris", page: true },
	{ path: "Travel/Page 2.md", name: "Page 2", page: true },
	{ path: "Travel/alpha.png", name: "alpha.png", page: false },
	{ path: "Travel/beta.pdf", name: "beta.pdf", page: false },
];

test("a link names the child it points at", () => {
	assert.equal(childForTarget("Travel", "Travel/Rome.md", "Travel/Travel.md"), "Travel/Rome.md");
	assert.equal(childForTarget("Travel", "Travel/Paris/Hotel.md", "Travel/Travel.md"), "Travel/Paris");
	assert.equal(childForTarget("Travel", "Travel/Paris/Paris.md", "Travel/Travel.md"), "Travel/Paris");
});

test("the folder's own note, a file, and an outside note are not sub-pages", () => {
	assert.equal(childForTarget("Travel", "Travel/Travel.md", "Travel/Travel.md"), null);
	assert.equal(childForTarget("Travel", "Travel/photo.png", "Travel/Travel.md"), null);
	assert.equal(childForTarget("Travel", "Other/Rome.md", "Travel/Travel.md"), null);
	assert.equal(childForTarget("Travel", "Travelogue/Rome.md", "Travel/Travel.md"), null);
});

test("linked sub-pages come first, in the note's order, and the rest follow by name", () => {
	const ordered = orderSubpages(children, ["Travel/Page 10.md", "Travel/Paris", "Travel/Page 10.md", "Missing"]);
	assert.deepEqual(ordered.map((child) => child.path), [
		"Travel/Page 10.md",
		"Travel/Paris",
		"Travel/Page 2.md",
		"Travel/alpha.png",
		"Travel/beta.pdf",
	]);
});

test("a note that links nothing lists pages by name, files after them", () => {
	const ordered = orderSubpages(children, []);
	assert.deepEqual(ordered.map((child) => child.name), ["Page 2", "Page 10", "Paris", "alpha.png", "beta.pdf"]);
});
