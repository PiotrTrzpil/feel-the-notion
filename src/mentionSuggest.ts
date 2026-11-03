import {
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	SearchResult,
	TFile,
	moment,
	prepareFuzzySearch,
	renderResults,
} from "obsidian";
import { EditorView } from "@codemirror/view";
import type NotionBlock from "./main";
import { findMentionQuery } from "./mentionTrigger";
import { isInsideCodeFence } from "./codeFence";
import { renderIcon, shownPageIcon } from "./pageIcons";
import { PageIcon } from "./pageMeta";

/**
 * Notion's `@` mention: type `@`, pick a date or a page, get its text or link.
 *
 * Dates are inserted as text in the plugin's date format, the same text the
 * insert menu's date blocks write. Pages become a link built by
 * generateMarkdownLink, so the vault's wikilink/markdown and path settings
 * apply rather than a hand-built "[[name]]".
 */
export function registerMentionSuggest(plugin: NotionBlock): void {
	plugin.registerEditorSuggest(new MentionSuggest(plugin));
}

/** Enough to find a page by name without the list running off the screen. */
const NOTE_LIMIT = 10;

/**
 * The slice of moment's API used here. Obsidian re-exports moment without
 * types the compiler can follow; naming the calls keeps the formats checked.
 */
interface MomentLike {
	format(pattern: string): string;
	add(amount: number, unit: string): MomentLike;
}

const now = (): MomentLike => moment() as unknown as MomentLike;

type MentionItem =
	| { kind: "date"; label: string; text: string; icon: PageIcon; match: SearchResult | null }
	| { kind: "note"; file: TFile; match: SearchResult | null };

class MentionSuggest extends EditorSuggest<MentionItem> {
	/**
	 * The `@` the user dismissed, as "path:line:col", so it stays dismissed.
	 *
	 * Obsidian re-runs onTrigger on every keystroke, so without this, Escape
	 * would hide the list only until the next character brought it back.
	 * Notion leaves a dismissed `@` alone as plain text, and so does this.
	 */
	private dismissed: string | null = null;
	/** Whether the last query matched nothing, which also closes the list. */
	private lastWasEmpty = false;

	constructor(private readonly plugin: NotionBlock) {
		super(plugin.app);
		this.limit = 4 + NOTE_LIMIT;
	}

	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		if (!this.plugin.settings.enabled || !this.plugin.settings.mentions || !file) return null;

		const found = findMentionQuery(editor.getLine(cursor.line).slice(0, cursor.ch));
		if (!found) {
			// The dismissed `@` is gone or the caret left it: a new `@` typed
			// in the same spot later is a new mention.
			this.dismissed = null;
			return null;
		}
		const key = mentionKey(file, cursor.line, found.col);
		if (key === this.dismissed) return null;
		this.dismissed = null;

		if (this.inFrontmatter(file, cursor.line) || inCodeFence(editor, cursor.line)) return null;

