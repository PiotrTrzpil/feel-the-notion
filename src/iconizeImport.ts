import { Notice, TFile, TFolder, normalizePath } from "obsidian";
import type NotionBlock from "./main";
import { ICON_KEY } from "./pageMeta";
import { folderNote, noteIcon } from "./pageIcons";

const ICONIZE_ID = "obsidian-icon-folder";

/**
 * Copies the icons Iconize kept in its own data.json into where this plugin
 * reads them: a note's `icon` property, a folder's note, or for a folder
 * without one, this plugin's settings. An icon already set is kept, so the
 * import can be re-run safely.
 *
 * Iconize's own values are written unchanged; parseIcon reads both its emoji
 * and its `LiName` Lucide spelling.
 */
export async function importIconizeIcons(plugin: NotionBlock): Promise<void> {
	const { app } = plugin;
	const dataPath = normalizePath(`${app.vault.configDir}/plugins/${ICONIZE_ID}/data.json`);

	let entries: [string, string][];
	try {
		if (!(await app.vault.adapter.exists(dataPath))) {
			new Notice("No Iconize settings found in this vault");
			return;
		}
		entries = iconizeEntries(JSON.parse(await app.vault.adapter.read(dataPath)));
	} catch (error) {
		console.error("feel-the-notion: reading Iconize settings failed", error);
		new Notice("Could not read Iconize's settings");
		return;
	}

	let imported = 0;
	let skipped = 0;
	for (const [path, icon] of entries) {
		const target = app.vault.getAbstractFileByPath(path);
		const note = target instanceof TFolder ? folderNote(app, target) : target;

		if (note instanceof TFile && note.extension === "md") {
			if (noteIcon(app, note)) {
				skipped++;
				continue;
			}
			await app.fileManager.processFrontMatter(note, (frontmatter: Record<string, unknown>) => {
				frontmatter[ICON_KEY] = icon;
			});
			imported++;
		} else if (target instanceof TFolder && !(path in plugin.settings.folderIcons)) {
			plugin.settings.folderIcons[path] = icon;
			imported++;
		} else {
			skipped++;
		}
	}
	await plugin.saveSettings();
	new Notice(`Imported ${imported} icons from Iconize; ${skipped} skipped (already set, or no longer in the vault)`);
}

/** Path → icon pairs from Iconize's data.json: a string, or `{ iconName }`. */
function iconizeEntries(data: unknown): [string, string][] {
	if (typeof data !== "object" || data === null) return [];
	const pairs: [string, string][] = [];
	for (const [path, value] of Object.entries(data)) {
		if (path === "settings") continue;
		const icon = typeof value === "string"
			? value
			: (value as { iconName?: unknown } | null)?.iconName;
		if (typeof icon === "string" && icon !== "") pairs.push([path, icon]);
	}
	return pairs;
}
