import { Editor, Keymap, MarkdownFileInfo, MarkdownView, Menu, Notice, TFile, requestUrl } from "obsidian";
import { EditorView } from "@codemirror/view";
import type NotionBlock from "./main";
import { embedLink, extractPageTitle, singleHttpUrl, titledLink, wrapAsLink } from "./urlTitle";

/**
 * Notion's link paste: paste a URL, then choose to keep it, turn it into a
 * link titled with the page's own name, or embed it.
 *
 * The URL goes in first and the menu only offers to change it, so ignoring
 * the menu, dismissing it or typing on costs nothing: the paste is already
 * what a plain paste would have been.
 */
export function registerLinkPaste(plugin: NotionBlock): void {
	const keys = new PlainPasteKeys();
	keys.watch(plugin, window);
	plugin.registerEvent(plugin.app.workspace.on("window-open", (_win, win) => keys.watch(plugin, win)));
	plugin.registerEvent(
		plugin.app.workspace.on("editor-paste", (evt, editor, info) => onPaste(plugin, keys, evt, editor, info))
	);
}

/** A slow or hung site should not leave a link half-decided for long. */
const TITLE_TIMEOUT_MS = 10000;

/**
 * Recognises Shift+Cmd+V (Shift+Ctrl+V elsewhere), "paste as plain text".
 *
 * The paste event it produces looks like any other: Electron's
 * pasteAndMatchStyle hands Obsidian a ClipboardEvent carrying only
 * text/plain, which is also all a URL copied from a terminal carries, and
 * Obsidian passes it on with no flag. The keystroke is the only difference,
 * so it is watched in the capture phase, ahead of anything that might stop it.
 */
class PlainPasteKeys {
	/** How recently a paste keystroke still explains a paste event. */
	private static readonly WINDOW_MS = 1000;
	private last: { at: number; shift: boolean } | null = null;

	watch(plugin: NotionBlock, win: Window): void {
		plugin.registerDomEvent(win, "keydown", (evt) => this.onKeyDown(evt), { capture: true });
	}

	private onKeyDown(evt: KeyboardEvent): void {
		if (evt.key.toLowerCase() !== "v" || !Keymap.isModifier(evt, "Mod")) return;
		this.last = { at: Date.now(), shift: evt.shiftKey };
	}

	isPlainPaste(): boolean {
		const last = this.last;
		return last !== null && last.shift && Date.now() - last.at < PlainPasteKeys.WINDOW_MS;
	}
}

function onPaste(
	plugin: NotionBlock,
	keys: PlainPasteKeys,
	evt: ClipboardEvent,
	editor: Editor,
	info: MarkdownView | MarkdownFileInfo
): void {
	if (evt.defaultPrevented || !plugin.settings.enabled || !plugin.settings.linkPasteMenu || keys.isPlainPaste()) return;
	const url = singleHttpUrl(evt.clipboardData?.getData("text/plain") ?? "");
	if (url === null) return;
	// One paste into several carets is Obsidian's to spread out.
	if (editor.listSelections().length !== 1) return;

	const selection = editor.getSelection();
	if (selection !== "") {
		// A link cannot span lines; leave a multi-line selection to the
		// ordinary paste, which replaces it.
		if (selection.includes("\n")) return;
		evt.preventDefault();
		editor.replaceSelection(wrapAsLink(selection, url));
		return;
	}

	evt.preventDefault();
	const from = editor.posToOffset(editor.getCursor("from"));
	editor.replaceSelection(url);
	showPasteMenu(new PastedUrl(editor, info, from, url));
}

/**
 * The URL just pasted, and the guard on changing it later.
 *
 * The menu choice, and the title fetch after it, land some time after the
 * paste. By then the user may have typed on, undone the paste or switched
 * the pane to another note, so a replacement goes ahead only while the exact
 * URL is still where it was put; anything else means the user moved on.
 */
class PastedUrl {
	private readonly file: TFile | null;

	constructor(
		readonly editor: Editor,
		private readonly info: MarkdownView | MarkdownFileInfo,
		readonly from: number,
		readonly url: string
	) {
		this.file = info.file;
	}

	get to(): number {
		return this.from + this.url.length;
	}

	private isIntact(): boolean {
		if (this.info.file !== this.file) return false;
		const { editor } = this;
		const end = editor.offsetToPos(this.to);
		// offsetToPos clamps, so a document now shorter than the range would
		// otherwise compare a shorter slice.
		if (editor.posToOffset(end) !== this.to) return false;
		return editor.getRange(editor.offsetToPos(this.from), end) === this.url;
	}

	/** Swaps the URL for `text`; false, changing nothing, once it has moved. */
	replaceWith(text: string): boolean {
		if (!this.isIntact()) return false;
		const { editor } = this;
		const caretAtEnd = editor.posToOffset(editor.getCursor()) === this.to;
		editor.replaceRange(text, editor.offsetToPos(this.from), editor.offsetToPos(this.to));
		if (caretAtEnd) editor.setCursor(editor.offsetToPos(this.from + text.length));
		return true;
	}
}

function showPasteMenu(pasted: PastedUrl): void {
	const view = (pasted.editor as unknown as { cm?: EditorView }).cm;
	// Without the CodeMirror view there is no caret to place the menu at, and
	// the URL as pasted is already the default choice.
	if (!view) return;

	const menu = new Menu();
	// Does nothing on purpose: the URL is already in. It is listed so the
	// default is a visible, keyboard-reachable choice, as in Notion.
	menu.addItem((item) => item.setTitle("Keep as URL").setIcon("link").onClick(() => undefined));
	menu.addItem((item) =>
		item.setTitle("Link with page title").setIcon("heading").onClick(() => void linkWithTitle(pasted))
	);
	menu.addItem((item) =>
		item.setTitle("Embed").setIcon("image").onClick(() => pasted.replaceWith(embedLink(pasted.url)))
	);

	// Measured through CodeMirror's own cycle: coordsAtPos reads layout, and
	// the paste's transaction may not have been drawn yet.
	view.requestMeasure({
		read: () => view.coordsAtPos(pasted.to),
		write: (coords) => {
			if (coords) menu.showAtPosition({ x: coords.left, y: coords.bottom + 4 }, view.dom.ownerDocument);
		},
	});
}

async function linkWithTitle(pasted: PastedUrl): Promise<void> {
	const progress = new Notice("Fetching page title…", 0);
	let title: string | null = null;
	try {
		title = await withTimeout(fetchTitle(pasted.url), TITLE_TIMEOUT_MS);
	} catch {
		title = null;
	} finally {
		progress.hide();
	}

	if (title === null) {
		new Notice("Couldn't get the page title, so the link stays a URL.");
		return;
	}
	pasted.replaceWith(titledLink(title, pasted.url));
}

/**
 * The page's title, or null when it is not an HTML page or names nothing.
 *
 * requestUrl rather than fetch: it goes through Obsidian's own network layer,
 * which is not bound by CORS, and almost no page allows a cross-origin read.
 */
async function fetchTitle(url: string): Promise<string | null> {
	const response = await requestUrl({ url, throw: true });
	const contentType = Object.entries(response.headers)
		.find(([name]) => name.toLowerCase() === "content-type")?.[1] ?? "";
	// A PDF or an image has no title to read, and decoding it as text would
	// only produce noise for the parser.
	if (contentType !== "" && !/html/i.test(contentType)) return null;
	return extractPageTitle(response.text);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = window.setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
		promise.then(
			(value) => {
				window.clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				window.clearTimeout(timer);
				reject(error);
			}
		);
	});
}
