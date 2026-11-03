/**
 * Page icon and cover, as Notion has them, read from and written to a note's
 * frontmatter.
 *
 * The keys are the ones Iconize (`icon`) and Pixel Banner (`banner`,
 * `banner-y`) write, so notes decorated with either keep their icon and cover
 * without migrating anything.
 *
 * DOM- and obsidian-free. See test/pageMeta.test.mjs.
 */

export const ICON_KEY = "icon";
export const COVER_KEY = "banner";
export const COVER_Y_KEY = "banner-y";

/** An emoji or other text, or a Lucide icon id (`book-open`, no prefix). */
export type PageIcon = { kind: "text"; text: string } | { kind: "lucide"; id: string };

/** What a page shows when it has no icon of its own. Lucide's document icon. */
export const DEFAULT_PAGE_ICON: PageIcon = { kind: "lucide", id: "file-text" };

/** What a folder shows when it is not a page and has no icon of its own. */
export const DEFAULT_FOLDER_ICON: PageIcon = { kind: "lucide", id: "folder" };

const LUCIDE_PREFIX = "lucide-";
/** Iconize's own spelling of a Lucide icon: `Li` then the PascalCase name. */
const ICONIZE_LUCIDE = /^Li([A-Z][A-Za-z0-9]*)$/;

/** The icon a frontmatter value describes, or null for none. */
export function parseIcon(value: unknown): PageIcon | null {
	if (typeof value !== "string") return null;
	const text = value.trim();
	if (text === "") return null;
	if (text.startsWith(LUCIDE_PREFIX) && text.length > LUCIDE_PREFIX.length) {
		return { kind: "lucide", id: text.slice(LUCIDE_PREFIX.length) };
	}
	const iconize = ICONIZE_LUCIDE.exec(text);
	if (iconize) return { kind: "lucide", id: kebab(iconize[1]) };
	return { kind: "text", text };
}

/** The frontmatter value that stores `icon`. */
export function formatIcon(icon: PageIcon): string {
	return icon.kind === "lucide" ? LUCIDE_PREFIX + icon.id : icon.text;
}

/** `ArrowUpRight` → `arrow-up-right`, `Building2` → `building-2`. */
function kebab(pascal: string): string {
	return pascal
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.replace(/([A-Za-z])([0-9])/g, "$1-$2")
		.toLowerCase();
}

/** Where a cover comes from: a vault image by link text, a URL, or a built-in gradient. */
export type CoverSource =
	| { kind: "link"; linktext: string }
	| { kind: "url"; url: string }
	| { kind: "gradient"; id: string };

const GRADIENT_PREFIX = "gradient:";

/** Built-in covers, after Notion's "Color & Gradient" set; `banner: gradient:<id>`. */
export const COVER_GRADIENTS: Readonly<Record<string, string>> = {
	sunset: "linear-gradient(135deg, #f6d365 0%, #fda085 100%)",
	peach: "linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)",
	ocean: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
	forest: "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
	lavender: "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)",
	night: "linear-gradient(135deg, #30cfd0 0%, #330867 100%)",
	slate: "linear-gradient(135deg, #485563 0%, #29323c 100%)",
	sand: "linear-gradient(135deg, #e6dada 0%, #c9b79c 100%)",
};

export function formatGradientCover(id: string): string {
	return GRADIENT_PREFIX + id;
}

export interface Cover {
	source: CoverSource;
	/** Vertical focus, 0 (top) to 100 (bottom). */
	y: number;
}

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const WIKI = /^!?\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/;
const MARKDOWN = /^!?\[[^\]]*\]\(<?([^)>]+)>?\)$/;

/** The cover in `frontmatter`, or null when it has none. */
export function parseCover(frontmatter: Record<string, unknown> | undefined): Cover | null {
	const raw = frontmatter?.[COVER_KEY];
	if (typeof raw !== "string" || raw.trim() === "") return null;
	return { source: parseCoverSource(raw.trim()), y: clampPercent(frontmatter?.[COVER_Y_KEY], 50) };
}

function parseCoverSource(value: string): CoverSource {
	if (value.startsWith(GRADIENT_PREFIX)) {
		const id = value.slice(GRADIENT_PREFIX.length).trim();
		if (id in COVER_GRADIENTS) return { kind: "gradient", id };
	}
	const wiki = WIKI.exec(value);
	if (wiki) return { kind: "link", linktext: wiki[1].trim() };
	const markdown = MARKDOWN.exec(value);
	const target = markdown ? markdown[1].trim() : value;
	if (URL_SCHEME.test(target)) return { kind: "url", url: target };
	let linktext = target;
	try {
		linktext = decodeURI(target);
	} catch {
		// Not percent-encoded after all; the text is the path as written.
	}
	return { kind: "link", linktext };
}

/** A number 0–100 from a frontmatter value, `fallback` when it is not one. */
export function clampPercent(value: unknown, fallback: number): number {
	const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
	if (!Number.isFinite(n)) return fallback;
	return Math.min(100, Math.max(0, Math.round(n)));
}

