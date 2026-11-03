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
	folderNameFromEntry,
	planDirectoryDrop,
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

const taken = (paths) => {
	const set = new Set(paths);
	return (path) => set.has(path);
};

const dropDir = (over) => planDirectoryDrop({
	parent: "Travel",
	dirName: "Paris",
	entries: [],
	fallbackName: "Untitled",
	exists: taken([]),
	sourceNotePath: "Travel/Travel.md",
	vaultDir: null,
	...over,
});

test("a dropped folder's name is safe to link", () => {
	assert.equal(folderNameFromEntry("My Folder"), "My Folder");
	assert.equal(folderNameFromEntry("weird#name"), "weird-name");
	assert.equal(folderNameFromEntry(".hidden"), "hidden");
	assert.equal(folderNameFromEntry("..."), "");
});

test("a dropped folder is copied under the page and becomes its folder note", () => {
	assert.deepEqual(dropDir({
		entries: [
			{ relative: "hotel.md", kind: "file" },
			{ relative: "img", kind: "dir" },
			{ relative: "img/pic.png", kind: "file" },
			{ relative: ".DS_Store", kind: "file" },
			{ relative: "img/.DS_Store", kind: "file" },
		],
	}), {
		folder: "Travel/Paris",
		moveFrom: null,
		noteSource: null,
		notePath: "Travel/Paris/Paris.md",
		directories: ["Travel/Paris", "Travel/Paris/img"],
		copies: [
			{ relative: "hotel.md", dest: "Travel/Paris/hotel.md" },
			{ relative: "img/pic.png", dest: "Travel/Paris/img/pic.png" },
		],
	});
});

test("an empty dropped folder is still a folder note", () => {
	assert.deepEqual(dropDir({ entries: [] }), {
		folder: "Travel/Paris",
		moveFrom: null,
		noteSource: null,
		notePath: "Travel/Paris/Paris.md",
		directories: ["Travel/Paris"],
		copies: [],
	});
});

test("a top-level note named after the folder is the folder note", () => {
	const plan = dropDir({
		entries: [
			{ relative: "paris.md", kind: "file" },
			{ relative: "hotel.md", kind: "file" },
			{ relative: "sub/Paris.md", kind: "file" },
		],
	});
	assert.equal(plan.noteSource, "paris.md");
	assert.equal(plan.notePath, "Travel/Paris/Paris.md");
	assert.deepEqual(plan.copies, [
		{ relative: "hotel.md", dest: "Travel/Paris/hotel.md" },
		{ relative: "sub/Paris.md", dest: "Travel/Paris/sub/Paris.md" },
	]);
});

test("a folder the vault already has is moved, not copied", () => {
	const plan = dropDir({
		vaultDir: "Inbox/Paris",
		exists: taken(["Inbox/Paris"]),
		entries: [{ relative: "Paris.md", kind: "file" }, { relative: "hotel.md", kind: "file" }],
	});
	assert.deepEqual(plan, {
		folder: "Travel/Paris",
		moveFrom: "Inbox/Paris",
		noteSource: "Paris.md",
		notePath: "Travel/Paris/Paris.md",
		directories: [],
		copies: [],
	});
});

test("a folder already in this page stays where it is", () => {
	const plan = dropDir({
		vaultDir: "Travel/Paris",
		exists: taken(["Travel/Paris"]),
		entries: [{ relative: "hotel.md", kind: "file" }],
	});
	assert.equal(plan.moveFrom, "Travel/Paris");
	assert.equal(plan.folder, "Travel/Paris");
	assert.deepEqual(plan.copies, []);
});

test("a taken folder name gains a suffix and the folder note follows it", () => {
	const plan = dropDir({
		exists: taken(["Travel/Paris"]),
		entries: [
			{ relative: "Paris.md", kind: "file" },
			{ relative: "hotel.md", kind: "file" },
		],
	});
	assert.equal(plan.folder, "Travel/Paris 1");
	assert.equal(plan.notePath, "Travel/Paris 1/Paris 1.md");
	assert.equal(plan.noteSource, "Paris.md");
	assert.deepEqual(plan.copies, [
		{ relative: "hotel.md", dest: "Travel/Paris 1/hotel.md" },
	]);
});

test("a suffix skips a name another file in the tree already uses", () => {
	const plan = dropDir({
		exists: taken(["Travel/Paris"]),
		entries: [
			{ relative: "Paris.md", kind: "file" },
			{ relative: "Paris 1.md", kind: "file" },
		],
	});
	assert.equal(plan.folder, "Travel/Paris 2");
	assert.equal(plan.notePath, "Travel/Paris 2/Paris 2.md");
	assert.equal(plan.noteSource, "Paris.md");
});

test("dropping the page's own folder is refused", () => {
	assert.deepEqual(dropDir({ vaultDir: "Travel" }), { skip: "self" });
	assert.deepEqual(dropDir({
		sourceNotePath: "Notes/Trip.md",
		vaultDir: "Notes/Trip",
	}), { skip: "self" });
	assert.deepEqual(dropDir({
		sourceNotePath: "Travel/Paris/Paris.md",
		vaultDir: "Travel",
	}), { skip: "self" });
});

test("a dropped folder keeps a usable name and a safe inner path", () => {
	const plan = dropDir({
		dirName: "...",
		entries: [{ relative: "a#b/c.md", kind: "file" }, { relative: "../x.md", kind: "file" }],
	});
	assert.equal(plan.folder, "Travel/Untitled");
	assert.equal(plan.notePath, "Travel/Untitled/Untitled.md");
	assert.deepEqual(plan.copies, [
		{ relative: "a#b/c.md", dest: "Travel/Untitled/a-b/c.md" },
	]);
	assert.deepEqual(plan.directories, ["Travel/Untitled", "Travel/Untitled/a-b"]);
});

test("two files that sanitize to one name do not share a path", () => {
	const plan = dropDir({
		entries: [
			{ relative: "a#b.md", kind: "file" },
			{ relative: "a-b.md", kind: "file" },
		],
	});
	assert.deepEqual(plan.copies.map((copy) => copy.dest), [
		"Travel/Paris/a-b.md",
		"Travel/Paris/a-b 1.md",
	]);
});

test("a dropped folder at the vault root is still a folder note", () => {
	const plan = dropDir({ parent: "", entries: [] });
	assert.equal(plan.folder, "Paris");
	assert.equal(plan.notePath, "Paris/Paris.md");
	assert.deepEqual(plan.directories, ["Paris"]);
});
