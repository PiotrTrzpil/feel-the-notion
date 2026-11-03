/**
 * Dropping a markdown file or a folder onto a note.
 *
 * An image dropped on a note is saved and referenced where the pointer was.
 * A markdown file is the same gesture, but the file is a page: it belongs in
 * the folder that represents the current note, and the note links it there.
 * A folder is that same gesture for a whole tree: it becomes a subfolder of
 * the current page, and a folder note, so the link opens it as a page.
 * This plans the link text and where the tree goes. Saving is the caller's job.
 *
 * Pure. See test/noteDrop.test.mjs.
 */

import { basename, folderNotePath, isWithin, joinPath, parentPath, planSubPageFolder } from "./folderNotes";

/** A markdown note, by file name. `.markdown` counts; a path's directory does not. */
export function isMarkdownFileName(name: string): boolean {
	const base = name.split(/[/\\]/).pop() ?? name;
	return /\.(md|markdown)$/i.test(base);
}

/**
 * Whether a dropped file is a markdown note.
 *
 * The desktop sometimes reports a display name with the extension hidden
 * (`Souls Metaphysics 2`) while the real path or MIME type still marks it as
 * markdown. Any of those is enough: missing it is what lets Obsidian save the
 * note as an attachment.
 */
export function isMarkdownDrop(name: string, fsPath: string | null, mime?: string | null): boolean {
	if (isMarkdownFileName(name)) return true;
	if (fsPath !== null && isMarkdownFileName(fsPath)) return true;
	if (mime && /^text\/(x-)?markdown\b/i.test(mime.trim())) {
		return !hasFileExtension(name) && (fsPath === null || !hasFileExtension(fsPath));
	}
	return false;
}

function hasFileExtension(path: string): boolean {
	const base = path.split(/[/\\]/).pop() ?? path;
	return /\.[A-Za-z0-9]+$/.test(base);
}

/**
 * Fills in missing `fsPath`s on dropped `File` entries from `text/uri-list`
 * paths without adding duplicate entries.
 */
export function attachUriPaths<T extends { name: string; fsPath: string | null }>(
	items: T[],
	uriPaths: readonly string[]
): void {
	if (items.length === 0 || uriPaths.length === 0) return;
	if (items.length === uriPaths.length) {
		for (let i = 0; i < items.length; i++) {
			if (items[i].fsPath === null) items[i].fsPath = uriPaths[i];
		}
		return;
	}
	const used = new Set<number>();
	for (const item of items) {
		if (item.fsPath !== null) continue;
		const wanted = noteNameFromFile(item.name);
		const idx = uriPaths.findIndex((p, i) => !used.has(i) && noteNameFromFile(p) === wanted);
		if (idx !== -1) {
			used.add(idx);
			item.fsPath = uriPaths[idx];
		}
	}
}

/**
 * A `file:` URL as a filesystem path.
 *
 * Null for anything else, including a URL that does not parse. `pathname` is
 * still percent-encoded (`Souls%20Metaphysics`), so it is decoded once. A name
 * that itself contains a stray `%` does not decode and is kept as-is. A
 * Windows path arrives as `/C:/...` and loses that extra leading slash.
 */
export function fileUrlToPath(url: string): string | null {
	const trimmed = url.trim();
	if (!/^file:/i.test(trimmed)) return null;
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return null;
	}
	if (parsed.protocol !== "file:") return null;
	let path = parsed.pathname;
	try {
		path = decodeURIComponent(path);
	} catch {
		// A literal `%` in the name is not an escape. The encoded form is fine.
	}
	if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
	return path.length > 0 ? path : null;
}

/**
 * Filesystem paths from a `text/uri-list` payload.
 *
 * Blank lines and `#` comments are part of the format and are not files. A
 * line that is not a `file:` URL is ignored, so an `http` link dropped as text
 * is not treated as a note.
 */
export function filePathsFromUriList(text: string): string[] {
	const out: string[] = [];
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#")) continue;
		const path = fileUrlToPath(trimmed);
		if (path !== null) out.push(path);
	}
	return out;
}

