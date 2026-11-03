import { EditorView } from "@codemirror/view";
import { App, Keymap, MarkdownView, Menu, Notice, PaneType, TAbstractFile, TFile, TFolder, debounce, setIcon } from "obsidian";
import type NotionBlock from "./main";
import { toMarkdownLink } from "./attachmentLink";
import { appendBlock } from "./fileDrop";
import { folderNotePath, folderOfNote, isAttachmentsFolder, isWithin, parentPath, planFollowRename, planSubPageFolder, remapPath } from "./folderNotes";
import { unlinkedChildren } from "./explorerOrder";
import { linkedChildPaths } from "./explorerSort";
import { dispatchBlockEdit } from "./history";
import { planNoteDrop } from "./noteDrop";
import { folderIsImages, justifiedLayout, MOSAIC_SPACING, MOSAIC_TARGET_HEIGHT } from "./mosaicLayout";
import { IMAGE_EXTENSIONS, PageIcon, formatIcon } from "./pageMeta";
import { folderIcon, folderNote, noteIcon, renderIcon, setFolderIcon, setNoteIcon, shownFolderIcon, shownPageIcon } from "./pageIcons";
import { IconPickerModal } from "./pagePickers";

const FOLDER_TITLE = '.workspace-leaf-content[data-type="file-explorer"] .nav-folder-title[data-path]';
const FOOTER_CLASS = "ftn-folder-footer";
const ATTACHMENT_ICON: PageIcon = { kind: "lucide", id: "paperclip" };

/** Width/height of an image, keyed by path and mtime so a replaced file is measured again. */
const aspectCache = new Map<string, number>();

interface LiveMosaic {
	disconnect: () => void;
}

const mosaicHosts = new WeakMap<HTMLElement, LiveMosaic>();

interface PlacedFooter {
	disconnect: () => void;
}

const placedFooters = new WeakMap<HTMLElement, PlacedFooter>();

/** Blank lines between the last line of the note and the unlinked footer. */
const FOOTER_GAP_LINES = 2;

function releaseFooter(footer: HTMLElement): void {
	mosaicHosts.get(footer)?.disconnect();
	placedFooters.get(footer)?.disconnect();
	placedFooters.delete(footer);
}

function dropFooter(footer: HTMLElement | null): void {
	if (!footer) return;
	releaseFooter(footer);
	footer.remove();
}

/**
 * Folder notes in the file explorer: a click on a folder name opens its note,
 * creating an empty one when the folder is not a page yet, and does not expand
 * the folder. The chevron does the expanding. Renames keep the pair named
 * alike, and the explorer's context menu gets "Create folder note" and the
 * icon items.
 */
export class FolderNotes {
	/** Folder path whose title was just clicked while collapsed. Reveal must not open it. */
	private collapseHold: string | null = null;

	constructor(private readonly plugin: NotionBlock) {
		const { app } = plugin;
		// Capture phase on the document, so the explorer's own click handler,
		// which would toggle the folder open or shut, never sees the click.
		plugin.registerDomEvent(document, "click", (evt) => this.onClick(evt), { capture: true });
		plugin.registerDomEvent(document, "keydown", (evt) => this.onKeydown(evt), { capture: true });
		plugin.registerEvent(app.vault.on("rename", (file, oldPath) => this.onRename(file, oldPath)));
		plugin.registerEvent(app.vault.on("delete", (file) => this.onDelete(file)));
		plugin.registerEvent(app.workspace.on("file-menu", (menu, file) => this.onFileMenu(menu, file)));
	}

	private get active(): boolean {
		return this.plugin.settings.enabled && this.plugin.settings.folderNotes;
	}

