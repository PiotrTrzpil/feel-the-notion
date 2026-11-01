import { Menu, Notice, TAbstractFile, TFile } from "obsidian";
import type NotionBlock from "./main";
import { PAGE_OPTIONS, PageOption, cssClassList, withCssClass } from "./pageMeta";

/**
 * Notion's per-page "Full width" and "Small text".
 *
 * Stored as `cssclasses`, which Obsidian puts on the note's view in both
 * modes, so the setting travels with the note and the look is plain CSS
 * (styles.css, `.ftn-wide` and `.ftn-small`).
 */

const LABELS: Record<PageOption, string> = { wide: "Full width", small: "Small text" };
const ICONS: Record<PageOption, string> = { wide: "move-horizontal", small: "a-large-small" };

export function registerPageOptions(plugin: NotionBlock): void {
	plugin.registerEvent(plugin.app.workspace.on("file-menu", (menu, file) => addItems(plugin, menu, file)));

	for (const option of Object.keys(PAGE_OPTIONS) as PageOption[]) {
		plugin.addCommand({
			id: `toggle-page-${option}`,
			name: `Toggle ${LABELS[option].toLowerCase()} for this page`,
			checkCallback: (dryRun: boolean) => {
				const file = plugin.app.workspace.getActiveFile();
				if (!file || file.extension !== "md" || !plugin.settings.enabled) return false;
				if (!dryRun) void toggle(plugin, file, option);
				return true;
			},
		});
	}
}

function hasOption(plugin: NotionBlock, file: TFile, option: PageOption): boolean {
	const classes = cssClassList(plugin.app.metadataCache.getFileCache(file)?.frontmatter?.cssclasses);
	return classes.includes(PAGE_OPTIONS[option]);
}

function addItems(plugin: NotionBlock, menu: Menu, file: TAbstractFile): void {
	if (!plugin.settings.enabled || !(file instanceof TFile) || file.extension !== "md") return;
	for (const option of Object.keys(PAGE_OPTIONS) as PageOption[]) {
		menu.addItem((item) => item
			.setTitle(LABELS[option])
			.setIcon(ICONS[option])
			.setChecked(hasOption(plugin, file, option))
			.setSection("view")
			.onClick(() => void toggle(plugin, file, option)));
	}
}

async function toggle(plugin: NotionBlock, file: TFile, option: PageOption): Promise<void> {
	const on = !hasOption(plugin, file, option);
	try {
		await plugin.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
			const classes = withCssClass(frontmatter.cssclasses, PAGE_OPTIONS[option], on);
			if (classes.length > 0) frontmatter.cssclasses = classes;
			else delete frontmatter.cssclasses;
		});
	} catch (error) {
		console.error("feel-the-notion: toggling page option failed", error);
		new Notice(`Could not update the properties of ${file.basename}`);
	}
}
