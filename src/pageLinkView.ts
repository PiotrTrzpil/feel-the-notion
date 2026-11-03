import { EditorState, Prec, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { Keymap, MarkdownView, TFile, debounce, editorInfoField } from "obsidian";
import type NotionBlock from "./main";
import { findFencedLines } from "./codeFence";
import { embedAsAttachmentRow, isAttachmentPath } from "./attachmentLink";
import { findLinks, NoteLink } from "./fileDrop";
import { PageIcon, formatIcon } from "./pageMeta";
import { renderIcon, shownPageIcon } from "./pageIcons";
import { isNestedPage, isWholeLineLink } from "./pageLink";

/** What an attachment shows, distinct from a page's document icon. */
const ATTACHMENT_ICON: PageIcon = { kind: "lucide", id: "paperclip" };

/**
 * Draws a link to a sub-page, or to a page nested under one, as a single
 * block: the page's icon and its title. A link to an attachment is the same
 * kind of block, with a paperclip and the file name. An embedded PDF is too:
 * Obsidian would otherwise draw its full viewer. Other embeds stay embeds.
 *
 * The link text stays in the note. A replace decoration covers all of it, on
 * the active line as well as the others, so Live Preview never puts the
 * brackets or the title's letters back when the caret arrives. The same
 * ranges are atomic, so Left/Right and Backspace treat the link as one unit
 * — Backspace beside it deletes the whole link, because the character it
 * would remove sits strictly inside the atomic range.
 */

const pageLinksChanged = StateEffect.define<null>();

function pageLinksOn(plugin: NotionBlock): boolean {
	const { settings } = plugin;
	return settings.enabled && settings.folderNotes && settings.pageLinkBlocks;
}

function attachmentsOn(plugin: NotionBlock): boolean {
	const { settings } = plugin;
	return settings.enabled && settings.attachmentLinks;
}

class PageLinkWidget extends WidgetType {
	constructor(
		private readonly label: string,
		private readonly iconKey: string,
		private readonly icon: ReturnType<typeof shownPageIcon>,
		private readonly linktext: string,
		private readonly sourcePath: string,
		private readonly block: boolean,
		private readonly plugin: NotionBlock,
	) {
		super();
	}

	eq(other: PageLinkWidget): boolean {
		return other.label === this.label
			&& other.iconKey === this.iconKey
			&& other.linktext === this.linktext
			&& other.sourcePath === this.sourcePath
			&& other.block === this.block;
	}

	toDOM(): HTMLElement {
		const el = createSpan({ cls: this.block ? "ftn-page-link is-block" : "ftn-page-link" });
		// The editor's content is editable. This keeps the caret out of the
		// title's letters even if a click lands on the widget itself.
		el.contentEditable = "false";
		renderIcon(el.createSpan({ cls: "ftn-page-link-icon" }), this.icon);
		el.createSpan({ cls: "ftn-page-link-name", text: this.label });
		el.addEventListener("click", (evt) => {
			if (evt.button !== 0) return;
			evt.preventDefault();
			void this.plugin.app.workspace.openLinkText(this.linktext, this.sourcePath, Keymap.isModEvent(evt));
		});
		el.addEventListener("mouseover", (event) => {
			this.plugin.app.workspace.trigger("hover-link", {
				event,
				source: "feel-the-notion",
				hoverParent: el,
				targetEl: el,
				linktext: this.linktext,
				sourcePath: this.sourcePath,
			});
		});
		return el;
	}

	// Clicks open the page. A right-click still reaches the editor menu.
	ignoreEvent(event: Event): boolean {
		return event.type !== "contextmenu";
	}
}

function isInCode(state: EditorState, pos: number): boolean {
	const name = syntaxTree(state).resolveInner(pos, 1).name;
	return /code|math/i.test(name);
}

/** A row the editor draws in place of a link. */
interface ShownLink {
	from: number;
	to: number;
	/** The line's end, when the PDF embed is the whole line. */
	lineTo: number;
	label: string;
	icon: PageIcon;
	linktext: string;
	sourcePath: string;
	block: boolean;
	/**
	 * The embed starts the line and nothing follows it, which is when Live
	 * Preview draws the PDF as a block widget covering the line.
	 */
	pdfBlock: boolean;
}

function shownLinks(plugin: NotionBlock, state: EditorState, from: number, to: number): ShownLink[] {
	const pages = pageLinksOn(plugin);
	const attachments = attachmentsOn(plugin);
	if (!pages && !attachments) return [];
	const sourcePath = state.field(editorInfoField, false)?.file?.path ?? "";
	if (sourcePath === "") return [];
	const fenced = findFencedLines(state.doc);
	const out: ShownLink[] = [];

	let pos = from;
	while (pos <= to && pos < state.doc.length) {
		const line = state.doc.lineAt(pos);
		if (!fenced.has(line.number)) {
			for (const link of findLinks(line.text)) {
				const shown = shownLink(plugin, state, sourcePath, line.from, line.to, line.text, link, pages, attachments);
				if (shown) out.push(shown);
			}
		}
		if (line.to + 1 > to) break;
		pos = line.to + 1;
	}
	return out;
}

function shownLink(
	plugin: NotionBlock,
	state: EditorState,
	sourcePath: string,
	lineFrom: number,
	lineTo: number,
	lineText: string,
	link: NoteLink,
	pages: boolean,
	attachments: boolean,
): ShownLink | null {
	const from = lineFrom + link.from;
	if (isInCode(state, from)) return null;
	const target = plugin.app.metadataCache.getFirstLinkpathDest(link.path, sourcePath);
	if (!(target instanceof TFile)) return null;
	// An embed is the file itself — an image stays an image. A PDF does not:
	// its embed is the viewer, and the row is what a page of notes wants.
	const pdf = link.embed && embedAsAttachmentRow(target.extension);
	if (link.embed && !(pdf && attachments)) return null;
	const page = pages && !link.embed && isNestedPage(sourcePath, target.path);
	const attachment = !page && attachments && isAttachmentPath(target.path);
	if (!page && !attachment) return null;
	const icon = page ? shownPageIcon(plugin, target) : ATTACHMENT_ICON;
	const ownsLine = link.from === 0 && lineText.slice(link.to).trim() === "";
	return {
		from,
		to: lineFrom + link.to,
		lineTo,
		label: page ? target.basename : target.name,
		icon,
		linktext: link.path + link.subpath,
		sourcePath,
		block: isWholeLineLink(lineText, link.from, link.to),
		pdfBlock: pdf && ownsLine,
	};
}

function linkWidget(plugin: NotionBlock, link: ShownLink): PageLinkWidget {
	return new PageLinkWidget(
		link.label,
		formatIcon(link.icon),
		link.icon,
		link.linktext,
		link.sourcePath,
		link.block,
		plugin,
	);
}

function buildDecorations(plugin: NotionBlock, view: EditorView): DecorationSet {
	const ranges = new RangeSetBuilder<Decoration>();
	for (const visible of view.visibleRanges) {
		for (const link of shownLinks(plugin, view.state, visible.from, visible.to)) {
			ranges.add(link.from, link.to, Decoration.replace({
				widget: linkWidget(plugin, link),
				inclusive: false,
			}));
		}
	}
	return ranges.finish();
}

/**
 * Block replacements for PDF embeds that own their line.
 *
 * Live Preview covers that line with a block widget (the viewer). An inline
 * replacement of the same text loses to it, because a block widget is ordered
 * first. This replacement is a block widget too, at a higher precedence, so
 * the viewer is never built. It has to be a state field: a view plugin is
 * not allowed to replace a line with a block widget.
 */
function buildPdfBlocks(plugin: NotionBlock, state: EditorState): DecorationSet {
	const ranges = new RangeSetBuilder<Decoration>();
	for (const link of shownLinks(plugin, state, 0, state.doc.length)) {
		if (!link.pdfBlock) continue;
		ranges.add(link.from, link.lineTo, Decoration.replace({
			widget: linkWidget(plugin, link),
			block: true,
		}));
	}
	return ranges.finish();
}

function pdfBlockField(plugin: NotionBlock): StateField<DecorationSet> {
	return StateField.define<DecorationSet>({
		create(state) {
			return buildPdfBlocks(plugin, state);
		},
		update(deco, tr) {
			const asked = tr.effects.some((effect) => effect.is(pageLinksChanged));
			if (!asked && !tr.docChanged) return deco;
			return buildPdfBlocks(plugin, tr.state);
		},
		provide: (field) => EditorView.decorations.from(field),
	});
}

export function pageLinkExtension(plugin: NotionBlock) {
	const pluginClass = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = buildDecorations(plugin, view);
			}

			update(update: ViewUpdate) {
				const asked = update.transactions.some((tr) => tr.effects.some((effect) => effect.is(pageLinksChanged)));
				if (asked || update.docChanged || update.viewportChanged) {
					this.decorations = buildDecorations(plugin, update.view);
				}
			}
		},
		{ decorations: (value) => value.decorations },
	);

	return [
		// Above Live Preview, which puts the source of a link back on the
		// line the caret is on, and which draws a PDF embed as a block widget.
		// Both replacements have to stay on top of that, or the title's letters
		// — and the viewer — reappear the moment the block is active.
		Prec.highest(pluginClass),
		Prec.highest(pdfBlockField(plugin)),
		EditorView.atomicRanges.of((view) => buildDecorations(plugin, view)),
	];
}

