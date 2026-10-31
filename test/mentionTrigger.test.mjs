/**
 * Tests for when the `@` mention list opens and what it filters on.
 *
 * "@" turns up in addresses, handles and code far more often than as a
 * mention, so a rule that fires too readily would open a page list over an
 * email address being typed.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { MENTION_QUERY_MAX, findMentionQuery, isInsideInlineCode } from "./.build/mentionTrigger.js";

// ── when it opens ──────────────────────────────────────────────────────────

test("an @ at the start of a line opens the list", () => {
	assert.deepEqual(findMentionQuery("@"), { col: 0, query: "" });
	assert.deepEqual(findMentionQuery("@tod"), { col: 0, query: "tod" });
});

test("an @ after a space opens it mid-line", () => {
	assert.deepEqual(findMentionQuery("meet @Ann"), { col: 5, query: "Ann" });
	assert.deepEqual(findMentionQuery("due\t@"), { col: 4, query: "" });
});

test("an @ right after a list marker or quote opens it", () => {
	for (const before of ["- ", "- [ ] ", "1. ", "> ", "    - "]) {
		assert.deepEqual(findMentionQuery(`${before}@x`), { col: before.length, query: "x" }, before);
	}
});

test("an @ inside a word is left alone", () => {
	for (const text of ["a@b.com", "mail me at a@b", "user@", "(@x", "\\@x"]) {
		assert.equal(findMentionQuery(text), null, text);
	}
});

// ── the query ──────────────────────────────────────────────────────────────

test("the query may hold single spaces, as note names do", () => {
	assert.deepEqual(findMentionQuery("see @project plan"), { col: 4, query: "project plan" });
	assert.deepEqual(findMentionQuery("@today "), { col: 0, query: "today " });
});

test("a space right after the @ is prose, not a mention", () => {
	assert.equal(findMentionQuery("at @ 5pm"), null);
	assert.equal(findMentionQuery("@ "), null);
});

test("two spaces in a row end the mention", () => {
	assert.equal(findMentionQuery("@some  thing"), null);
});

test("a long run of text after the @ ends the mention", () => {
	assert.notEqual(findMentionQuery("@" + "a".repeat(MENTION_QUERY_MAX)), null);
	assert.equal(findMentionQuery("@" + "a".repeat(MENTION_QUERY_MAX + 1)), null);
});

test("the last @ on the line is the one being typed", () => {
	assert.deepEqual(findMentionQuery("@Ann and @Bo"), { col: 9, query: "Bo" });
	// The last @ is inside an address, so nothing is being mentioned.
	assert.equal(findMentionQuery("@Ann wrote a@b"), null);
});

// ── code ───────────────────────────────────────────────────────────────────

test("an @ inside inline code is left alone", () => {
	assert.equal(findMentionQuery("use `@Override"), null);
	assert.equal(findMentionQuery("use `x` and `@dec"), null);
});

test("an @ after a closed code span opens the list", () => {
	assert.deepEqual(findMentionQuery("`code` @x"), { col: 7, query: "x" });
});

test("a code span closes only with a run of its own length", () => {
	assert.equal(isInsideInlineCode("``a ` b"), true);
	assert.equal(isInsideInlineCode("``a ` b``"), false);
	assert.equal(isInsideInlineCode("no code"), false);
});