	/** Block F2 rename in the file explorer when an `_attachments` folder is focused/active. */
	private onKeydown(evt: KeyboardEvent): void {
		if (!this.plugin.settings.enabled || evt.key !== "F2") return;
		const target = evt.target as HTMLElement | null;
		const row = target?.closest<HTMLElement>(FOLDER_TITLE)
			?? document.querySelector<HTMLElement>(`${FOLDER_TITLE}.has-focus`);
		if (row && isAttachmentsFolder(row.dataset.path ?? "")) {
			evt.preventDefault();
			evt.stopPropagation();
		}
	}

	private onClick(evt: MouseEvent): void {
		if (!this.active || evt.button !== 0 || evt.shiftKey || evt.altKey) return;
		const target = evt.target as HTMLElement | null;
		const title = target?.closest<HTMLElement>(FOLDER_TITLE);
		if (!title || !target) return;
		// The chevron still folds. A click on it also drops a hold left by a
		// title click, so that fold is not closed again a moment later.
		if (target.closest(".collapse-icon")) {
			if (title.dataset.path === this.collapseHold) this.collapseHold = null;
			return;
		}
		// A title being renamed is text to edit, and the "+" button is its own action.
		if (target.closest("[contenteditable='true'], .ftn-explorer-add")) return;

		const path = title.dataset.path ?? "";
		// `_attachments` is a bin, and the vault root has no note. Both keep
		// the explorer's own click, which expands the folder.
		if (isAttachmentsFolder(path)) return;
		const notePath = folderNote(this.plugin.app, path)?.path ?? folderNotePath(path);
		if (!notePath) return;

		const wasCollapsed = title.closest(".nav-folder")?.classList.contains("is-collapsed") === true;
		evt.preventDefault();
		evt.stopPropagation();
		void this.openFolderNote(notePath, Keymap.isModEvent(evt), wasCollapsed ? path : null);
	}

	private onRename(file: TAbstractFile, oldPath: string): void {
		const { vault, fileManager } = this.plugin.app;
		// `_attachments` cannot be renamed in place (moving its parent folder still moves it).
		if (
			this.plugin.settings.enabled
			&& file instanceof TFolder
			&& isAttachmentsFolder(oldPath)
			&& parentPath(oldPath) === parentPath(file.path)
			&& file.path !== oldPath
		) {
			if (!vault.getAbstractFileByPath(oldPath)) {
				window.setTimeout(() => void fileManager.renameFile(file, oldPath), 0);
			}
			new Notice("_attachments cannot be renamed");
			return;
		}

		this.remapFolderIcons(oldPath, file.path);
		if (!this.active) return;

		const plan = planFollowRename(oldPath, file.path, file instanceof TFolder);
		if (!plan) return;
		const subject = vault.getAbstractFileByPath(plan.from);
		const isRightKind = plan.kind === "folder" ? subject instanceof TFolder : subject instanceof TFile;
		if (!subject || !isRightKind) return;
		if (vault.getAbstractFileByPath(plan.to)) {
			new Notice(`Could not rename ${plan.from} to match: ${plan.to} already exists`);
			return;
		}
		// After the vault has finished reporting this rename: a folder's
		// rename is followed by one event per file inside it.
		window.setTimeout(() => void fileManager.renameFile(subject, plan.to), 0);
	}

	/** Folder icons kept in settings follow their folder. */
	private remapFolderIcons(oldPath: string, newPath: string): void {
		const icons = this.plugin.settings.folderIcons;
		let changed = false;
		for (const [path, icon] of Object.entries(icons)) {
			const moved = remapPath(path, oldPath, newPath);
			if (moved === null) continue;
			delete icons[path];
			icons[moved] = icon;
			changed = true;
		}
		if (changed) void this.plugin.saveSettings();
	}

	private onDelete(deleted: TAbstractFile): void {
		if (!(deleted instanceof TFolder)) return;
		const icons = this.plugin.settings.folderIcons;
		const gone = Object.keys(icons).filter((path) => isWithin(path, deleted.path));
		gone.forEach((path) => delete icons[path]);
		if (gone.length > 0) void this.plugin.saveSettings();
	}

