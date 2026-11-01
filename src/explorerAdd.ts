import { Notice, TFile, TFolder, setIcon } from "obsidian";
import type NotionBlock from "./main";
import { availableNotePath } from "./blockTransform";
import { subPageFolder } from "./folderNoteView";
import { t } from "./locale/helpers";

const ROW = '.workspace-leaf-content[data-type="file-explorer"] :is(.nav-folder-title, .nav-file-title)[data-path]';

/**
 * A "+" on the explorer row under the pointer, Notion's sidebar button for
 * adding a page inside another: on a folder it creates a page in it, on a
 * note a sub-page of it (making the note a folder note first, as /page does).
 *
 * One button, moved into whichever row is hovered. The explorer rebuilds its
 * rows as it likes, so nothing is added to rows ahead of time; a row that
 * loses the button simply gets it back on the next hover.
 */
export class ExplorerAdd {
	private readonly button: HTMLElement;
	private row: HTMLElement | null = null;

	constructor(private readonly plugin: NotionBlock) {
		this.button = createDiv({ cls: "ftn-explorer-add clickable-icon", attr: { "aria-label": "Add a page inside" } });
		setIcon(this.button, "plus");
		// Neither the press nor the click may reach the row, which would open
		// or fold it, or start dragging it.
		this.button.addEventListener("mousedown", (evt) => evt.stopPropagation());
		this.button.addEventListener("click", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			const path = this.row?.dataset.path;
			if (path !== undefined) void this.addPage(path);
		});
		plugin.registerDomEvent(document, "mouseover", (evt) => this.onHover(evt));
		plugin.register(() => this.button.remove());
	}

	private onHover(evt: MouseEvent): void {
		const settings = this.plugin.settings;
		const row = (evt.target as HTMLElement | null)?.closest<HTMLElement>(ROW) ?? null;
		if (!row || !settings.enabled || !settings.folderNotes || row === this.row) return;
		const file = this.plugin.app.vault.getAbstractFileByPath(row.dataset.path ?? "");
		if (!(file instanceof TFolder) && !(file instanceof TFile && file.extension === "md")) return;
		this.row = row;
		row.appendChild(this.button);
	}

	private async addPage(path: string): Promise<void> {
		const { app } = this.plugin;
		const target = app.vault.getAbstractFileByPath(path);
		try {
			const folder = target instanceof TFolder
				? target.path
				: target instanceof TFile
				? await subPageFolder(this.plugin, target)
				: null;
			if (folder === null) {
				new Notice(`Could not add a page inside ${path}`);
				return;
			}
			const page = await app.vault.create(availableNotePath(this.plugin, folder, t("page.untitled")), "");
			await app.workspace.getLeaf(false).openFile(page, { eState: { rename: "all" } });
		} catch (error) {
			console.error("feel-the-notion: adding page failed", error);
			new Notice(t("notice.createPageFailed"));
		}
	}
}
