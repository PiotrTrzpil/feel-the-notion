/**
 * Which links are page blocks: sub-pages, pages nested under them, and a
 * link that owns its line.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { isNestedPage, isWholeLineLink, subpageFolderOf } from "./.build/pageLink.js";

test("a folder note keeps its sub-pages in its own folder", () => {
	assert.equal(subpageFolderOf("Travel/Travel.md"), "Travel");
	assert.equal(subpageFolderOf("Travel/Madeira/Madeira.md"), "Travel/Madeira");
});

test("a plain note's sub-pages live in a folder of its name", () => {
	assert.equal(subpageFolderOf("Notes/Trip.md"), "Notes/Trip");
	assert.equal(subpageFolderOf("Home.md"), "Home");
});

test("a folder note's sub-page and the pages nested under it are page blocks", () => {
	assert.equal(isNestedPage("Travel/Travel.md", "Travel/Paris.md"), true);
	assert.equal(isNestedPage("Travel/Travel.md", "Travel/Paris/Paris.md"), true);
	assert.equal(isNestedPage("Travel/Travel.md", "Travel/Paris/Hotel.md"), true);
});

test("a page is not a sub-page of itself", () => {
	assert.equal(isNestedPage("Travel/Travel.md", "Travel/Travel.md"), false);
	assert.equal(isNestedPage("Notes/Trip.md", "Notes/Trip.md"), false);
});

test("a plain note links to pages inside its own folder", () => {
	assert.equal(isNestedPage("Notes/Trip.md", "Notes/Trip/Day.md"), true);
	assert.equal(isNestedPage("Notes/Trip.md", "Notes/Trip/Day/Day.md"), true);
	assert.equal(isNestedPage("Notes/Trip.md", "Notes/Other.md"), false);
	assert.equal(isNestedPage("Home.md", "Home/Intro.md"), true);
	assert.equal(isNestedPage("Home.md", "Elsewhere.md"), false);
});

test("a sub-page's own children count, and its siblings do not", () => {
	assert.equal(isNestedPage("Travel/Paris.md", "Travel/Paris/Hotel.md"), true);
	assert.equal(isNestedPage("Travel/Paris.md", "Travel/Rome.md"), false);
});

test("a folder note links to its own children, not its parent's other pages", () => {
	assert.equal(isNestedPage("Travel/Paris/Paris.md", "Travel/Paris/Hotel.md"), true);
	assert.equal(isNestedPage("Travel/Paris/Paris.md", "Travel/Rome.md"), false);
});

test("only a markdown note can be a page block", () => {
	assert.equal(isNestedPage("Travel/Travel.md", "Travel/photo.jpg"), false);
	assert.equal(isNestedPage("", "Travel/Paris.md"), false);
});

test("a link that owns its line is a block", () => {
	const link = (line) => {
		const from = line.indexOf("[[");
		return isWholeLineLink(line, from, from + "[[Paris]]".length);
	};
	assert.equal(link("[[Paris]]"), true);
	assert.equal(link("  [[Paris]]"), true);
	assert.equal(link("- [[Paris]]"), true);
	assert.equal(link("    - [[Paris]]"), true);
	assert.equal(link("> [[Paris]]"), true);
	assert.equal(link("> - [[Paris]]"), true);
	assert.equal(link("1. [[Paris]]"), true);
	assert.equal(link("- [ ] [[Paris]]"), true);
	assert.equal(link("- [x] [[Paris]]"), true);
});

test("a link that shares its line stays a chip", () => {
	const at = (line, token) => {
		const from = line.indexOf(token);
		return isWholeLineLink(line, from, from + token.length);
	};
	assert.equal(at("see [[Paris]] today", "[[Paris]]"), false);
	assert.equal(at("[[Paris]] and more", "[[Paris]]"), false);
	assert.equal(at("[[Paris]] [[Rome]]", "[[Paris]]"), false);
	assert.equal(at("> [!toggle]- [[Paris]]", "[[Paris]]"), false);
});
