import { RangeSetBuilder, StateEffect } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { MarkdownView, TFile, WorkspaceLeaf, debounce, editorInfoField } from "obsidian";
import type NotionBlock from "./main";
import { findLinks } from "./fileDrop";
import { isNestedPage } from "./pageLink";
import { PageIcon, formatIcon } from "./pageMeta";
import { noteIcon, renderIcon, shownPageIcon } from "./pageIcons";

/**
 * Page icons beside links to pages, as Notion shows a page's icon wherever
 * the page is mentioned: before `[[links]]` and `[text](note.md)` links in
 * Live Preview and Reading view, and before the title on each tab. A page
 * with no icon of its own shows the generic page icon.
 *
 * Embeds are left alone (an embedded note shows its own header), as are
 * links inside code.
 */

/** Asks every editor to redraw its link icons: a page's icon changed. */
const iconsChanged = StateEffect.define<null>();

class LinkIconWidget extends WidgetType {
	constructor(private readonly icon: PageIcon) {
		super();
	}

	eq(other: LinkIconWidget): boolean {
		return formatIcon(other.icon) === formatIcon(this.icon);
	}

	toDOM(): HTMLElement {
		const el = createSpan({ cls: "ftn-link-icon" });
		renderIcon(el, this.icon);
		return el;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

function isInCode(view: EditorView, pos: number): boolean {
	const name = syntaxTree(view.state).resolveInner(pos, 1).name;
	return /code|math/i.test(name);
}

function buildDecorations(plugin: NotionBlock, view: EditorView): DecorationSet {
	const ranges = new RangeSetBuilder<Decoration>();
	const { settings, app } = plugin;
	if (!settings.enabled || !settings.pageHeader) return ranges.finish();
	const sourcePath = view.state.field(editorInfoField, false)?.file?.path ?? "";

	for (const visible of view.visibleRanges) {
		const { from } = visible;
		const text = view.state.sliceDoc(from, visible.to);
		for (const link of findLinks(text)) {
			if (link.embed) continue;
			const pos = from + link.from;
			if (isInCode(view, pos)) continue;
			const target = app.metadataCache.getFirstLinkpathDest(link.path, sourcePath);
			if (!target || target.extension !== "md") continue;
			// A sub-page link is drawn as its own block, icon included.
			if (settings.folderNotes && settings.pageLinkBlocks && isNestedPage(sourcePath, target.path)) continue;
			const icon = shownPageIcon(plugin, target);
			ranges.add(pos, pos, Decoration.widget({ widget: new LinkIconWidget(icon), side: -1 }));
		}
	}
	return ranges.finish();
}

export function linkIconsExtension(plugin: NotionBlock) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(editor: EditorView) {
				this.decorations = buildDecorations(plugin, editor);
			}

			update(update: ViewUpdate) {
				const asked = update.transactions.some((tr) => tr.effects.some((e) => e.is(iconsChanged)));
				if (asked || update.docChanged || update.viewportChanged) {
					this.decorations = buildDecorations(plugin, update.view);
				}
			}
		},
		{ decorations: (v) => v.decorations }
	);
}

/** Obsidian's own tab title element; not in its public API, so looked up defensively. */
interface TabHeaderLeaf {
	tabHeaderInnerTitleEl?: HTMLElement;
}

/**
 * Keeps link icons in Reading view and on tabs, and tells the editors when
 * a page's icon changed so their link icons follow.
 */
export class LinkIcons {
	/** Icons as last seen, so a property edit that leaves the icon alone redraws nothing. */
	private readonly seen = new Map<string, string>();
	private readonly redraw = debounce(() => this.redrawAll(), 100, true);

	constructor(private readonly plugin: NotionBlock) {
		const { app } = plugin;
		plugin.registerEditorExtension(linkIconsExtension(plugin));
		plugin.registerMarkdownPostProcessor((el, ctx) => this.decorateRendered(el, ctx.sourcePath));
		plugin.registerEvent(app.metadataCache.on("changed", (file) => this.onChanged(file)));
		plugin.registerEvent(app.vault.on("rename", () => this.redraw()));
		plugin.registerEvent(app.workspace.on("layout-change", () => this.decorateTabs()));
		plugin.registerEvent(app.workspace.on("file-open", () => this.decorateTabs()));
		app.workspace.onLayoutReady(() => this.decorateTabs());
		plugin.register(() => document.querySelectorAll(".ftn-tab-icon").forEach((el) => el.remove()));
	}

	/** Re-draws after a setting changed. */
	update(): void {
		this.redraw();
	}

	private onChanged(file: TFile): void {
		const icon = noteIcon(this.plugin.app, file);
		const value = icon ? formatIcon(icon) : "";
		if ((this.seen.get(file.path) ?? "") === value) return;
		this.seen.set(file.path, value);
		this.redraw();
	}

	private redrawAll(): void {
		this.decorateTabs();
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			if (!(leaf.view instanceof MarkdownView)) return;
			const cm = (leaf.view.editor as unknown as { cm?: EditorView }).cm;
			cm?.dispatch({ effects: iconsChanged.of(null) });
		});
	}

	private decorateRendered(el: HTMLElement, sourcePath: string): void {
		const { settings, app } = this.plugin;
		if (!settings.enabled || !settings.pageHeader) return;
		el.querySelectorAll<HTMLAnchorElement>("a.internal-link").forEach((a) => {
			if (a.querySelector(".ftn-link-icon")) return;
			const target = app.metadataCache.getFirstLinkpathDest(a.dataset.href ?? a.getAttr("href") ?? "", sourcePath);
			if (!target || target.extension !== "md") return;
			// A sub-page link is drawn as its own block, icon included.
			if (settings.folderNotes && settings.pageLinkBlocks && isNestedPage(sourcePath, target.path)) return;
			renderIcon(a.createSpan({ cls: "ftn-link-icon", prepend: true }), shownPageIcon(this.plugin, target));
		});
	}

	private decorateTabs(): void {
		const settings = this.plugin.settings;
		this.plugin.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
			const titleEl = (leaf as unknown as TabHeaderLeaf).tabHeaderInnerTitleEl;
			if (!titleEl?.parentElement) return;
			const existing = titleEl.parentElement.querySelector<HTMLElement>(":scope > .ftn-tab-icon");
			const file = leaf.view instanceof MarkdownView ? leaf.view.file : null;
			const icon = file && settings.enabled && settings.pageHeader ? shownPageIcon(this.plugin, file) : null;
			const key = icon ? formatIcon(icon) : null;
			if ((existing?.dataset.icon ?? null) === key) return;
			existing?.remove();
			if (!icon || !key) return;
			const iconEl = createSpan({ cls: "ftn-tab-icon" });
			iconEl.dataset.icon = key;
			renderIcon(iconEl, icon);
			titleEl.before(iconEl);
		});
	}
}
