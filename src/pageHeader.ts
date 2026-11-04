import { MarkdownView, Notice, TFile, TFolder, debounce, setIcon } from "obsidian";
import type NotionBlock from "./main";
import { folderOfNote } from "./folderNotes";
import {
	COVER_GRADIENTS,
	COVER_KEY,
	COVER_Y_KEY,
	Cover,
	DEFAULT_PAGE_ICON,
	PageIcon,
	clampPercent,
	formatCoverLink,
	formatGradientCover,
	parseCover,
} from "./pageMeta";
import { renderIcon, setFolderIcon, setNoteIcon, storedPageIcon } from "./pageIcons";
import { CoverPick, CoverPickerModal, IconPickerModal } from "./pagePickers";
import { saveAttachment } from "./blockTransform";
import { hasTemplates, isEmptyPageCached, pickTemplate } from "./templates";

const HEADER_CLASS = "ftn-page-header";

/** What a cover draws: an image URL or a CSS gradient. */
type CoverPaint = { kind: "image"; url: string } | { kind: "gradient"; css: string };

/**
 * Notion's page header: a cover and an icon above the note's title. A page
 * with no icon of its own shows a generic page icon; clicking it sets one.
 * "Add cover" and, on an empty page, "Templates" show while the title is hovered.
 *
 * Drawn before each `.inline-title`, in Live Preview and in Reading view
 * alike, so it scrolls with the note and sits where Notion puts it. Without
 * Obsidian's inline title (Settings → Appearance) there is nothing to anchor
 * to and nothing is drawn.
 *
 * Obsidian rebuilds parts of a view as it likes (switching mode, reloading a
 * file), so drawing is idempotent and re-run on every event that may have
 * changed a view: each header remembers what it shows and is only rebuilt
 * when that differs.
 */
export class PageHeaders {
	private readonly refresh = debounce(() => this.renderAll(), 50, true);

	/**
	 * Refits full-width covers when their pane resizes. The header lives in
	 * the text column, so the cover's reach to the pane's edges is measured
	 * rather than expressible in CSS (`--content-margin` is `auto`).
	 */
	private readonly coverObserver = new ResizeObserver((entries) => {
		for (const { target } of entries) {
			target.querySelectorAll<HTMLElement>(`.${HEADER_CLASS}.has-cover`).forEach((h) => fitCover(h));
		}
	});
	private readonly observed = new Set<Element>();

	constructor(private readonly plugin: NotionBlock) {
		const { app } = plugin;
		plugin.registerEvent(app.workspace.on("layout-change", () => this.refresh()));
		plugin.registerEvent(app.workspace.on("file-open", () => this.refresh()));
		plugin.registerEvent(app.workspace.on("active-leaf-change", () => this.refresh()));
		plugin.registerEvent(app.metadataCache.on("changed", () => this.refresh()));
		plugin.registerEvent(app.vault.on("rename", () => this.refresh()));
		app.workspace.onLayoutReady(() => this.renderAll());
		plugin.register(() => {
			this.coverObserver.disconnect();
			document.querySelectorAll(`.${HEADER_CLASS}`).forEach((el) => el.remove());
		});
	}

	/** Re-draws every open note, e.g. after a setting changed. */
	update(): void {
		this.refresh();
	}

