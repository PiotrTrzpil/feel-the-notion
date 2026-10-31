/**
 * Folder notes: a folder that is also a page, as in Notion.
 *
 * The note for folder `A/B` is `A/B/B.md`: inside the folder, named after it.
 * That is the "inside folder" layout of the Folder notes plugin, so vaults
 * that used it keep working unchanged.
 *
 * Path arithmetic only, DOM- and obsidian-free. See test/folderNotes.test.mjs.
 */

export function basename(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? path : path.slice(slash + 1);
}

export function parentPath(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? "" : path.slice(0, slash);
}

export function joinPath(folder: string, name: string): string {
	return folder === "" || folder === "/" ? name : `${folder}/${name}`;
}

/** Where the note of folder `folder` lives; null for the vault root, which has none. */
export function folderNotePath(folder: string): string | null {
	if (folder === "" || folder === "/") return null;
	return `${folder}/${basename(folder)}.md`;
}

/** The folder `notePath` is the note of, or null when it is an ordinary note. */
export function folderOfNote(notePath: string): string | null {
	if (!notePath.endsWith(".md")) return null;
	const folder = parentPath(notePath);
	return folder !== "" && folderNotePath(folder) === notePath ? folder : null;
}

/** A rename made to keep a folder and its note named alike. */
export interface FollowRename {
	kind: "file" | "folder";
	from: string;
	to: string;
}

/**
 * The rename that keeps a folder and its note in step after `oldPath` became
 * `newPath`, or null when nothing has to follow.
 *
 * A renamed folder takes its note along: `A/` → `B/` turns `B/A.md` into
 * `B/B.md`. A folder note renamed in place takes its folder along: `A/A.md` →
 * `A/B.md` renames `A/` to `B/`. A note MOVED out of its folder is just a note
 * again, and the folder stays as it is.
 *
 * The two never chain: after either, the pair is named alike again, which is
 * the state where neither rule matches.
 */
export function planFollowRename(oldPath: string, newPath: string, isFolder: boolean): FollowRename | null {
	if (isFolder) {
		const oldName = basename(oldPath);
		const newName = basename(newPath);
		if (oldName === newName) return null;
		return { kind: "file", from: `${newPath}/${oldName}.md`, to: `${newPath}/${newName}.md` };
	}

	const folder = folderOfNote(oldPath);
	if (folder === null || parentPath(newPath) !== folder || !newPath.endsWith(".md")) return null;
	const name = basename(newPath).slice(0, -".md".length);
	if (name === "") return null;
	return { kind: "folder", from: folder, to: joinPath(parentPath(folder), name) };
}

/**
 * Where a note's sub-pages go, and the move that first makes it a folder note
 * when it is not one yet: `A/Note.md` becomes `A/Note/Note.md`, and its
 * sub-pages go in `A/Note/`.
 */
export function planSubPageFolder(notePath: string): { folder: string; move: { from: string; to: string } | null } {
	const own = folderOfNote(notePath);
	if (own !== null) return { folder: own, move: null };
	const name = basename(notePath).replace(/\.md$/, "");
	const folder = joinPath(parentPath(notePath), name);
	return { folder, move: { from: notePath, to: `${folder}/${name}.md` } };
}

/**
 * `path` after a rename of `from` to `to`: itself, or for a path inside a
 * renamed folder, the same path under the new name. Null when unaffected.
 */
export function remapPath(path: string, from: string, to: string): string | null {
	return isWithin(path, from) ? to + path.slice(from.length) : null;
}

/** Whether `path` is `folder` itself or anything inside it. */
export function isWithin(path: string, folder: string): boolean {
	return path === folder || path.startsWith(`${folder}/`);
}
