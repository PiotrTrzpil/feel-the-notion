/**
 * Page icon and cover frontmatter, in the formats Iconize and Pixel Banner
 * already wrote into existing notes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { clampPercent, containsEmoji, formatIcon, parseCover, parseIcon, withCssClass } from "./.build/pageMeta.js";

test("an emoji icon is text", () => {
	assert.deepEqual(parseIcon("🇵🇹"), { kind: "text", text: "🇵🇹" });
	assert.deepEqual(parseIcon(" 📕 "), { kind: "text", text: "📕" });
});

test("no icon, or not a string, is none", () => {
	assert.equal(parseIcon(undefined), null);
	assert.equal(parseIcon(""), null);
	assert.equal(parseIcon(3), null);
});

test("Lucide icons read in both our spelling and Iconize's", () => {
	assert.deepEqual(parseIcon("lucide-book-open"), { kind: "lucide", id: "book-open" });
	assert.deepEqual(parseIcon("LiOrigami"), { kind: "lucide", id: "origami" });
	assert.deepEqual(parseIcon("LiArrowUpRight"), { kind: "lucide", id: "arrow-up-right" });
	assert.deepEqual(parseIcon("LiBuilding2"), { kind: "lucide", id: "building-2" });
});

test("an icon written back reads the same", () => {
	for (const value of ["🌅", "lucide-book-open"]) assert.equal(formatIcon(parseIcon(value)), value);
});

test("a Pixel Banner wikilink cover is a vault link", () => {
	assert.deepEqual(parseCover({ banner: "[[1500x500.jpg]]", "banner-y": 47 }), {
		source: { kind: "link", linktext: "1500x500.jpg" },
		y: 47,
	});
	assert.deepEqual(parseCover({ banner: "![[img/a b.png|300]]" }).source, { kind: "link", linktext: "img/a b.png" });
});

test("a markdown link or bare path cover is a vault link too", () => {
	assert.deepEqual(parseCover({ banner: "![](img/a%20b.png)" }).source, { kind: "link", linktext: "img/a b.png" });
	assert.deepEqual(parseCover({ banner: "img/a.png" }).source, { kind: "link", linktext: "img/a.png" });
});

test("a URL cover is used as is", () => {
	assert.deepEqual(parseCover({ banner: "https://example.com/a.jpg" }).source, { kind: "url", url: "https://example.com/a.jpg" });
	assert.deepEqual(parseCover({ banner: "![](https://example.com/a.jpg)" }).source, { kind: "url", url: "https://example.com/a.jpg" });
});

test("no cover without a banner value", () => {
	assert.equal(parseCover(undefined), null);
	assert.equal(parseCover({}), null);
	assert.equal(parseCover({ banner: "  " }), null);
});

test("cover position defaults to the middle and stays within 0-100", () => {
	assert.equal(parseCover({ banner: "a.png" }).y, 50);
	assert.equal(clampPercent("30", 50), 30);
	assert.equal(clampPercent(140, 50), 100);
	assert.equal(clampPercent(-3, 50), 0);
	assert.equal(clampPercent("x", 50), 50);
});

test("typed or pasted emoji are recognised", () => {
	assert.equal(containsEmoji("🧳"), true);
	assert.equal(containsEmoji("🇵🇹"), true);
	assert.equal(containsEmoji("book"), false);
});

test("a built-in gradient cover is recognised, an unknown one is a path", () => {
	assert.deepEqual(parseCover({ banner: "gradient:ocean" }).source, { kind: "gradient", id: "ocean" });
	assert.equal(parseCover({ banner: "gradient:nope" }).source.kind, "link");
});

test("page options toggle in cssclasses without touching other classes", () => {
	assert.deepEqual(withCssClass(["a"], "ftn-wide", true), ["a", "ftn-wide"]);
	assert.deepEqual(withCssClass("a ftn-wide", "ftn-wide", false), ["a"]);
	assert.deepEqual(withCssClass(undefined, "ftn-small", true), ["ftn-small"]);
	assert.deepEqual(withCssClass(["ftn-wide"], "ftn-wide", true), ["ftn-wide"]);
});