	private renderAll(): void {
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) this.render(leaf.view);
		});
		// Closed panes leave their scrollers behind; observing one keeps it alive.
		for (const el of this.observed) {
			if (el.isConnected) continue;
			this.coverObserver.unobserve(el);
			this.observed.delete(el);
		}
	}

	private render(view: MarkdownView): void {
		const file = view.file;
		const { settings, app } = this.plugin;
		const titles = view.containerEl.querySelectorAll<HTMLElement>(".inline-title");
		if (file === null || !settings.enabled || !settings.pageHeader) {
			titles.forEach((title) => headerBefore(title)?.remove());
			return;
		}

		const stored = storedPageIcon(this.plugin, file);
		const cover = parseCover(app.metadataCache.getFileCache(file)?.frontmatter);
		const paint = cover ? this.coverPaint(cover, file) : null;
		const offerTemplates = isEmptyPageCached(app, file) && hasTemplates(this.plugin);
		const key = JSON.stringify([file.path, stored, paint, cover?.y, offerTemplates]);

		titles.forEach((title) => {
			const current = headerBefore(title);
			if (current?.dataset.key === key) return;
			const header = this.build(file, stored, cover, paint, offerTemplates);
			header.dataset.key = key;
			if (current) current.replaceWith(header);
			else title.before(header);
			if (paint) this.watchSize(header);
		});
	}

	private watchSize(header: HTMLElement): void {
		fitCover(header);
		const scroller = scrollerOf(header);
		if (!scroller || this.observed.has(scroller)) return;
		this.observed.add(scroller);
		this.coverObserver.observe(scroller);
	}

	private coverPaint(cover: Cover, file: TFile): CoverPaint | null {
		const { source } = cover;
		if (source.kind === "gradient") return { kind: "gradient", css: COVER_GRADIENTS[source.id] };
		if (source.kind === "url") return { kind: "image", url: source.url };
		const image = this.plugin.app.metadataCache.getFirstLinkpathDest(source.linktext, file.path);
		return image ? { kind: "image", url: this.plugin.app.vault.getResourcePath(image) } : null;
	}

	private build(
		file: TFile,
		stored: PageIcon | null,
		cover: Cover | null,
		paint: CoverPaint | null,
		offerTemplates: boolean
	): HTMLElement {
		const header = createDiv({ cls: HEADER_CLASS });
		header.addClass("has-icon");
		header.toggleClass("has-cover", paint !== null);
		// Keeps the editor from taking a click on the header as one on the text.
		header.addEventListener("mousedown", (evt) => evt.stopPropagation());

		if (cover && paint) this.buildCover(header, file, cover, paint);

		const iconEl = header.createDiv({
			cls: "ftn-page-icon",
			attr: { "aria-label": stored ? "Change icon" : "Add icon" },
		});
		renderIcon(iconEl, stored ?? DEFAULT_PAGE_ICON);
		iconEl.addEventListener("click", () => this.pickIcon(file, stored !== null));

		const actions = header.createDiv({ cls: "ftn-page-header-actions" });
		if (!paint) this.button(actions, "image-plus", "Add cover", () => this.pickCover(file, cover !== null));
		if (offerTemplates) this.button(actions, "layout-template", "Templates", () => pickTemplate(this.plugin, file));
		return header;
	}

	private buildCover(header: HTMLElement, file: TFile, cover: Cover, paint: CoverPaint): void {
		const coverEl = header.createDiv({ cls: "ftn-cover" });
		const actions = coverEl.createDiv({ cls: "ftn-cover-actions" });
		this.button(actions, "image", "Change cover", () => this.pickCover(file, true));

		if (paint.kind === "gradient") {
			coverEl.style.background = paint.css;
			return;
		}

		const img = coverEl.createEl("img", { cls: "ftn-cover-img", attr: { src: paint.url, alt: "", draggable: "false" } });
		img.style.objectPosition = `50% ${cover.y}%`;
		const reposition = this.button(actions, "move-vertical", "Reposition", () => {
			coverEl.addClass("is-repositioning");
			reposition.setText("Drag image to reposition");
		});

		let drag: { startY: number; startPct: number; pct: number } | null = null;
		img.addEventListener("pointerdown", (evt) => {
			if (!coverEl.hasClass("is-repositioning")) return;
			evt.preventDefault();
			img.setPointerCapture(evt.pointerId);
			drag = { startY: evt.clientY, startPct: cover.y, pct: cover.y };
		});
		img.addEventListener("pointermove", (evt) => {
			if (!drag) return;
			// Dragging the image down shows more of its top, as in Notion.
			drag.pct = clampPercent(drag.startPct - ((evt.clientY - drag.startY) / img.clientHeight) * 100, drag.startPct);
			img.style.objectPosition = `50% ${drag.pct}%`;
		});
		img.addEventListener("pointerup", () => {
			if (!drag) return;
			const { pct, startPct } = drag;
			drag = null;
			// Leave the mode even on a click with no drag, or the label stays stuck.
			coverEl.removeClass("is-repositioning");
			reposition.setText("Reposition");
			if (pct === startPct) return;
			void this.writeFrontmatter(file, (frontmatter) => {
				frontmatter[COVER_Y_KEY] = pct;
			});
		});
	}

	private button(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLElement {
		const button = parent.createEl("button", { cls: "ftn-header-button" });
		setIcon(button.createSpan({ cls: "ftn-header-button-icon" }), icon);
		button.createSpan({ text: label });
		button.addEventListener("click", (evt) => {
			evt.preventDefault();
			onClick();
		});
		return button;
	}

	private pickIcon(file: TFile, hasIcon: boolean): void {
		const folderPath = folderOfNote(file.path);
		const folder = folderPath === null ? null : this.plugin.app.vault.getAbstractFileByPath(folderPath);
		const apply = (icon: PageIcon | null) =>
			folder instanceof TFolder
				? setFolderIcon(this.plugin, folder, icon)
				: setNoteIcon(this.plugin.app, file, icon);
		new IconPickerModal(this.plugin.app, hasIcon, (icon) => void apply(icon)).open();
	}

	private pickCover(file: TFile, hasCover: boolean): void {
		new CoverPickerModal(this.plugin.app, hasCover, (pick) => {
			if (pick.kind === "upload") this.uploadCover(file);
			else void this.setCover(file, pick);
		}).open();
	}

	/** Asks for an image file, saves it as an attachment of the note, and uses it. */
	private uploadCover(file: TFile): void {
		const input = document.body.createEl("input", { attr: { type: "file", accept: "image/*" } });
		input.addClass("wk-nb-hidden-file-input");
		input.addEventListener("change", () => {
			const chosen = input.files?.[0];
			input.remove();
			if (!chosen) return;
			saveAttachment(this.plugin, chosen, file.path).then(
				(saved) => this.setCover(file, { kind: "file", file: saved }),
				(error) => {
					console.error("feel-the-notion: saving cover failed", error);
					new Notice("Could not save the cover image");
				}
			);
		});
		input.addEventListener("cancel", () => input.remove());
		input.click();
	}

	private async setCover(file: TFile, pick: Exclude<CoverPick, { kind: "upload" }>): Promise<void> {
		const { app } = this.plugin;
		await this.writeFrontmatter(file, (frontmatter) => {
			delete frontmatter[COVER_Y_KEY];
			if (pick.kind === "remove") {
				delete frontmatter[COVER_KEY];
				return;
			}
			frontmatter[COVER_KEY] = pick.kind === "url"
				? pick.url
				: pick.kind === "gradient"
				? formatGradientCover(pick.id)
				// A link rather than a path, so Obsidian keeps it pointing at
				// the image when either is renamed or moved.
				: formatCoverLink(app.metadataCache.fileToLinktext(pick.file, file.path, false));
		});
	}

	/** processFrontMatter, with a notice rather than a silent failure on broken YAML. */
	private async writeFrontmatter(file: TFile, edit: (frontmatter: Record<string, unknown>) => void): Promise<void> {
		try {
			await this.plugin.app.fileManager.processFrontMatter(file, edit);
		} catch (error) {
			console.error("feel-the-notion: writing properties failed", error);
			new Notice(`Could not update the properties of ${file.basename}`);
		}
	}
}

function scrollerOf(header: HTMLElement): HTMLElement | null {
	return header.closest<HTMLElement>(".cm-scroller, .markdown-preview-view");
}

/** The header drawn just before a title, when this plugin put it there. */
function headerBefore(title: HTMLElement): HTMLElement | null {
	const existing = title.previousElementSibling;
	return existing instanceof HTMLElement && existing.hasClass(HEADER_CLASS) ? existing : null;
}

/**
 * Stretches a header's cover from the pane's left edge (right of any line
 * number gutter) to its right edge, the way Notion's covers span the page,
 * while the header itself stays in the text column.
 */
function fitCover(header: HTMLElement): void {
	const scroller = scrollerOf(header);
	if (!scroller || !header.isConnected) return;
	const paneLeft = scroller.getBoundingClientRect().left + scroller.clientLeft;
	const gutters = scroller.querySelector(".cm-gutters");
	const left = gutters ? gutters.getBoundingClientRect().right : paneLeft;
	const right = paneLeft + scroller.clientWidth;
	const headerLeft = header.getBoundingClientRect().left;
	header.style.setProperty("--ftn-cover-start", `${headerLeft - left}px`);
	header.style.setProperty("--ftn-cover-width", `${right - left}px`);
}
