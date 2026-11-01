/**
 * Page templates: a note in the templates folder, copied into an empty page
 * with a few variables filled in, as Notion's templates are.
 *
 * Deliberately small: {{title}}, {{date}}, {{time}}, and {{date:FORMAT}} /
 * {{time:FORMAT}} with a moment format. The same syntax as Obsidian's core
 * Templates plugin, so existing templates work; anything needing code stays
 * Templater's job.
 *
 * Pure. See test/pageTemplate.test.mjs.
 */

export interface TemplateContext {
	title: string;
	dateFormat: string;
	timeFormat: string;
	/** Formats the current moment with a moment format string. */
	format: (pattern: string) => string;
}

const VARIABLE = /{{\s*(title|date|time)\s*(?::([^}]*))?}}/gi;

export function fillTemplate(text: string, ctx: TemplateContext): string {
	return text.replace(VARIABLE, (_match, name: string, pattern: string | undefined) => {
		const key = name.toLowerCase();
		if (key === "title") return ctx.title;
		const custom = pattern?.trim();
		return ctx.format(custom || (key === "date" ? ctx.dateFormat : ctx.timeFormat));
	});
}

/** A note split into its frontmatter YAML (without the fences) and the rest. */
export function splitFrontmatter(text: string): { frontmatter: string | null; body: string } {
	const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
	if (match === null) return { frontmatter: null, body: text };
	return { frontmatter: match[1], body: text.slice(match[0].length) };
}

/**
 * Whether a note counts as an empty page a template may fill: nothing but
 * whitespace after its frontmatter. Frontmatter alone (an icon, a cover)
 * still counts as empty, as a Notion page with only an icon does.
 */
export function isEmptyPage(text: string): boolean {
	return splitFrontmatter(text).body.trim() === "";
}
