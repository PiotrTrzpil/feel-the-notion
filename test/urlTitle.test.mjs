/**
 * Tests for the text side of pasting a link.
 *
 * Each of these ends up in the note. A URL check that is too loose turns a
 * pasted sentence into a link menu; a title that is not decoded or escaped
 * writes "&amp;" or a broken link into the user's text.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
	decodeHtmlEntities,
	embedLink,
	escapeLinkText,
	extractPageTitle,
	linkDestination,
	singleHttpUrl,
	titledLink,
	wrapAsLink,
} from "./.build/urlTitle.js";

// ── recognising a URL ──────────────────────────────────────────────────────

test("a single http or https URL is recognised", () => {
	assert.equal(singleHttpUrl("https://example.com/a?b=1#c"), "https://example.com/a?b=1#c");
	assert.equal(singleHttpUrl("http://localhost:8080"), "http://localhost:8080");
	assert.equal(singleHttpUrl("HTTPS://Example.com"), "HTTPS://Example.com");
});

test("surrounding whitespace is dropped", () => {
	assert.equal(singleHttpUrl("  https://example.com\n"), "https://example.com");
});

test("anything that is not exactly one http URL is not", () => {
	for (const text of [
		"",
		"example.com",
		"ftp://example.com",
		"mailto:a@b.com",
		"https://",
		"see https://example.com",
		"https://a.com https://b.com",
		"https://a.com\nhttps://b.com",
		"javascript:alert(1)",
	]) {
		assert.equal(singleHttpUrl(text), null, JSON.stringify(text));
	}
});

// ── reading the title ──────────────────────────────────────────────────────

test("og:title wins over <title>", () => {
	const html = `<html><head><title>Post | Site</title>
		<meta property="og:title" content="Post"></head><body></body></html>`;
	assert.equal(extractPageTitle(html), "Post");
});

test("og:title is found whatever the attribute order and quoting", () => {
	assert.equal(extractPageTitle(`<meta content='A' property='og:title'/>`), "A");
	assert.equal(extractPageTitle(`<META NAME="og:title" CONTENT="B">`), "B");
	assert.equal(extractPageTitle(`<meta property=og:title content=C>`), "C");
});

test("a > inside an attribute value does not end the tag", () => {
	assert.equal(extractPageTitle(`<meta content="A > B" property="og:title">`), "A > B");
});

test("twitter:title is the next choice, then <title>", () => {
	assert.equal(extractPageTitle(`<meta name="twitter:title" content="T"><title>X</title>`), "T");
	assert.equal(extractPageTitle(`<head><title lang="en">\n  Plain  title\n</title></head>`), "Plain title");
});

test("an empty og:title falls through to <title>", () => {
	assert.equal(extractPageTitle(`<meta property="og:title" content="  "><title>Real</title>`), "Real");
});

test("an SVG's title in the body is not taken for the page's", () => {
	const html = `<head><title>Page</title></head><body><svg><title>Icon</title></svg></body>`;
	assert.equal(extractPageTitle(html), "Page");
});

test("a page with no title gives null", () => {
	assert.equal(extractPageTitle("<html><body>hi</body></html>"), null);
	assert.equal(extractPageTitle("<title> </title>"), null);
});

test("titles are decoded", () => {
	assert.equal(extractPageTitle(`<title>Q&amp;A &#8211; Tom&#x27;s</title>`), "Q&A \u2013 Tom's");
});

// ── entities ───────────────────────────────────────────────────────────────

test("named, decimal and hex entities are decoded", () => {
	assert.equal(decodeHtmlEntities("&lt;b&gt; &quot;x&quot; &apos;y&apos;"), `<b> "x" 'y'`);
	assert.equal(decodeHtmlEntities("&#169; &#xA9; &#XA9;"), "\u00a9 \u00a9 \u00a9");
	assert.equal(decodeHtmlEntities("&#128512;"), "\u{1F600}");
});

test("unknown entities and bare ampersands are left as written", () => {
	assert.equal(decodeHtmlEntities("&notathing; R&D & co"), "&notathing; R&D & co");
});

test("decoding happens once, so an escaped entity stays an entity", () => {
	assert.equal(decodeHtmlEntities("&amp;lt;"), "&lt;");
});

test("invalid code points become the replacement character", () => {
	assert.equal(decodeHtmlEntities("&#0;&#xD800;&#x110000;"), "\ufffd\ufffd\ufffd");
});

test("a non-breaking space collapses like any other", () => {
	assert.equal(extractPageTitle("<title>a&nbsp;&nbsp;b</title>"), "a b");
});

// ── markdown ───────────────────────────────────────────────────────────────

test("brackets and backslashes in link text are escaped", () => {
	assert.equal(escapeLinkText("[PDF] Report"), "\\[PDF\\] Report");
	assert.equal(escapeLinkText("C:\\"), "C:\\\\");
});

test("a titled link escapes the title", () => {
	assert.equal(titledLink("[PDF] Report", "https://x.com/r"), "[\\[PDF\\] Report](https://x.com/r)");
});

test("balanced parentheses stay bare in the destination", () => {
	const url = "https://en.wikipedia.org/wiki/Foo_(bar)";
	assert.equal(linkDestination(url), url);
});

test("unbalanced parentheses go in angle brackets", () => {
	assert.equal(linkDestination("https://x.com/a)"), "<https://x.com/a)>");
	assert.equal(linkDestination("https://x.com/(a"), "<https://x.com/(a>");
	assert.equal(linkDestination("https://x.com/)a("), "<https://x.com/)a(>");
});

test("angle brackets in a URL are percent-encoded", () => {
	assert.equal(linkDestination("https://x.com/<a>"), "https://x.com/%3Ca%3E");
});

test("a selection is wrapped as written", () => {
	assert.equal(wrapAsLink("**docs**", "https://x.com"), "[**docs**](https://x.com)");
});

test("an embed has empty alt text", () => {
	assert.equal(embedLink("https://youtu.be/abc"), "![](https://youtu.be/abc)");
});