const ILLEGAL_IN_NOTE_NAME = /[\\/:*?"<>|#^[\]\u0000-\u001f\u007f]/g;

/**
 * The note name to give a dropped file.
 *
 * The extension is not part of the title. Characters that break a wikilink or
 * a path are replaced, and leading dots are dropped so the name cannot be
 * `.` or `..`. Empty when nothing usable is left; the caller picks a fallback.
 */
export function noteNameFromFile(name: string): string {
	const base = name.split(/[/\\]/).pop() ?? name;
	const stripped = base.replace(/\.(md|markdown)$/i, "");
	return stripped
		.replace(ILLEGAL_IN_NOTE_NAME, "-")
		.replace(/^\.+/, "")
		.replace(/\.+$/, "")
		.trim();
}

/**
 * Note text as the vault should store it.
 *
 * A leading BOM would hide the first heading or frontmatter fence from
 * everything that looks at the start of the file. A missing final newline
 * makes the next edit, and every diff, touch the last line.
 */
export function normalizeNoteText(text: string): string {
	const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	return body.endsWith("\n") ? body : `${body}\n`;
}

/**
 * `absolute` as a vault path when it is a file inside `vaultRoot`.
 *
 * Null for anything outside the vault, and for the vault root itself. The
 * comparison is on the path text: a root of `/vault` must not claim `/vault2`.
 */
export function vaultRelativePath(vaultRoot: string, absolute: string): string | null {
	const root = trimSlash(absolutePath(vaultRoot));
	const abs = trimSlash(absolutePath(absolute));
	if (root === "" || abs === root) return null;
	const prefix = `${root}/`;
	if (!abs.startsWith(prefix)) return null;
	const rel = abs.slice(prefix.length);
	return rel === "" ? null : rel;
}

function absolutePath(path: string): string {
	return path.replace(/\\/g, "/");
}

function trimSlash(path: string): string {
	return path.replace(/\/+$/, "");
}

/** 1-based line containing `offset`, matching the fence helpers. */
export function offsetLine(doc: string, offset: number): number {
	const end = Math.max(0, Math.min(offset, doc.length));
	let line = 1;
	for (let i = 0; i < end; i++) if (doc.charCodeAt(i) === 10) line++;
	return line;
}

/** A replacement that puts the dropped pages into the note. */
export interface DropInsert {
	from: number;
	to: number;
	text: string;
}

/**
 * Where `links` land in `doc` for a drop covering `from`..`to`.
 *
 * Each link is its own block, the way a dropped image is its own embed. An
 * empty line is replaced. A drop in the middle of a line splits it. A drop
 * inside frontmatter is moved to the first line after it: writing a link into
 * the fence would break the properties, and the top of the page is where a
 * drop on the title area belongs.
 */
export function planNoteDrop(doc: string, from: number, to: number, links: string[]): DropInsert {
	if (links.length === 0) throw new Error("planNoteDrop called with no links");
	const lo = clamp(Math.min(from, to), 0, doc.length);
	const hi = clamp(Math.max(from, to), 0, doc.length);
	const body = links.join("\n");

	const fm = frontmatterClose(doc);
	if (fm !== null && lo < fm) return place(doc, fm, Math.max(hi, fm), body);
	return place(doc, lo, hi, body);
}

/**
 * `body` inserted at `lo`..`hi` so it occupies lines of its own.
 *
 * `lo` and `hi` are offsets in `doc` (a selection has already been chosen).
 * The line around the caret is read with that span removed, which is the
 * document the insertion has to fit into.
 */
function place(doc: string, lo: number, hi: number, body: string): DropInsert {
	const cleared = doc.slice(0, lo) + doc.slice(hi);
	const lineStart = cleared.lastIndexOf("\n", lo - 1) + 1;
	const nl = cleared.indexOf("\n", lo);
	const lineEnd = nl === -1 ? cleared.length : nl;
	const before = cleared.slice(lineStart, lo);
	const after = cleared.slice(lo, lineEnd);

	// A blank line, including one that holds only indentation: the links
	// replace it, at column zero, so a page does not become a nested item.
	if (before.trim() === "" && after.trim() === "") {
		return { from: lo - before.length, to: hi + after.length, text: body };
	}
	if (before.trim() === "") return { from: lo - before.length, to: hi, text: `${body}\n` };
	if (after.trim() === "") return { from: lo, to: hi, text: `\n${body}` };
	return { from: lo, to: hi, text: `\n${body}\n` };
}

/**
 * Offset of the first character after a leading frontmatter fence, or null
 * when the document does not open with one.
 *
 * The closing fence is a line whose text is exactly `---`. An unclosed fence
 * is left alone: there is no safe line to move the drop to.
 */
function frontmatterClose(doc: string): number | null {
	if (!doc.startsWith("---")) return null;
	const firstNl = doc.indexOf("\n");
	if (firstNl === -1) return doc.replace(/\r$/, "") === "---" ? doc.length : null;
	if (doc.slice(0, firstNl).replace(/\r$/, "") !== "---") return null;

	let i = firstNl + 1;
	while (i <= doc.length) {
		const next = doc.indexOf("\n", i);
		const end = next === -1 ? doc.length : next;
		const line = doc.slice(i, end).replace(/\r$/, "");
		if (line === "---") return next === -1 ? doc.length : next + 1;
		if (next === -1) return null;
		i = next + 1;
	}
	return null;
}

function clamp(n: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, n));
}

