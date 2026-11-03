import { Prec, RangeSetBuilder, StateEffect } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { Keymap, MarkdownView, TFile, debounce, editorInfoField } from "obsidian";
import type NotionBlock from "./main";
import { findFencedLines } from "./codeFence";
import { isAttachmentPath } from "./attachmentLink";
import { findLinks } from "./fileDrop";
import { PageIcon, formatIcon } from "./pageMeta";
import { renderIcon, shownPageIcon } from "./pageIcons";
import { isNestedPage, isWholeLineLink } from "./pageLink";

/** What an attachment shows, distinct from a page's document icon. */
const ATTACHMENT_ICON: PageIcon = { kind: "lucide", id: "paperclip" };

/**
 * Draws a link to a sub-page, or to a page nested under one, as a single
 * block: the page's icon and its title. A link to an attachment is the same
 * kind of block, with a paperclip and the file name. Embeds are left alone.
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

function isInCode(view: EditorView, pos: number): boolean {
	const name = syntaxTree(view.state).resolveInner(pos, 1).name;
	return /code|math/i.test(name);
}

function buildDecorations(plugin: NotionBlock, view: EditorView): DecorationSet {
	const ranges = new RangeSetBuilder<Decoration>();
	const pages = pageLinksOn(plugin);
	const attachments = attachmentsOn(plugin);
	if (!pages && !attachments) return ranges.finish();
	const sourcePath = view.state.field(editorInfoField, false)?.file?.path ?? "";
	if (sourcePath === "") return ranges.finish();
	const { app } = plugin;
	const fenced = findFencedLines(view.state.doc);

	for (const visible of view.visibleRanges) {
		let pos = visible.from;
		while (pos <= visible.to) {
			const line = view.state.doc.lineAt(pos);
			if (!fenced.has(line.number)) {
				for (const link of findLinks(line.text)) {
					// An embed is the file itself — an image stays an image.
					if (link.embed) continue;
					const from = line.from + link.from;
					if (isInCode(view, from)) continue;
					const target = app.metadataCache.getFirstLinkpathDest(link.path, sourcePath);
					if (!(target instanceof TFile)) continue;
					const page = pages && isNestedPage(sourcePath, target.path);
					const attachment = !page && attachments && isAttachmentPath(target.path);
					if (!page && !attachment) continue;
					const icon = page ? shownPageIcon(plugin, target) : ATTACHMENT_ICON;
					ranges.add(from, line.from + link.to, Decoration.replace({
						widget: new PageLinkWidget(
							page ? target.basename : target.name,
							formatIcon(icon),
							icon,
							link.path + link.subpath,
							sourcePath,
							isWholeLineLink(line.text, link.from, link.to),
							plugin,
						),
						inclusive: false,
					}));
				}
			}
			if (line.to + 1 > visible.to) break;
			pos = line.to + 1;
		}
	}
	return ranges.finish();
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
		// line the caret is on. This replacement has to stay on top of that,
		// or the title's letters reappear the moment the block is active.
		Prec.highest(pluginClass),
		EditorView.atomicRanges.of((view) => buildDecorations(plugin, view)),
	];
}

/** A rendered link whose parent holds nothing else is a block, not a chip. */
function isSoleLink(anchor: HTMLAnchorElement): boolean {
	const parent = anchor.parentElement;
	if (!parent || !parent.matches("p, li")) return false;
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
	}

	/** Re-draws after a setting changed. */
	update(): void {
		this.redraw();
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
}