/** A rendered link whose parent holds nothing else is a block, not a chip. */
function isSoleLink(anchor: HTMLElement): boolean {
	const parent = anchor.parentElement;
	if (!parent || !parent.matches("p, li, div")) return false;
	for (const node of Array.from(parent.childNodes)) {
		if (node === anchor) continue;
		if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() === "") continue;
		return false;
	}
	return true;
}

/**
 * Keeps page-link blocks in the editor and in Reading view, and redraws them
 * when a page's icon or name changes.
 */
export class PageLinks {
	private readonly redraw = debounce(() => this.redrawEditors(), 100, true);

	constructor(private readonly plugin: NotionBlock) {
		const { app } = plugin;
		plugin.registerEditorExtension(pageLinkExtension(plugin));
		plugin.registerMarkdownPostProcessor((el, ctx) => this.decorateRendered(el, ctx.sourcePath));
		plugin.registerEvent(app.metadataCache.on("changed", () => this.redraw()));
		plugin.registerEvent(app.vault.on("rename", () => this.redraw()));
		this.syncRows();
		plugin.register(() => document.body.removeClass("ftn-attachment-rows"));
	}

	/** Re-draws after a setting changed. */
	update(): void {
		this.syncRows();
		this.redraw();
	}

	/** Hides the viewer Live Preview still mounts beside the caret. */
	private syncRows(): void {
		document.body.toggleClass("ftn-attachment-rows", attachmentsOn(this.plugin));
	}

