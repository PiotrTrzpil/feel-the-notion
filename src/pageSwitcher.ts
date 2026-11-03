import { App, Keymap, Notice, SearchResult, SuggestModal, TFile, prepareFuzzySearch, renderResults, setIcon } from "obsidian";
import type NotionBlock from "./main";
import { folderOfNote, parentPath } from "./folderNotes";
import { renderIcon, shownPageIcon } from "./pageIcons";
import { PageIcon } from "./pageMeta";

/**
 * "Go to page": a quick switcher over pages, the way Notion's search lists
 * them. Each page shows its icon and where it lives, and a folder note is
 * one entry, the page its folder stands for, instead of a note that seems to
 * duplicate its folder. No match offers to create the page.
 *
 * Its own command rather than a change to Obsidian's switcher, which has no
 * API to extend; bind it to Cmd+O under Hotkeys to use it in its place.
 */

type Choice =
	| { kind: "page"; file: TFile; icon: PageIcon; match: SearchResult | null }
	| { kind: "create"; name: string };

const RECENT_LIMIT = 30;

class PageSwitcherModal extends SuggestModal<Choice> {
	constructor(app: App, private readonly plugin: NotionBlock) {
		super(app);
		this.setPlaceholder("Go to page…");
		this.limit = 50;
		this.setInstructions([
			{ command: "↵", purpose: "open" },
			{ command: "⌘ ↵", purpose: "open in new tab" },
			{ command: "esc", purpose: "dismiss" },
		]);
		// Notion's Cmd+Enter: the same choice, in a new tab.
		this.scope.register(["Mod"], "Enter", (evt) => {
			this.selectActiveSuggestion(evt);
			return false;
		});
	}

	getSuggestions(query: string): Choice[] {
		const q = query.trim();
		const files = this.app.vault.getMarkdownFiles();

		if (q === "") {
			const recent = this.app.workspace
				.getLastOpenFiles()
				.map((path) => this.app.vault.getAbstractFileByPath(path))
				.filter((f): f is TFile => f instanceof TFile && f.extension === "md")
				.slice(0, RECENT_LIMIT);
			return recent.map((file) => ({ kind: "page", file, icon: shownPageIcon(this.plugin, file), match: null }));
		}

		const search = prepareFuzzySearch(q);
		const scored: { file: TFile; match: SearchResult }[] = [];
		for (const file of files) {
			const match = search(file.basename);
			if (match) scored.push({ file, match });
		}
		scored.sort((a, b) => b.match.score - a.match.score || a.file.path.length - b.file.path.length);

		const choices: Choice[] = scored.map(({ file, match }) => ({
			kind: "page",
			file,
			icon: shownPageIcon(this.plugin, file),
			match,
		}));
		const exact = scored.some(({ file }) => file.basename.toLowerCase() === q.toLowerCase());
		if (!exact) choices.push({ kind: "create", name: q });
		return choices;
	}

	renderSuggestion(choice: Choice, el: HTMLElement): void {
		el.addClass("ftn-picker-row", "ftn-switcher-row");
		const iconEl = el.createSpan({ cls: "ftn-picker-icon" });
		if (choice.kind === "create") {
			setIcon(iconEl, "file-plus");
			el.createSpan({ text: `New page "${choice.name}"` });
			return;
		}
		renderIcon(iconEl, choice.icon);

		const text = el.createDiv({ cls: "ftn-switcher-text" });
		const title = text.createDiv({ cls: "ftn-switcher-title" });
		if (choice.match) renderResults(title, choice.file.basename, choice.match);
		else title.setText(choice.file.basename);

		// Where the page lives; a folder note lives where its folder does.
		const own = folderOfNote(choice.file.path);
		const location = own === null ? parentPath(choice.file.path) : parentPath(own);
		if (location) text.createDiv({ cls: "ftn-switcher-path", text: location.split("/").join(" / ") });
	}

	onChooseSuggestion(choice: Choice, evt: MouseEvent | KeyboardEvent): void {
		const leaf = this.app.workspace.getLeaf(Keymap.isModEvent(evt) ? "tab" : false);
		if (choice.kind === "page") {
			void leaf.openFile(choice.file);
			return;
		}
		void this.createPage(choice.name).then((file) => file && leaf.openFile(file));
	}

	private async createPage(name: string): Promise<TFile | null> {
		const source = this.app.workspace.getActiveFile()?.path ?? "";
		const folder = this.app.fileManager.getNewFileParent(source);
		const path = folder.isRoot() ? `${name}.md` : `${folder.path}/${name}.md`;
		try {
			return await this.app.vault.create(path, "");
		} catch (error) {
			console.error("feel-the-notion: creating page failed", error);
			new Notice(`Could not create ${path}`);
			return null;
		}
	}
}

export function registerPageSwitcher(plugin: NotionBlock): void {
	plugin.addCommand({
		id: "go-to-page",
		name: "Go to page",
		callback: () => new PageSwitcherModal(plugin.app, plugin).open(),
	});
}
