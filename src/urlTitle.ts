/**
 * The text side of pasting a link: recognising a URL, reading a page's title
 * out of its HTML, and writing the markdown that links or embeds it.
 *
 * DOM- and obsidian-free, so it runs under node. See test/urlTitle.test.mjs.
 */

/**
 * The URL when `text` is exactly one http(s) URL, otherwise null.
 *
 * Surrounding whitespace is allowed, since copying from a terminal or an
 * address bar often brings a newline along. Anything else on the clipboard
 * means it is prose that happens to contain a link, and pastes as is.
 */
export function singleHttpUrl(text: string): string | null {
	const trimmed = text.trim();
	if (trimmed === "" || /\s/.test(trimmed)) return null;
	if (!/^https?:\/\//i.test(trimmed)) return null;
	try {
		// The prefix check alone accepts "https://" with nothing after it.
		if (new URL(trimmed).hostname === "") return null;
	} catch {
		return null;
	}
	return trimmed;
}

/**
 * A page's title: its `og:title`, then `twitter:title`, then `<title>`.
 *
 * The social titles come first because sites write them for exactly this, a
 * link shown somewhere else, and they usually leave off the " | Site name"
 * that `<title>` carries for browser tabs. Null when the page names itself
 * nothing, so the caller keeps the bare URL rather than linking empty text.
 */
export function extractPageTitle(html: string): string | null {
	const headEnd = html.search(/<\/head\s*>/i);
	// Searching the head first keeps an inline SVG's own <title> in the body
	// from being taken for the page's.
	const head = headEnd < 0 ? html : html.slice(0, headEnd);

	const meta = metaContents(head);
	for (const key of ["og:title", "twitter:title"]) {
		const title = cleanTitle(meta.get(key));
		if (title) return title;
	}

	const tag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head) ?? /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
	return cleanTitle(tag?.[1]);
}

/** The value as display text: entities decoded, whitespace collapsed. */
function cleanTitle(raw: string | undefined): string | null {
	if (raw === undefined) return null;
	const text = decodeHtmlEntities(raw).replace(/\s+/g, " ").trim();
	return text === "" ? null : text;
}

// Attribute values may contain ">" unescaped, so a tag runs to the first ">"
// outside quotes rather than the first ">" anywhere.
const META_TAG = /<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const ATTRIBUTE = /([^\s=/>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

/** `property`/`name` → `content` for every `<meta>`, first occurrence wins. */
function metaContents(html: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const [tag] of html.matchAll(META_TAG)) {
		const attrs = new Map<string, string>();
		for (const m of tag.matchAll(ATTRIBUTE)) {
			attrs.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? "");
		}
		// Open Graph specifies `property`, but plenty of pages write `name`.
		const key = (attrs.get("property") ?? attrs.get("name"))?.toLowerCase();
		const content = attrs.get("content");
		if (key && content !== undefined && !out.has(key)) out.set(key, content);
	}
	return out;
}

/**
 * The entities that turn up in titles. Not the full HTML table: a title is a
 * line of prose, and an unknown entity is left as written rather than guessed.
 */
const NAMED_ENTITIES: Record<string, string> = {
	amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
	ndash: "–", mdash: "—", hellip: "…", middot: "·", bull: "•",
	lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»",
	copy: "©", reg: "®", trade: "™", deg: "°", times: "×",
	euro: "€", pound: "£", yen: "¥", cent: "¢",
};

/** Decodes numeric entities and the common named ones. */
export function decodeHtmlEntities(text: string): string {
	return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (entity, body: string) => {
		if (body[0] !== "#") return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? entity;
		const hex = body[1] === "x" || body[1] === "X";
		const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
		// What a browser does with a null, a surrogate or an out-of-range code.
		if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�";
		return String.fromCodePoint(code);
	});
}

/**
 * Text made safe to sit between `[` and `]`.
 *
 * A bracket in a title ("[PDF] Report") would otherwise end the link text
 * early. Backslashes are escaped too, or a title ending in one would escape
 * the closing bracket itself.
 */
export function escapeLinkText(text: string): string {
	return text.replace(/[\\[\]]/g, "\\$&");
}

/**
 * The URL as a link destination.
 *
 * Balanced parentheses are fine bare (Wikipedia's "Foo_(bar)"); unbalanced
 * ones would end the destination early, so those go in angle brackets, which
 * Obsidian reads as well. `<` and `>` are percent-encoded so they cannot close
 * that form; a browser would encode them on the way out anyway.
 */
export function linkDestination(url: string): string {
	const dest = url.replace(/[<>]/g, (c) => encodeURIComponent(c));
	return parensBalanced(dest) ? dest : `<${dest}>`;
}

function parensBalanced(text: string): boolean {
	let depth = 0;
	for (const c of text) {
		if (c === "(") depth++;
		else if (c === ")" && --depth < 0) return false;
	}
	return depth === 0;
}

/** `[title](url)` for a fetched page title, which is plain text. */
export function titledLink(title: string, url: string): string {
	return `[${escapeLinkText(title)}](${linkDestination(url)})`;
}

/**
 * `[selection](url)` for text the URL was pasted over.
 *
 * The selection is not escaped: it is the user's own markdown, and "**bold**"
 * selected and linked should stay bold.
 */
export function wrapAsLink(selection: string, url: string): string {
	return `[${selection}](${linkDestination(url)})`;
}

/** `![](url)`, which Obsidian renders for images, YouTube and tweets. */
export function embedLink(url: string): string {
	return `![](${linkDestination(url)})`;
}
