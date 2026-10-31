/**
 * Template variables, and what counts as an empty page to fill.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { fillTemplate, isEmptyPage, splitFrontmatter } from "./.build/pageTemplate.js";

const ctx = {
	title: "Rome",
	dateFormat: "YYYY-MM-DD",
	timeFormat: "HH:mm",
	format: (pattern) => `<${pattern}>`,
};

test("title, date and time fill in with the configured formats", () => {
	assert.equal(fillTemplate("# {{title}}\n{{date}} {{time}}", ctx), "# Rome\n<YYYY-MM-DD> <HH:mm>");
});

test("a format after the colon overrides the default", () => {
	assert.equal(fillTemplate("{{date:dddd}} {{ time : HH }}", ctx), "<dddd> <HH>");
});

test("unknown variables are left for the reader to see", () => {
	assert.equal(fillTemplate("{{author}}", ctx), "{{author}}");
});

test("frontmatter splits from the body", () => {
	assert.deepEqual(splitFrontmatter("---\nicon: x\n---\nBody"), { frontmatter: "icon: x", body: "Body" });
	assert.deepEqual(splitFrontmatter("Body"), { frontmatter: null, body: "Body" });
});

test("a page with only frontmatter is empty", () => {
	assert.equal(isEmptyPage(""), true);
	assert.equal(isEmptyPage("---\nicon: 🌅\n---\n\n"), true);
	assert.equal(isEmptyPage("---\nicon: 🌅\n---\ntext"), false);
});
