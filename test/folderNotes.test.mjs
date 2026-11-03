/**
 * Folder note paths, and the renames that keep a folder and its note named
 * alike.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
	folderNotePath,
	folderOfNote,
	isAttachmentsFolder,
	planFollowRename,
	planSubPageFolder,
	remapPath,
} from "./.build/folderNotes.js";

test("a folder's note is inside it and named after it", () => {
	assert.equal(folderNotePath("Travel"), "Travel/Travel.md");
	assert.equal(folderNotePath("Travel/Madeira"), "Travel/Madeira/Madeira.md");
});

test("the vault root and _attachments have no folder note", () => {
	assert.equal(folderNotePath(""), null);
	assert.equal(folderNotePath("/"), null);
	assert.equal(folderNotePath("_attachments"), null);
	assert.equal(folderNotePath("Travel/_attachments"), null);
	assert.equal(isAttachmentsFolder("_attachments"), true);
	assert.equal(isAttachmentsFolder("Travel/_attachments"), true);
	assert.equal(isAttachmentsFolder("Travel"), false);
});

test("only a note named after its own folder is a folder note", () => {
	assert.equal(folderOfNote("Travel/Travel.md"), "Travel");
	assert.equal(folderOfNote("Travel/Madeira/Madeira.md"), "Travel/Madeira");
	assert.equal(folderOfNote("Travel/Rome.md"), null);
	assert.equal(folderOfNote("Travel.md"), null);
	assert.equal(folderOfNote("Travel/Travel.canvas"), null);
});

test("renaming a folder renames its note", () => {
	assert.deepEqual(planFollowRename("A/Old", "A/New", true), { kind: "file", from: "A/New/Old.md", to: "A/New/New.md" });
});

test("moving a folder without renaming it leaves its note alone", () => {
	assert.equal(planFollowRename("A/Trip", "B/Trip", true), null);
});

test("renaming a folder note in place renames its folder", () => {
	assert.deepEqual(planFollowRename("A/Old/Old.md", "A/Old/New.md", false), { kind: "folder", from: "A/Old", to: "A/New" });
	assert.deepEqual(planFollowRename("Old/Old.md", "Old/New.md", false), { kind: "folder", from: "Old", to: "New" });
});

test("a folder note moved out of its folder is only a note", () => {
	assert.equal(planFollowRename("A/Old/Old.md", "A/Old.md", false), null);
});

test("a folder's own rename moves its note without chaining back", () => {
	// The vault reports the note moving from A/Old/Old.md to A/New/Old.md.
	assert.equal(planFollowRename("A/Old/Old.md", "A/New/Old.md", false), null);
	// The follow-up rename then lands on a pair already named alike.
	assert.equal(planFollowRename("A/New/Old.md", "A/New/New.md", false), null);
});

test("renaming an ordinary note does nothing else", () => {
	assert.equal(planFollowRename("A/Note.md", "A/Other.md", false), null);
});

test("a folder note's sub-pages go in its folder", () => {
	assert.deepEqual(planSubPageFolder("Travel/Travel.md"), { folder: "Travel", move: null });
});

test("a plain note becomes a folder note before it gets sub-pages", () => {
	assert.deepEqual(planSubPageFolder("Travel/Rome.md"), {
		folder: "Travel/Rome",
		move: { from: "Travel/Rome.md", to: "Travel/Rome/Rome.md" },
	});
	assert.deepEqual(planSubPageFolder("Inbox.md"), {
		folder: "Inbox",
		move: { from: "Inbox.md", to: "Inbox/Inbox.md" },
	});
});

test("paths inside a renamed folder follow it, others do not", () => {
	assert.equal(remapPath("A", "A", "B"), "B");
	assert.equal(remapPath("A/x", "A", "B"), "B/x");
	assert.equal(remapPath("AB/x", "A", "B"), null);
});
