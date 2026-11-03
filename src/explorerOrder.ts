/**
 * The order of a folder note's children in the file explorer.
 *
 * The note is the source of that order: sub-pages it links, in the order it
 * links them, then sub-pages it never links, by name. Files that are not
 * pages come last. Pure. See test/explorerOrder.test.mjs.
 */

export interface TreeChild {
	path: string;
	name: string;
	/** A markdown note or a folder. The folder's own note is not one. */
	page: boolean;
}

/**
 * The direct child of `folder` that a link to `target` names.
 *
 * A note in the folder is itself. Anything deeper is the subfolder it sits
 * in, since the explorer shows that subfolder as the one row. The folder's
 * own note, a non-page file, and anything outside the folder are not a
 * sub-page.
 */
export function childForTarget(folder: string, target: string, ownNote: string): string | null {
	if (folder === "" || target === ownNote || !target.startsWith(`${folder}/`)) return null;
	const rest = target.slice(folder.length + 1);
	const slash = rest.indexOf("/");
	if (slash === -1) return rest.endsWith(".md") ? target : null;
	return `${folder}/${rest.slice(0, slash)}`;
}

/**
 * `children` in sub-page order.
 *
 * `mentioned` is child paths in the order the note links them. The first link
 * wins; a path that is not a child is ignored. Pages the note never links
 * follow, by name, the same way the sub-pages list orders them, and files
 * that are not pages follow those.
 */
export function orderSubpages<T extends TreeChild>(children: readonly T[], mentioned: readonly string[]): T[] {
	const byPath = new Map(children.map((child) => [child.path, child]));
	const used = new Set<string>();
	const ordered: T[] = [];
	for (const path of mentioned) {
		const child = byPath.get(path);
		if (!child || used.has(path)) continue;
		used.add(path);
		ordered.push(child);
	}

	const rest = children.filter((child) => !used.has(child.path));
	const pages = rest.filter((child) => child.page).sort(byName);
	const files = rest.filter((child) => !child.page).sort(byName);
	return [...ordered, ...pages, ...files];
}

function byName(a: TreeChild, b: TreeChild): number {
	return a.name.localeCompare(b.name, undefined, { numeric: true });
}
