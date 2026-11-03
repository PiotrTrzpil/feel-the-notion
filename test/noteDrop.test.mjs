/**
 * Where a markdown file dropped on a note is linked, and the name it is saved under.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
	attachUriPaths,
	filePathsFromUriList,
	fileUrlToPath,
	isMarkdownDrop,
	isMarkdownFileName,
	normalizeNoteText,
	noteNameFromFile,
	offsetLine,
	planNoteDrop,
	vaultRelativePath,
} from "./.build/noteDrop.js";

const apply = (doc, from, to, links) => {
	const plan = planNoteDrop(doc, from, to, links);
	return doc.slice(0, plan.from) + plan.text + doc.slice(plan.to);
};

test("markdown is recognised by extension, not by directory", () => {
	assert.equal(isMarkdownFileName("Notes.md"), true);
	assert.equal(isMarkdownFileName("Notes.MD"), true);
	assert.equal(isMarkdownFileName("a/b.markdown"), true);
	assert.equal(isMarkdownFileName("notes.md.txt"), false);
	assert.equal(isMarkdownFileName("photo.png"), false);
});

test("a drop is markdown when the extension is only on the path or MIME type", () => {
	assert.equal(isMarkdownDrop("Souls Metaphysics 2.md", null), true);
	assert.equal(isMarkdownDrop("Souls Metaphysics 2", "/Users/x/Souls Metaphysics 2.md"), true);
	assert.equal(isMarkdownDrop("Souls Metaphysics 2", null, "text/markdown"), true);
	assert.equal(isMarkdownDrop("Souls Metaphysics 2", null, "text/x-markdown; charset=utf-8"), true);
	assert.equal(isMarkdownDrop("notes.txt", null, "text/markdown"), false);
	assert.equal(isMarkdownDrop("photo.png", "/tmp/photo.png"), false);
});

test("attachUriPaths fills missing paths on File entries without duplicating them", () => {
	const single = [{ name: "Souls Metaphysics 2", fsPath: null }];
	attachUriPaths(single, ["/Users/x/Souls Metaphysics 2.md"]);
	assert.deepEqual(single, [{ name: "Souls Metaphysics 2", fsPath: "/Users/x/Souls Metaphysics 2.md" }]);

	const mixed = [
		{ name: "photo.png", fsPath: "/Users/x/photo.png" },
		{ name: "Souls Metaphysics 2", fsPath: null },
	];
	attachUriPaths(mixed, ["/Users/x/Souls Metaphysics 2.md"]);
	assert.equal(mixed[1].fsPath, "/Users/x/Souls Metaphysics 2.md");
});

test("a file url becomes a path, and a uri-list keeps only those", () => {
	assert.equal(
		fileUrlToPath("file:///Users/x/Souls%20Metaphysics%202.md"),
		"/Users/x/Souls Metaphysics 2.md"
	);
	assert.equal(fileUrlToPath("file:///C:/Notes/A.md"), "C:/Notes/A.md");
	assert.equal(fileUrlToPath("file:///Users/x/100%25.md"), "/Users/x/100%.md");
	assert.equal(fileUrlToPath("https://example.com/A.md"), null);
	assert.deepEqual(
		filePathsFromUriList(
			"# comment\n\nfile:///Users/x/A.md\nhttps://example.com/B.md\nfile:///Users/x/Photo%20.png"
		),
		["/Users/x/A.md", "/Users/x/Photo .png"]
	);
});

test("a dropped file's note name drops the extension and path-breaking characters", () => {
	assert.equal(noteNameFromFile("Trip notes.md"), "Trip notes");
	assert.equal(noteNameFromFile("folder/report (final).markdown"), "report (final)");
	assert.equal(noteNameFromFile("weird#name|x.md"), "weird-name-x");
	assert.equal(noteNameFromFile(".hidden.md"), "hidden");
	assert.equal(noteNameFromFile(".md"), "");
});

test("note text loses a BOM and gains a final newline", () => {
	assert.equal(normalizeNoteText("\uFEFF# Hi"), "# Hi\n");
	assert.equal(normalizeNoteText("# Hi\n"), "# Hi\n");
	assert.equal(normalizeNoteText(""), "\n");
});

test("only a path inside the vault is a vault path", () => {
	assert.equal(vaultRelativePath("/vault", "/vault/Travel/Rome.md"), "Travel/Rome.md");
	assert.equal(vaultRelativePath("/vault/", "/vault/Rome.md"), "Rome.md");
	assert.equal(vaultRelativePath("/vault", "/vault2/Rome.md"), null);
	assert.equal(vaultRelativePath("/vault", "/vault"), null);
	assert.equal(vaultRelativePath("C:\\vault", "C:\\vault\\A\\B.md"), "A/B.md");
});

test("a drop on an empty line replaces that line", () => {
	assert.equal(apply("Hello\n\nWorld", 6, 6, ["[[Rome]]"]), "Hello\n[[Rome]]\nWorld");
});

test("a drop at the end of a line starts a new block", () => {
	assert.equal(apply("Hello\nWorld", 5, 5, ["[[Rome]]"]), "Hello\n[[Rome]]\nWorld");
});

test("a drop in the middle of a line splits it", () => {
	assert.equal(apply("Hello", 2, 2, ["[[Rome]]"]), "He\n[[Rome]]\nllo");
});

test("a drop at the start of a line inserts above it", () => {
	assert.equal(apply("Hello\nWorld", 6, 6, ["[[Rome]]"]), "Hello\n[[Rome]]\nWorld");
});

test("several dropped pages each get a line, in order", () => {
	assert.equal(apply("Hello", 5, 5, ["[[A]]", "[[B]]"]), "Hello\n[[A]]\n[[B]]");
});

test("a drop on a blank document is just the link", () => {
	assert.equal(apply("", 0, 0, ["[[Rome]]"]), "[[Rome]]");
});

test("indentation on an otherwise empty line is not kept", () => {
	assert.equal(apply("    \nNext", 2, 2, ["[[Rome]]"]), "[[Rome]]\nNext");
});

test("a selection is replaced by the page link", () => {
	assert.equal(apply("Hello world", 6, 11, ["[[Rome]]"]), "Hello \n[[Rome]]");
});

test("a drop inside frontmatter lands on the first line after it", () => {
	const doc = "---\ntitle: x\n---\nHello";
	assert.equal(apply(doc, 0, 0, ["[[Rome]]"]), "---\ntitle: x\n---\n[[Rome]]\nHello");
	assert.equal(apply(doc, 4, 4, ["[[Rome]]"]), "---\ntitle: x\n---\n[[Rome]]\nHello");
});

test("a drop in the body leaves frontmatter where it is", () => {
	const doc = "---\ntitle: x\n---\nHello";
	const body = doc.indexOf("Hello") + 5;
	assert.equal(apply(doc, body, body, ["[[Rome]]"]), "---\ntitle: x\n---\nHello\n[[Rome]]");
});

test("offsetLine counts newlines", () => {
	assert.equal(offsetLine("a\nbc\n", 0), 1);
	assert.equal(offsetLine("a\nbc\n", 2), 2);
	assert.equal(offsetLine("a\nbc\n", 5), 3);
});