/** The frontmatter value that stores a vault image as a cover; a link, so renames follow it. */
export function formatCoverLink(linktext: string): string {
	return `[[${linktext}]]`;
}

export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"]);

/** Whether `query` is something to use as a cover URL as typed. */
export function isCoverUrl(query: string): boolean {
	return /^https?:\/\/\S+$/i.test(query.trim());
}

/**
 * Whether `query` holds an emoji, which the icon picker then offers as typed.
 * Lets any emoji be used, from the system picker (Ctrl+Cmd+Space) or a paste,
 * without shipping the whole emoji table.
 */
export function containsEmoji(query: string): boolean {
	return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(query);
}

/** A curated emoji, with the words it is found by. */
export interface EmojiEntry {
	emoji: string;
	keywords: string;
}

/** What the icon picker shows before anything is typed, and searches by keyword. */
export const EMOJIS: readonly EmojiEntry[] = [
	["📄", "page document file"], ["📝", "memo note write"], ["📓", "notebook journal"], ["📕", "book red"],
	["📗", "book green"], ["📘", "book blue"], ["📙", "book orange"], ["📚", "books library reading"],
	["📖", "open book read"], ["🗂️", "folders index dividers"], ["📁", "folder"], ["🗃️", "card box archive"],
	["📌", "pin"], ["📎", "paperclip attachment"], ["🔖", "bookmark"], ["🏷️", "tag label"],
	["✅", "done check task"], ["☑️", "checkbox todo"], ["📅", "calendar date"], ["🗓️", "planner schedule"],
	["⏰", "alarm clock time"], ["⌛", "hourglass wait"], ["🎯", "goal target"], ["🚀", "rocket launch project"],
	["💡", "idea bulb"], ["🧠", "brain mind think"], ["💭", "thought dream"], ["💬", "chat discussion"],
	["🗯️", "speech shout"], ["❓", "question"], ["❗", "important exclamation"], ["⭐", "star favorite"],
	["🌟", "glowing star"], ["✨", "sparkles magic"], ["🔥", "fire hot"], ["⚡", "lightning energy"],
	["❤️", "heart love"], ["🧡", "orange heart"], ["💙", "blue heart"], ["💚", "green heart"],
	["🏠", "home house"], ["🏢", "office building work"], ["💼", "briefcase work job"], ["🛠️", "tools build"],
	["⚙️", "gear settings"], ["🔧", "wrench fix"], ["💻", "laptop computer code"], ["🖥️", "desktop computer"],
	["📱", "phone mobile"], ["🤖", "robot ai bot"], ["🔒", "lock security private"], ["🔑", "key password"],
	["💰", "money finance"], ["📈", "chart growth up"], ["📉", "chart down decline"], ["📊", "bar chart stats"],
	["🧾", "receipt invoice"], ["🛒", "shopping cart"], ["🎁", "gift present"], ["🎉", "party celebrate"],
	["🎨", "art palette design"], ["🖼️", "picture frame image"], ["📷", "camera photo"], ["🎬", "film movie"],
	["🎵", "music note song"], ["🎮", "game controller"], ["⚽", "football sport"], ["🏃", "run exercise"],
	["🧘", "yoga meditate"], ["🧬", "dna health science"], ["💊", "pill medicine health"], ["🍎", "apple food"],
	["☕", "coffee"], ["🍽️", "food meal recipe"], ["🌱", "seedling grow plant"], ["🌳", "tree nature"],
	["🌊", "wave ocean water"], ["🌅", "sunrise morning"], ["🌙", "moon night"], ["☀️", "sun day"],
	["🌍", "globe world earth"], ["🌐", "web internet globe"], ["✈️", "plane travel flight"], ["🧳", "luggage travel trip"],
	["🗺️", "map"], ["🏔️", "mountain"], ["🏖️", "beach holiday"], ["🚗", "car drive"],
	["👤", "person user profile"], ["👥", "people team group"], ["👨‍👩‍👧", "family"], ["🎓", "graduation school study"],
	["🧪", "test experiment lab"], ["🔬", "microscope research"], ["📐", "ruler design math"], ["🧩", "puzzle piece"],
	["☯️", "yin yang balance"], ["🕶️", "sunglasses cool"], ["🎇", "fireworks"], ["💢", "anger symbol"],
].map(([emoji, keywords]) => ({ emoji, keywords }));

/** Notion's per-page "Full width" and "Small text", stored as cssclasses. */
export const PAGE_OPTIONS = {
	wide: "ftn-wide",
	small: "ftn-small",
} as const;
export type PageOption = keyof typeof PAGE_OPTIONS;

/** A `cssclasses` value as a list; Obsidian accepts a string too. */
export function cssClassList(value: unknown): string[] {
	if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
	if (typeof value === "string") return value.split(/[\s,]+/).filter((v) => v !== "");
	return [];
}

/** `value` with `cls` added or removed, other classes kept in order. */
export function withCssClass(value: unknown, cls: string, on: boolean): string[] {
	const list = cssClassList(value).filter((v) => v !== cls);
	return on ? [...list, cls] : list;
}