	private onFileMenu(menu: Menu, file: TAbstractFile): void {
		const { settings, app } = this.plugin;
		if (!settings.enabled) return;

		if (file instanceof TFolder && isAttachmentsFolder(file.path)) {
			disableRenameMenuItem(menu);
			return;
		}

		if (file instanceof TFolder && settings.folderNotes && !folderNote(app, file)) {
			const path = folderNotePath(file.path);
			if (path) {
				menu.addItem((item) => item
					.setTitle("Create folder note")
					.setIcon("file-plus")
					.setSection("action")
					.onClick(() => void this.createFolderNote(path)));
			}
		}

		if (!settings.pageHeader) return;
		if (file instanceof TFolder && !file.isRoot()) {
			const hasIcon = folderIcon(this.plugin, file.path) !== null;
			this.addIconItems(menu, hasIcon, (icon) => void setFolderIcon(this.plugin, file, icon));
		} else if (file instanceof TFile && file.extension === "md") {
			const hasIcon = noteIcon(app, file) !== null;
			this.addIconItems(menu, hasIcon, (icon) => void setNoteIcon(app, file, icon));
		}
	}

	private addIconItems(menu: Menu, hasIcon: boolean, set: (icon: Parameters<typeof setNoteIcon>[2]) => void): void {
		menu.addItem((item) => item
			.setTitle(hasIcon ? "Change icon" : "Add icon")
			.setIcon("smile-plus")
			.setSection("action")
			.onClick(() => new IconPickerModal(this.plugin.app, hasIcon, set).open()));
		if (hasIcon) {
			menu.addItem((item) => item
				.setTitle("Remove icon")
				.setIcon("smile")
				.setSection("action")
				.onClick(() => set(null)));
		}
	}

	private async createFolderNote(path: string): Promise<void> {
		await this.openFolderNote(path, false, null);
	}

	/**
	 * Open the folder's note, creating an empty one when it does not exist yet.
	 *
	 * A second click before the first create finishes finds the note the first
	 * one just wrote, instead of reporting a failure.
	 */
	private async openFolderNote(path: string, newLeaf: PaneType | boolean, holdCollapsed: string | null): Promise<void> {
		const { app } = this.plugin;
		// Opening the note reveals it, and the note lives inside the folder, so
		// the explorer would expand the folder that was just clicked. Hold that
		// off while the open and the explorer's own refresh settle.
		const resumeReveal = holdCollapsed === null ? null : pauseExplorerReveal(app);
		if (holdCollapsed !== null) this.collapseHold = holdCollapsed;
		try {
			const note = await this.folderNoteFile(path);
			await app.workspace.getLeaf(newLeaf).openFile(note);
			if (holdCollapsed !== null) this.keepCollapsed(holdCollapsed);
		} catch (error) {
			if (holdCollapsed !== null && this.collapseHold === holdCollapsed) this.collapseHold = null;
			console.error("feel-the-notion: creating folder note failed", error);
			new Notice(`Could not create ${path}`);
		} finally {
			resumeReveal?.();
		}
	}

	/** Fold `path` again if a title click asked for it and the chevron has not taken over. */
	private keepCollapsed(path: string): void {
		const fold = (): void => {
			if (this.collapseHold !== path) return;
			collapseExplorerFolder(this.plugin.app, path);
		};
		fold();
		window.setTimeout(fold, 30);
		window.setTimeout(fold, 80);
		window.setTimeout(fold, 200);
		window.setTimeout(() => {
			if (this.collapseHold === path) this.collapseHold = null;
		}, 400);
	}

	private async folderNoteFile(path: string): Promise<TFile> {
		const { vault } = this.plugin.app;
		const found = vault.getAbstractFileByPath(path);
		if (found instanceof TFile) return found;
		try {
			return await vault.create(path, "");
		} catch (error) {
			const again = vault.getAbstractFileByPath(path);
			if (again instanceof TFile) return again;
			throw error;
		}
	}
}

