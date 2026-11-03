/**
 * Dropping a markdown file onto a note.
 *
 * An image dropped on a note is saved and referenced where the pointer was.
 * A markdown file is the same gesture, but the file is a page: it belongs in
 * the folder that represents the current note, and the note links it there.
 * This plans the link text. Saving the file is the caller's job.
 *
 * Pure. See test/noteDrop.test.mjs.
 */

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