		return { start: { line: cursor.line, ch: found.col }, end: cursor, query: found.query };
	}

	getSuggestions(context: EditorSuggestContext): MentionItem[] {
		const query = context.query.trim();
		const items = [...this.dateItems(query), ...this.noteItems(query, context.file)];
		this.lastWasEmpty = items.length === 0;
		return items;
	}

	renderSuggestion(item: MentionItem, el: HTMLElement): void {
		el.addClass("mod-complex", "ftn-mention-item");
		const icon = el.createDiv({ cls: "suggestion-icon" }).createSpan({ cls: "suggestion-flair ftn-mention-icon" });
		const content = el.createDiv({ cls: "suggestion-content" });
		const title = content.createDiv({ cls: "suggestion-title" });

		if (item.kind === "date") {
			renderIcon(icon, item.icon);
			renderLabel(title, item.label, item.match);
			content.createDiv({ cls: "suggestion-note", text: item.text });
			return;
		}

		renderIcon(icon, shownPageIcon(this.plugin, item.file));
		renderLabel(title, item.file.basename, item.match);
		const folder = item.file.parent;
		if (folder && !folder.isRoot()) content.createDiv({ cls: "suggestion-note", text: folder.path });
	}

	selectSuggestion(item: MentionItem): void {
		const context = this.context;
		if (!context) return;

		const text = item.kind === "date"
			? item.text
			: this.app.fileManager.generateMarkdownLink(item.file, context.file.path);
		context.editor.replaceRange(text, context.start, context.end);
		// Set rather than left to mapping: the caret sat at the end of the
		// replaced range, and where that maps to is the editor's choice.
		context.editor.setCursor({ line: context.start.line, ch: context.start.ch + text.length });
		this.close();
	}

	/**
	 * Closing with the query still live and matches on screen is a dismissal:
	 * Escape, or focus moving away. Every other close leaves the query dead
	 * (the `@` replaced or deleted, the caret moved off it) or follows an
	 * empty match list, which reopens by itself once the query matches again.
	 */
	close(): void {
		const context = this.context;
		if (context && !this.lastWasEmpty && queryIsLive(context)) {
			this.dismissed = mentionKey(context.file, context.start.line, context.start.ch);
		}
		super.close();
	}

	private dateItems(query: string): MentionItem[] {
		const { dateFormat, timeFormat } = this.plugin.settings;
		const day = (offset: number): string => now().add(offset, "days").format(dateFormat);
		const calendar: PageIcon = { kind: "lucide", id: "calendar" };
		const candidates = [
			{ label: "Today", text: day(0), icon: calendar },
			{ label: "Tomorrow", text: day(1), icon: calendar },
			{ label: "Yesterday", text: day(-1), icon: calendar },
			{ label: "Now", text: `${day(0)} ${now().format(timeFormat)}`, icon: { kind: "lucide", id: "clock" } as PageIcon },
		];
		if (query === "") return candidates.map((c) => ({ kind: "date", ...c, match: null }));

		const fuzzy = prepareFuzzySearch(query);
		const out: MentionItem[] = [];
		for (const c of candidates) {
			const match = fuzzy(c.label);
			if (match) out.push({ kind: "date", ...c, match });
		}
		return out;
	}

	/**
	 * Notes whose name matches, best first. With nothing typed yet, the
	 * recently opened ones, which is what Notion shows and what is most often
	 * meant.
	 */
	private noteItems(query: string, current: TFile): MentionItem[] {
		const { vault, workspace } = this.app;
		if (query === "") {
			const out: MentionItem[] = [];
			for (const path of workspace.getLastOpenFiles()) {
				const file = vault.getAbstractFileByPath(path);
				if (file instanceof TFile && file.extension === "md" && file !== current) {
					out.push({ kind: "note", file, match: null });
					if (out.length === NOTE_LIMIT) break;
				}
			}
			return out;
		}

		const fuzzy = prepareFuzzySearch(query);
		const scored: { file: TFile; match: SearchResult }[] = [];
		for (const file of vault.getMarkdownFiles()) {
			if (file === current) continue;
			const match = fuzzy(file.basename);
			if (match) scored.push({ file, match });
		}
		scored.sort((a, b) => b.match.score - a.match.score);
		return scored.slice(0, NOTE_LIMIT).map(({ file, match }) => ({ kind: "note", file, match }));
	}

	/**
	 * Properties are not prose: an `@` in a frontmatter value is a handle or
	 * an address, and a link written there by accident is hard to see in the
	 * properties view.
	 */
	private inFrontmatter(file: TFile, line: number): boolean {
		const position = this.app.metadataCache.getFileCache(file)?.frontmatterPosition;
		return position !== undefined && line <= position.end.line;
	}
}

function mentionKey(file: TFile, line: number, col: number): string {
	return `${file.path}:${line}:${col}`;
}

/** Whether the caret is still in the `@query` the context describes. */
function queryIsLive(context: EditorSuggestContext): boolean {
	const { editor, start } = context;
	const caret = editor.getCursor();
	return caret.line === start.line && caret.ch > start.ch && editor.getLine(start.line)[start.ch] === "@";
}

/** In code, `@` is a decorator or an annotation, never a mention. */
function inCodeFence(editor: Editor, line: number): boolean {
	const view = (editor as unknown as { cm?: EditorView }).cm;
	return view !== undefined && isInsideCodeFence(view.state.doc, line + 1);
}

function renderLabel(el: HTMLElement, text: string, match: SearchResult | null): void {
	if (match) renderResults(el, text, match);
	else el.setText(text);
}