/** One file or directory inside a dropped folder, relative to that folder. */
export interface DropTreeEntry {
	/** `/`-separated path. No leading slash, no `.` or `..` segments. */
	relative: string;
	kind: "file" | "dir";
}

/** A file the caller copies from the dropped folder into the vault. */
export interface DirectoryCopy {
	/** Path relative to the dropped directory, for reading the source. */
	relative: string;
	/** Vault path to write. */
	dest: string;
}

/**
 * Where a dropped folder lands, and which file becomes its folder note.
 *
 * `moveFrom` is set when the folder is already in the vault: the caller
 * renames that folder onto `folder` instead of copying `copies`. An outside
 * folder leaves `moveFrom` null and lists every directory to create.
 */
export interface DirectoryDropPlan {
	folder: string;
	moveFrom: string | null;
	/**
	 * Relative path of the file that already is this folder's note, or null
	 * when the caller creates an empty one at `notePath`.
	 */
	noteSource: string | null;
	/** Vault path of the folder note. This is what the drop links. */
	notePath: string;
	/** Directories to create, parents before children. Empty when moving. */
	directories: string[];
	/** Files to copy, excluding `noteSource`. Empty when moving. */
	copies: DirectoryCopy[];
}

/**
 * The page name of a dropped folder.
 *
 * The same characters that break a note name break a folder that has to be
 * linked. Leading dots are dropped so the page is not a hidden file. Empty
 * when nothing usable is left; the caller supplies a fallback.
 */
export function folderNameFromEntry(name: string): string {
	const base = basename(name);
	return base
		.replace(ILLEGAL_IN_NOTE_NAME, "-")
		.replace(/^\.+/, "")
		.replace(/\.+$/, "")
		.trim();
}

/**
 * Where a folder dropped on `sourceNotePath` is placed under `parent`.
 *
 * The tree keeps its shape. The dropped folder itself becomes a folder note:
 * a top-level `<name>.md` already in the tree is that note, and anything else
 * gets an empty one. A name the vault already uses gains a numeric suffix,
 * and the note is renamed with it so the pair still matches.
 *
 * `{ skip: "self" }` when the folder is the page it was dropped on, or
 * contains it. Moving a folder into itself is not a placement.
 */
export function planDirectoryDrop(input: {
	parent: string;
	dirName: string;
	entries: readonly DropTreeEntry[];
	fallbackName: string;
	exists: (path: string) => boolean;
	sourceNotePath: string;
	vaultDir: string | null;
}): DirectoryDropPlan | { skip: "self" } {
	const { parent, dirName, entries, fallbackName, exists, sourceNotePath, vaultDir } = input;
	if (vaultDir !== null && isDirectorySelfDrop(sourceNotePath, vaultDir)) return { skip: "self" };

	const rawBase = basename(dirName);
	const safeBase = folderNameFromEntry(dirName) || fallbackName;
	const files = treeFiles(entries);
	const folder = allocateFolder(parent, safeBase, vaultDir, exists, files, rawBase);
	const notePath = folderNotePath(folder);
	if (notePath === null) throw new Error("no available folder name");
	const noteSource = findNoteSource(files, rawBase);

	if (vaultDir !== null) {
		return { folder, moveFrom: vaultDir, noteSource, notePath, directories: [], copies: [] };
	}

	const used = new Set<string>([notePath]);
	const copies: DirectoryCopy[] = [];
	for (const relative of files) {
		if (relative === noteSource) continue;
		const dest = uniqueDest(joinRelative(folder, safeRelative(relative)), used);
		used.add(dest);
		copies.push({ relative, dest });
	}

	const dirRels: string[] = [];
	for (const entry of entries) {
		if (entry.kind !== "dir" || isSkippedDropPath(entry.relative)) continue;
		const rel = normalizeRelative(entry.relative);
		if (rel === null) continue;
		dirRels.push(safeRelative(rel));
	}

	return {
		folder,
		moveFrom: null,
		noteSource,
		notePath,
		directories: directoryPaths(folder, dirRels, copies.map((copy) => copy.dest), notePath),
		copies,
	};
}

/**
 * The dropped folder is the note itself, or the folder that note is about to
 * become. Either way the drop would move a folder into its own contents.
 */
export function isDirectorySelfDrop(sourceNotePath: string, vaultDir: string): boolean {
	if (isWithin(sourceNotePath, vaultDir)) return true;
	const future = planSubPageFolder(sourceNotePath).folder;
	return future === vaultDir || isWithin(future, vaultDir);
}

/** `.DS_Store` is Finder metadata, not content of the folder. */
function isSkippedDropPath(relative: string): boolean {
	return relative.split(/[/\\]/).some((part) => part === ".DS_Store");
}