	private redrawEditors(): void {
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			if (!(leaf.view instanceof MarkdownView)) return;
			const cm = (leaf.view.editor as unknown as { cm?: EditorView }).cm;
			cm?.dispatch({ effects: pageLinksChanged.of(null) });
		});
	}

	private decorateRendered(el: HTMLElement, sourcePath: string): void {
		const pages = pageLinksOn(this.plugin);
		const attachments = attachmentsOn(this.plugin);
		if ((!pages && !attachments) || sourcePath === "") return;
		if (attachments) this.replacePdfEmbeds(el, sourcePath);
		const { app } = this.plugin;
		el.querySelectorAll<HTMLAnchorElement>("a.internal-link").forEach((anchor) => {
			if (anchor.classList.contains("ftn-page-link")) return;
			const target = app.metadataCache.getFirstLinkpathDest(anchor.dataset.href ?? anchor.getAttr("href") ?? "", sourcePath);
			if (!(target instanceof TFile)) return;
			const page = pages && isNestedPage(sourcePath, target.path);
			const attachment = !page && attachments && isAttachmentPath(target.path);
			if (!page && !attachment) return;
			anchor.addClass("ftn-page-link");
			if (isSoleLink(anchor)) anchor.addClass("is-block");
			if (anchor.querySelector(".ftn-page-link-icon")) return;
			const iconEl = anchor.createSpan({ cls: "ftn-page-link-icon", prepend: true });
			renderIcon(iconEl, page ? shownPageIcon(this.plugin, target) : ATTACHMENT_ICON);
			// Reading view shows the link text, which is the characters of the
			// link. The block shows the page's own name, or the file's name.
			anchor.childNodes.forEach((node) => {
				if (node !== iconEl && node.nodeType === Node.TEXT_NODE) node.textContent = "";
			});
			anchor.createSpan({ cls: "ftn-page-link-name", text: page ? target.basename : target.name });
		});
	}

	/**
	 * A PDF embed is a placeholder here, and the viewer is filled in after
	 * post-processors run. Replacing the placeholder means that fill never
	 * happens, and the row is what both Live Preview and Reading view show.
	 */
	private replacePdfEmbeds(el: HTMLElement, sourcePath: string): void {
		const { app } = this.plugin;
		el.querySelectorAll<HTMLElement>(".internal-embed").forEach((embed) => {
			const src = embed.getAttribute("src") ?? "";
			const linktext = src.split("|")[0] ?? src;
			const hash = linktext.indexOf("#");
			const path = hash === -1 ? linktext : linktext.slice(0, hash);
			let decoded = path;
			try {
				decoded = decodeURI(path);
			} catch {
				decoded = path;
			}
			const target = app.metadataCache.getFirstLinkpathDest(decoded, sourcePath);
			if (!(target instanceof TFile) || !embedAsAttachmentRow(target.extension)) return;
			const row = document.createElement("a");
			row.addClass("internal-link", "ftn-page-link");
			if (isSoleLink(embed)) row.addClass("is-block");
			row.dataset.href = linktext;
			row.setAttribute("href", linktext);
			renderIcon(row.createSpan({ cls: "ftn-page-link-icon" }), ATTACHMENT_ICON);
			row.createSpan({ cls: "ftn-page-link-name", text: target.name });
			embed.replaceWith(row);
		});
	}
}
