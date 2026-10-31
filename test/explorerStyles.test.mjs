/**
 * The explorer stylesheet: paths become selectors safely, whatever they hold.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildExplorerCss, cssString } from "./.build/explorerStyles.js";

const empty = { hiddenFiles: [], pageFolders: [], fileIcons: new Map(), folderIcons: new Map(), activeFolder: null };

test("nothing to decorate is an empty stylesheet", () => {
	assert.equal(buildExplorerCss(empty), "");
});

test("quotes and backslashes in names cannot break out of the string", () => {
	assert.equal(cssString('a"b\\c'), '"a\\"b\\\\c"');
});

test("folder notes are hidden by their own path", () => {
	const css = buildExplorerCss({ ...empty, hiddenFiles: ["Travel/Travel.md"] });
	assert.match(css, /\.nav-file:has\(> \.nav-file-title\[data-path="Travel\/Travel\.md"\]\) \{ display: none; \}/);
});

test("an emoji icon is drawn as content, a Lucide one as a mask", () => {
	const css = buildExplorerCss({
		...empty,
		fileIcons: new Map([["Rome.md", { kind: "text", text: "🇮🇹" }]]),
		folderIcons: new Map([["Work", { kind: "mask", url: 'url("x")' }]]),
	});
	assert.match(css, /\.nav-file-title\[data-path="Rome\.md"\] \.nav-file-title-content::before \{ content: "🇮🇹"; \}/);
	assert.match(css, /\.nav-folder-title\[data-path="Work"\] \.nav-folder-title-content::before \{ content: "";.*mask: url\("x"\)/);
});

test("the open folder note highlights its folder", () => {
	const css = buildExplorerCss({ ...empty, activeFolder: "Travel" });
	assert.match(css, /\.nav-folder-title\[data-path="Travel"\] \{ background-color: var\(--nav-item-background-active\)/);
});
