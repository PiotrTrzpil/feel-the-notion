/**
 * The explorer stylesheet: paths become selectors safely, whatever they hold.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildExplorerCss, cssString } from "./.build/explorerStyles.js";

const empty = {
	hiddenFiles: [],
	pageFolders: [],
	fileIcons: new Map(),
	folderIcons: new Map(),
	defaultPageIcon: null,
	defaultFolderIcon: null,
	activeFolder: null,
};

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
	assert.match(css, /\.nav-file-title\[data-path="Rome\.md"\] \.nav-file-title-content::before \{ content: "🇮🇹"; /);
	assert.match(css, /\.nav-folder-title\[data-path="Work"\] \.nav-folder-title-content::before \{ content: "";.*mask: url\("x"\)/);
});

test("a page with no icon gets a generic page icon, and a chosen icon replaces it", () => {
	const css = buildExplorerCss({
		...empty,
		pageFolders: ["Travel"],
		defaultPageIcon: { kind: "mask", url: 'url("page")' },
		fileIcons: new Map([["Rome.md", { kind: "text", text: "🇮🇹" }]]),
		folderIcons: new Map([["Travel", { kind: "mask", url: 'url("plane")' }]]),
	});
	const generic = css.indexOf('[data-path$=".md"]');
	assert.ok(generic !== -1 && generic < css.indexOf('"🇮🇹"') && generic < css.indexOf('url("plane")'));
	assert.match(css, /\[data-path\$="\.md"\][^\n]*url\("page"\)/);
	assert.match(css, /\[data-path="Travel"\][^\n]*url\("page"\)/);
	assert.match(css, /content: "🇮🇹"; width: auto; height: auto; line-height: inherit;.*transform: none;.*mask: none;/);
	assert.match(css, /line-height: 1; vertical-align: baseline; transform: translateY\(0\.15em\)/);
});

test("a plain folder gets a directory icon, and a folder note keeps its page icon", () => {
	const css = buildExplorerCss({
		...empty,
		pageFolders: ["Travel"],
		defaultPageIcon: { kind: "mask", url: 'url("page")' },
		defaultFolderIcon: { kind: "mask", url: 'url("folder")' },
	});
	assert.match(css, /\.nav-folder-title \.nav-folder-title-content::before \{[^}]*url\("folder"\)/);
	assert.match(css, /\[data-path="Travel"\][^\n]*url\("page"\)/);
});

test("the open folder note highlights its folder", () => {
	const css = buildExplorerCss({ ...empty, activeFolder: "Travel" });
	assert.match(css, /\.nav-folder-title\[data-path="Travel"\] \{ background-color: var\(--nav-item-background-active\)/);
});