/** File explorer view fields this plugin reaches into. They are not public API. */
interface FileExplorerView {
	autoRevealFile?: boolean;
	fileItems?: Record<string, ExplorerItem | undefined>;
}

interface ExplorerItem {
	collapsed?: boolean;
	setCollapsed?: (collapsed: boolean, animated?: boolean) => void;
}

function fileExplorers(app: App): FileExplorerView[] {
	return app.workspace.getLeavesOfType("file-explorer").map((leaf) => leaf.view as unknown as FileExplorerView);
}

/**
 * Stop the explorer from expanding folders to show the note that is about to
 * open. The previous setting comes back after the explorer's own sort has run.
 */
function pauseExplorerReveal(app: App): () => void {
	const views = fileExplorers(app);
	const previous = views.map((view) => view.autoRevealFile);
	for (const view of views) view.autoRevealFile = false;
	return () => {
		window.setTimeout(() => {
			views.forEach((view, i) => {
				view.autoRevealFile = previous[i];
			});
		}, 400);
	};
}

/** Fold one folder back up. No-op when it is already folded or has no such row. */
function collapseExplorerFolder(app: App, path: string): void {
	for (const view of fileExplorers(app)) {
		const item = view.fileItems?.[path];
		if (item?.collapsed === false && item.setCollapsed) item.setCollapsed(true, false);
	}
}

/**
 * The folder a new sub-page of `note` goes in. A note that is not a folder
 * note yet becomes one first, moved into a folder of its own name, which is
 * what a page with sub-pages is.
 *
 * Null when that move is blocked by a note already at the destination; the
 * caller then creates the page beside the note instead.
 */
export async function subPageFolder(plugin: NotionBlock, note: TFile): Promise<string | null> {
	const { vault, fileManager } = plugin.app;
	const plan = planSubPageFolder(note.path);
	if (!plan.move) return plan.folder;
	if (vault.getAbstractFileByPath(plan.move.to)) return null;

	const existing = vault.getAbstractFileByPath(plan.folder);
	if (existing && !(existing instanceof TFolder)) return null;
	if (!existing) await vault.createFolder(plan.folder);
	// renameFile, not vault.rename: it rewrites links to the note elsewhere.
	await fileManager.renameFile(note, plan.move.to);
	return plan.folder;
}

interface UnlinkedEntry {
	path: string;
	name: string;
	page: boolean;
	kind: "page" | "folder" | "attachment";
	icon: PageIcon;
	/** Target file to open or link, or null for a subfolder that has no folder note yet. */
	file: TFile | null;
}

/**
 * Virtual footer just after a folder note's content, listing children of its
 * folder that are not linked or embedded in the note yet, with a button to
 * insert a link into the note body.
 */
export class FolderNoteFooter {
	private readonly refresh = debounce(() => this.renderAll(), 80, true);
	private placeFrame = 0;
	private readonly placeObserver = new ResizeObserver(() => this.queuePlace());
	private readonly watchedScrollers = new WeakSet<HTMLElement>();

	constructor(private readonly plugin: NotionBlock) {
		const { app } = plugin;
		plugin.registerEvent(app.workspace.on("layout-change", () => this.refresh()));
		plugin.registerEvent(app.workspace.on("file-open", () => this.refresh()));
		plugin.registerEvent(app.workspace.on("active-leaf-change", () => this.refresh()));
		plugin.registerEvent(app.workspace.on("editor-change", () => this.queuePlace()));
		plugin.registerEvent(app.metadataCache.on("changed", () => this.refresh()));
		plugin.registerEvent(app.metadataCache.on("resolved", () => this.refresh()));
		plugin.registerEvent(app.vault.on("create", () => this.refresh()));
		plugin.registerEvent(app.vault.on("delete", () => this.refresh()));
		plugin.registerEvent(app.vault.on("rename", () => this.refresh()));
		app.workspace.onLayoutReady(() => this.renderAll());
		plugin.register(() => {
			if (this.placeFrame !== 0) window.cancelAnimationFrame(this.placeFrame);
			this.placeObserver.disconnect();
			document.querySelectorAll<HTMLElement>(`.${FOOTER_CLASS}`).forEach((el) => dropFooter(el));
		});
	}

