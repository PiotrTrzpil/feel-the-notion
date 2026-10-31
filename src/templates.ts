import { App, FuzzySuggestModal, Notice, TFile, TFolder, moment, normalizePath, parseYaml } from "obsidian";
import type NotionBlock from "./main";
import { fillTemplate, isEmptyPage, splitFrontmatter } from "./pageTemplate";

/**
 * Page templates: the notes in the templates folder (Settings → Feel the
 * Notion → Pages), offered on an empty page as Notion offers its templates.
 */

export function listTemplates(plugin: NotionBlock): TFile[] {
	const folder = plugin.app.vault.getAbstractFileByPath(normalizePath(plugin.settings.templatesFolder));
	if (!(folder instanceof TFolder)) return [];
	const templates: TFile[] = [];
	const walk = (dir: TFolder) => {
		for (const child of dir.children) {
			if (child instanceof TFolder) walk(child);
			else if (child instanceof TFile && child.extension === "md") templates.push(child);
		}
	};
	walk(folder);
	return templates.sort((a, b) => a.path.localeCompare(b.path));
}

export function hasTemplates(plugin: NotionBlock): boolean {
	return plugin.settings.templatesFolder.trim() !== "" && listTemplates(plugin).length > 0;
}

/**
 * Whether the note has nothing but frontmatter, from the metadata cache, so
 * the header can ask without reading the file. A note never indexed yet has
 * no cache entry and is treated as not empty: offering a template that then
 * refuses is worse than offering it a moment later.
 */
export function isEmptyPageCached(app: App, file: TFile): boolean {
	const cache = app.metadataCache.getFileCache(file);
	if (!cache) return false;
	return (cache.sections ?? []).every((section) => section.type === "yaml");
}

class TemplateModal extends FuzzySuggestModal<TFile> {
	constructor(app: App, private readonly templates: TFile[], private readonly onPick: (template: TFile) => void) {
		super(app);
		this.setPlaceholder("Choose a template");
	}

	getItems(): TFile[] {
		return this.templates;
	}

	getItemText(item: TFile): string {
		return item.basename;
	}

	onChooseItem(item: TFile): void {
		this.onPick(item);
	}
}

export function pickTemplate(plugin: NotionBlock, file: TFile): void {
	const templates = listTemplates(plugin);
	if (templates.length === 0) {
		new Notice(`No templates in "${plugin.settings.templatesFolder}"`);
		return;
	}
	new TemplateModal(plugin.app, templates, (template) => void applyTemplate(plugin, file, template)).open();
}

/**
 * Fills an empty page from `template`.
 *
 * The body replaces the (empty) body; the page's own frontmatter is kept and
 * the template's properties are added where the page has none of its own,
 * so an icon set before choosing a template survives it.
 */
export async function applyTemplate(plugin: NotionBlock, file: TFile, template: TFile): Promise<void> {
	const { app, settings } = plugin;
	try {
		const filled = fillTemplate(await app.vault.read(template), {
			title: file.basename,
			dateFormat: settings.dateFormat,
			timeFormat: settings.timeFormat,
			format: (pattern) => moment().format(pattern),
		});
		const { frontmatter, body } = splitFrontmatter(filled);

		let applied = false;
		await app.vault.process(file, (current) => {
			if (!isEmptyPage(current)) return current;
			applied = true;
			const own = splitFrontmatter(current).frontmatter;
			return (own === null ? "" : `---\n${own}\n---\n`) + body.replace(/^\s*\n/, "");
		});
		if (!applied) {
			new Notice("Templates only fill an empty page");
			return;
		}

		const properties: unknown = frontmatter ? parseYaml(frontmatter) : null;
		if (properties && typeof properties === "object") {
			await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				for (const [key, value] of Object.entries(properties)) {
					if (!(key in fm)) fm[key] = value;
				}
			});
		}
	} catch (error) {
		console.error("feel-the-notion: applying template failed", error);
		new Notice(`Could not apply template ${template.basename}`);
	}
}