function treeFiles(entries: readonly DropTreeEntry[]): string[] {
	const files: string[] = [];
	for (const entry of entries) {
		if (entry.kind !== "file" || isSkippedDropPath(entry.relative)) continue;
		const rel = normalizeRelative(entry.relative);
		if (rel !== null) files.push(rel);
	}
	files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	return files;
}

/**
 * First `base`, `base 1`, ... under `parent` that is free and can hold a
 * folder note.
 *
 * `vaultDir` is free even when it exists: the drop is already that folder.
 * A suffix that would make the folder note land on a different file in the
 * tree is skipped, so the note never takes over some other file's name.
 */
function allocateFolder(
	parent: string,
	base: string,
	vaultDir: string | null,
	exists: (path: string) => boolean,
	files: readonly string[],
	rawBase: string
): string {
	for (let n = 0; n < 1000; n++) {
		const name = n === 0 ? base : `${base} ${n}`;
		const path = joinPath(parent, name);
		if (folderNotePath(path) === null) continue;
		if (path !== vaultDir && exists(path)) continue;
		if (noteNameTaken(files, rawBase, name)) continue;
		return path;
	}
	throw new Error("no available folder name");
}

/** A top-level file already uses the folder-note name, and it is not the note. */
function noteNameTaken(files: readonly string[], rawBase: string, folderBase: string): boolean {
	const source = findNoteSource(files, rawBase);
	const wanted = `${folderBase}.md`.toLowerCase();
	if (source !== null && basename(source).toLowerCase() === wanted) return false;
	return files.some((rel) => !rel.includes("/") && rel.toLowerCase() === wanted);
}

/**
 * A top-level `<folder>.md` in the dropped tree is already the folder note.
 *
 * Matching ignores case. On a case-insensitive disk `paris.md` is `Paris.md`,
 * and creating a second one would write the same file twice.
 */
function findNoteSource(files: readonly string[], rawBase: string): string | null {
	const wanted = `${rawBase}.md`.toLowerCase();
	for (const rel of files) {
		if (rel.includes("/")) continue;
		if (rel.toLowerCase() === wanted) return rel;
	}
	return null;
}

/** `..` cannot appear in a real directory listing; a path that has one is refused. */
function normalizeRelative(relative: string): string | null {
	const parts = relative.replace(/\\/g, "/").split("/").filter((part) => part !== "" && part !== ".");
	if (parts.length === 0 || parts.some((part) => part === "..")) return null;
	return parts.join("/");
}

/** A vault-safe relative path. Dots stay, so `.gitignore` is still copied. */
function safeRelative(relative: string): string {
	return relative.split("/").map(safeSegment).join("/");
}

function safeSegment(segment: string): string {
	const cleaned = segment.replace(ILLEGAL_IN_NOTE_NAME, "-").trim();
	if (cleaned === "" || cleaned === "." || cleaned === "..") return "untitled";
	return cleaned;
}

function joinRelative(folder: string, relative: string): string {
	return joinPath(folder, relative);
}

function uniqueDest(path: string, used: Set<string>): string {
	if (!used.has(path)) return path;
	const slash = path.lastIndexOf("/");
	const dir = slash === -1 ? "" : path.slice(0, slash);
	const base = slash === -1 ? path : path.slice(slash + 1);
	const dot = base.lastIndexOf(".");
	const stem = dot > 0 ? base.slice(0, dot) : base;
	const ext = dot > 0 ? base.slice(dot) : "";
	for (let n = 1; n < 1000; n++) {
		const candidate = joinPath(dir, `${stem} ${n}${ext}`);
		if (!used.has(candidate)) return candidate;
	}
	throw new Error("no available file name");
}

/**
 * The dropped folder plus every directory a file or an empty dir needs.
 *
 * A path that is a file (the folder note included) is not also created as a
 * directory. `Name.md` can be both in a tree someone built by hand.
 */
function directoryPaths(
	folder: string,
	dirRels: readonly string[],
	fileDests: readonly string[],
	notePath: string
): string[] {
	const files = new Set(fileDests);
	files.add(notePath);
	const set = new Set<string>();
	const add = (path: string) => {
		if (path === "" || path === "/" || files.has(path)) return;
		if (path !== folder && !path.startsWith(`${folder}/`)) return;
		set.add(path);
	};
	add(folder);
	for (const rel of dirRels) add(joinRelative(folder, rel));
	for (const dest of fileDests) {
		let parent = parentPath(dest);
		while (parent === folder || parent.startsWith(`${folder}/`)) {
			add(parent);
			if (parent === folder) break;
			parent = parentPath(parent);
		}
	}
	return [...set].sort((a, b) => {
		const depth = a.split("/").length - b.split("/").length;
		if (depth !== 0) return depth;
		return a < b ? -1 : a > b ? 1 : 0;
	});
}