	update(): void {
		this.refresh();
	}

	private renderAll(): void {
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) this.render(leaf.view);
		});
	}

	private render(view: MarkdownView): void {
		const file = view.file;
		const { settings, app } = this.plugin;
		const sizers = view.containerEl.querySelectorAll<HTMLElement>(".cm-sizer, .markdown-preview-sizer");
		const folderPath = file && settings.enabled && settings.folderNotes ? folderOfNote(file.path) : null;
		const folder = folderPath ? app.vault.getAbstractFileByPath(folderPath) : null;
		if (!file || !(folder instanceof TFolder)) {
			sizers.forEach((sizer) => dropFooter(footerIn(sizer)));
			return;
		}

		const entries = this.entries(folder, file);
		if (entries.length === 0) {
			sizers.forEach((sizer) => dropFooter(footerIn(sizer)));
			return;
		}

		const mosaic = settings.imageMosaic && folderIsImages(
			entries.map((entry) => ({ kind: entry.kind, extension: entry.file?.extension ?? "" })),
			IMAGE_EXTENSIONS,
		);
		const key = JSON.stringify([
			file.path,
			mosaic ? "mosaic" : "list",
			entries.map((e) => [e.path, e.name, e.kind, formatIcon(e.icon), e.file?.path ?? null]),
		]);

		sizers.forEach((sizer) => {
			const current = footerIn(sizer);
			if (current?.dataset.key === key) {
				this.watch(sizer, current);
				return;
			}
			const footer = mosaic ? this.buildMosaic(file, entries) : this.build(view, file, entries);
			footer.dataset.key = key;
			if (current) {
				releaseFooter(current);
				current.replaceWith(footer);
			} else {
				sizer.appendChild(footer);
			}
			this.watch(sizer, footer);
		});
		this.queuePlace();
	}

	/**
	 * The sizer stretches to the pane, so the footer's in-flow spot is the
	 * bottom of the window. Pin it a couple of lines under the note instead.
	 * The scroll parent is already positioned; the sizer is not, and must
	 * stay that way (block handles read offsets against the scroller).
	 */
	private queuePlace(): void {
		if (this.placeFrame !== 0) return;
		this.placeFrame = window.requestAnimationFrame(() => {
			this.placeFrame = 0;
			this.placeAll();
		});
	}

	private placeAll(): void {
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			if (!(leaf.view instanceof MarkdownView)) return;
			const view = leaf.view;
			view.containerEl.querySelectorAll<HTMLElement>(`.${FOOTER_CLASS}`).forEach((footer) => {
				const sizer = footer.parentElement;
				if (sizer) this.place(view, sizer, footer);
			});
		});
	}

	private watch(sizer: HTMLElement, footer: HTMLElement): void {
		const origin = scrollOrigin(sizer);
		if (origin && !this.watchedScrollers.has(origin)) {
			this.watchedScrollers.add(origin);
			this.placeObserver.observe(origin);
		}
		if (placedFooters.has(footer)) return;
		const onLoad = (): void => this.queuePlace();
		sizer.addEventListener("load", onLoad, true);
		placedFooters.set(footer, {
			disconnect: () => sizer.removeEventListener("load", onLoad, true),
		});
	}

	private place(view: MarkdownView, sizer: HTMLElement, footer: HTMLElement): void {
		const origin = scrollOrigin(sizer);
		if (!origin || footer.getClientRects().length === 0) return;
		const end = contentEndY(view, sizer, footer);
		if (end === null) return;
		const originRect = origin.getBoundingClientRect();
		const column = contentColumn(sizer) ?? sizer.getBoundingClientRect();
		const gap = footerGap(view, sizer);
		footer.style.top = `${Math.round(end - originRect.top + origin.scrollTop + gap)}px`;
		footer.style.left = `${Math.round(column.left - originRect.left + origin.scrollLeft)}px`;
		footer.style.width = `${Math.round(column.width)}px`;
		footer.style.marginLeft = "0";
		footer.style.marginRight = "0";
		footer.style.visibility = "visible";
	}

	private entries(folder: TFolder, note: TFile): UnlinkedEntry[] {
		const { app } = this.plugin;
		const linked = linkedChildPaths(app, folder.path, note);
		const all: UnlinkedEntry[] = [];
		for (const child of folder.children) {
			if (child.path === note.path) continue;
			if (child instanceof TFolder) {
				const subNote = folderNote(app, child);
				all.push({
					path: child.path,
					name: child.name,
					page: true,
					kind: "folder",
					icon: shownFolderIcon(this.plugin, child.path),
					file: subNote,
				});
			} else if (child instanceof TFile && child.extension === "md") {
				all.push({
					path: child.path,
					name: child.basename,
					page: true,
					kind: "page",
					icon: shownPageIcon(this.plugin, child),
					file: child,
				});
			} else if (child instanceof TFile) {
				all.push({
					path: child.path,
					name: child.name,
					page: false,
					kind: "attachment",
					icon: ATTACHMENT_ICON,
					file: child,
				});
			}
		}
		return unlinkedChildren(all, linked, note.path);
	}

	/**
	 * The same unlinked images, packed into justified rows. Aspects start at
	 * the cached ratio (or square) and the rows reflow once each photo loads.
	 */
	private buildMosaic(note: TFile, entries: UnlinkedEntry[]): HTMLElement {
		const footer = createDiv({ cls: FOOTER_CLASS });
		footer.addEventListener("mousedown", (evt) => evt.stopPropagation());
		footer.createDiv({ cls: "ftn-folder-footer-title", text: "In this folder" });
		const mosaic = footer.createDiv({ cls: "ftn-mosaic" });
		const { app } = this.plugin;

		const items = entries.flatMap((entry) => {
			const file = entry.file;
			return file ? [{ entry, file }] : [];
		});
		const aspects = items.map(({ file }) => aspectCache.get(aspectKey(file)) ?? 1);
		const tiles = items.map(({ entry, file }, index) => {
			const tile = mosaic.createEl("a", { cls: "ftn-mosaic-tile internal-link" });
			tile.dataset.href = file.path;
			tile.setAttr("href", file.path);
			tile.setAttr("aria-label", entry.name);
			const img = tile.createEl("img");
			img.alt = entry.name;
			img.draggable = false;
			img.addEventListener("load", () => {
				if (!alive || img.naturalHeight <= 0) return;
				const ratio = img.naturalWidth / img.naturalHeight;
				aspectCache.set(aspectKey(file), ratio);
				if (aspects[index] === ratio) return;
				aspects[index] = ratio;
				schedule();
			});
			tile.addEventListener("click", (evt) => {
				evt.preventDefault();
				void this.openEntry(entry, Keymap.isModEvent(evt));
			});
			tile.addEventListener("mouseover", (event) => {
				app.workspace.trigger("hover-link", {
					event,
					source: "feel-the-notion",
					hoverParent: tile,
					targetEl: tile,
					linktext: file.path,
					sourcePath: note.path,
				});
			});
			return { tile, img, file };
		});

		let raf = 0;
		let alive = true;
		const layout = (): void => {
			if (!alive) return;
			const width = mosaic.clientWidth;
			if (width <= 0) return;
			const result = justifiedLayout(aspects, width, MOSAIC_TARGET_HEIGHT, MOSAIC_SPACING);
			mosaic.style.height = `${result.totalHeight}px`;
			for (const row of result.rows) {
				for (let index = row.start; index < row.end; index++) {
					const frame = row.frames[index - row.start];
					const tile = tiles[index].tile;
					tile.style.left = `${frame.x}px`;
					tile.style.top = `${frame.y}px`;
					tile.style.width = `${frame.width}px`;
					tile.style.height = `${frame.height}px`;
				}
			}
		};
		const schedule = (): void => {
			if (!alive || raf !== 0) return;
			raf = window.requestAnimationFrame(() => {
				raf = 0;
				layout();
			});
		};
		const observer = new ResizeObserver(() => schedule());
		observer.observe(mosaic);
		mosaicHosts.set(footer, {
			disconnect: () => {
				alive = false;
				observer.disconnect();
				if (raf !== 0) window.cancelAnimationFrame(raf);
			},
		});
		for (const { img, file } of tiles) img.src = app.vault.getResourcePath(file);
		schedule();
		return footer;
	}

	private build(view: MarkdownView, note: TFile, entries: UnlinkedEntry[]): HTMLElement {
		const footer = createDiv({ cls: FOOTER_CLASS });
		// Prevent clicks on the virtual footer from moving the editor caret.
		footer.addEventListener("mousedown", (evt) => evt.stopPropagation());

		footer.createDiv({ cls: "ftn-folder-footer-title", text: "In this folder" });
		const list = footer.createDiv({ cls: "ftn-subpages" });
		for (const entry of entries) this.renderRow(list, view, note, entry);
		return footer;
	}

	private renderRow(parent: HTMLElement, view: MarkdownView, note: TFile, entry: UnlinkedEntry): void {
		const { app } = this.plugin;
		const row = parent.createDiv({ cls: "ftn-subpage ftn-folder-footer-row" });

		const openEl = row.createEl("a", { cls: "ftn-folder-footer-link internal-link" });
		renderIcon(openEl.createSpan({ cls: "ftn-subpage-icon" }), entry.icon);
		openEl.createSpan({ cls: "ftn-subpage-name", text: entry.name });
		if (entry.file) {
			openEl.dataset.href = entry.file.path;
			openEl.setAttr("href", entry.file.path);
		}
		openEl.addEventListener("click", (evt) => {
			evt.preventDefault();
			void this.openEntry(entry, Keymap.isModEvent(evt));
		});
		openEl.addEventListener("mouseover", (event) => {
			if (!entry.file) return;
			app.workspace.trigger("hover-link", {
				event,
				source: "feel-the-notion",
				hoverParent: openEl,
				targetEl: openEl,
				linktext: entry.file.path,
				sourcePath: note.path,
			});
		});

		const linkBtn = row.createEl("button", {
			cls: "ftn-folder-footer-action clickable-icon",
			attr: { "aria-label": "Link in note" },
		});
		setIcon(linkBtn, "plus");
		linkBtn.addEventListener("click", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			void this.linkInNote(view, note, entry);
		});
	}

	private async ensureTargetFile(entry: UnlinkedEntry): Promise<TFile | null> {
		if (entry.file) return entry.file;
		if (entry.kind !== "folder") return null;
		const path = folderNotePath(entry.path);
		if (!path) return null;
		const existing = this.plugin.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) return existing;
		try {
			return await this.plugin.app.vault.create(path, "");
		} catch (error) {
			console.error("feel-the-notion: creating folder note failed", error);
			new Notice(`Could not create ${path}`);
			return null;
		}
	}

	private async openEntry(entry: UnlinkedEntry, newLeaf: PaneType | boolean): Promise<void> {
		const target = await this.ensureTargetFile(entry);
		if (!target) return;
		await this.plugin.app.workspace.getLeaf(newLeaf).openFile(target);
	}

	private async linkInNote(view: MarkdownView, note: TFile, entry: UnlinkedEntry): Promise<void> {
		const target = await this.ensureTargetFile(entry);
		if (!target) return;
		const generated = this.plugin.app.fileManager.generateMarkdownLink(target, note.path);
		const link = entry.kind === "attachment"
			? toMarkdownLink(generated, target.path, this.plugin.settings.embedAttachments)
			: generated.startsWith("!")
			? generated.slice(1)
			: generated;

		const cm = (view.editor as unknown as { cm?: EditorView }).cm;
		if (cm && view.getMode() === "source") {
			const doc = cm.state.doc.toString();
			const plan = planNoteDrop(doc, doc.length, doc.length, [link]);
			dispatchBlockEdit(cm, {
				changes: { from: plan.from, to: plan.to, insert: plan.text },
				selection: { anchor: plan.from + plan.text.length },
				scrollIntoView: true,
				userEvent: "insert.block",
			});
			return;
		}
		await this.plugin.app.vault.process(note, (content) => appendBlock(content, link, 0));
	}
}

function aspectKey(file: TFile): string {
	return `${file.path}:${file.stat.mtime}`;
}

function footerIn(sizer: HTMLElement): HTMLElement | null {
	return sizer.querySelector<HTMLElement>(`:scope > .${FOOTER_CLASS}`);
}

/** Scroller the footer is positioned against. The sizer itself is not positioned. */
function scrollOrigin(sizer: HTMLElement): HTMLElement | null {
	return sizer.closest<HTMLElement>(".cm-scroller, .markdown-preview-view");
}

/**
 * The text column. The sizer is wider: the fold gutter sits to the left of
 * the lines, and reading view keeps the same inset on the preview section.
 */
function contentColumn(sizer: HTMLElement): DOMRect | null {
	const el = sizer.classList.contains("cm-sizer")
		? sizer.querySelector<HTMLElement>(".cm-content > .cm-line") ??
			sizer.querySelector<HTMLElement>(".cm-content")
		: sizer.querySelector<HTMLElement>(".markdown-preview-section");
	if (!el || el.getClientRects().length === 0) return null;
	return el.getBoundingClientRect();
}

function editorCm(view: MarkdownView): EditorView | null {
	return (view.editor as unknown as { cm?: EditorView }).cm ?? null;
}

/**
 * Viewport y of the bottom of the note. The editor's content element is
 * stretched to the pane, so its own box is not the end of the text.
 * `contentHeight` is the whole document, including lines not in the viewport.
 */
function contentEndY(view: MarkdownView, sizer: HTMLElement, footer: HTMLElement): number | null {
	if (sizer.classList.contains("cm-sizer")) {
		const cm = editorCm(view);
		if (!cm || cm.contentHeight <= 0) return null;
		const pad = cm.documentPadding;
		return cm.documentTop + cm.contentHeight - pad.top - pad.bottom;
	}
	const anchor = footer.previousElementSibling;
	return anchor instanceof HTMLElement ? anchor.getBoundingClientRect().bottom : null;
}

function footerGap(view: MarkdownView, sizer: HTMLElement): number {
	if (sizer.classList.contains("cm-sizer")) {
		const line = editorCm(view)?.defaultLineHeight ?? 0;
		if (line > 0) return line * FOOTER_GAP_LINES;
	}
	const cs = getComputedStyle(sizer);
	const parsed = parseFloat(cs.lineHeight);
	const font = parseFloat(cs.fontSize);
	const line = Number.isFinite(parsed) ? parsed : Number.isFinite(font) ? font * 1.5 : 24;
	return line * FOOTER_GAP_LINES;
}

/** Disables the built-in Rename item in a file-explorer context menu. */
function disableRenameMenuItem(menu: Menu): void {
	const disable = () => {
		const items = (menu as unknown as {
			items?: { dom?: HTMLElement; titleEl?: HTMLElement; setDisabled?: (d: boolean) => void }[];
		}).items ?? [];
		for (const item of items) {
			const text = (item.titleEl?.textContent ?? item.dom?.textContent ?? "").trim().toLowerCase();
			if (text.startsWith("rename")) item.setDisabled?.(true);
		}
	};
	disable();
	window.setTimeout(disable, 0);
}
