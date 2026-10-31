import { App, SuggestModal, TFile, getIconIds, setIcon } from "obsidian";
import { COVER_GRADIENTS, EMOJIS, IMAGE_EXTENSIONS, PageIcon, containsEmoji, isCoverUrl } from "./pageMeta";
import { renderIcon } from "./pageIcons";

/** Most rows a picker lists; past this, typing narrows faster than scrolling. */
const LIMIT = 80;

type IconChoice = { kind: "icon"; icon: PageIcon; label: string } | { kind: "remove" };

/**
 * Picks a page icon: a curated emoji, any emoji typed or pasted (the system
 * picker, Ctrl+Cmd+Space, works in the search field), or a Lucide icon.
 */
export class IconPickerModal extends SuggestModal<IconChoice> {
	constructor(
		app: App,
		private readonly hasIcon: boolean,
		private readonly onPick: (icon: PageIcon | null) => void
	) {
		super(app);
		this.setPlaceholder("Search icons, or type an emoji (Ctrl+Cmd+Space)");
		this.limit = LIMIT;
	}

	getSuggestions(query: string): IconChoice[] {
		const q = query.trim().toLowerCase();
		const choices: IconChoice[] = [];

		if (q === "" && this.hasIcon) choices.push({ kind: "remove" });
		if (containsEmoji(query)) {
			choices.push({ kind: "icon", icon: { kind: "text", text: query.trim() }, label: "Use as typed" });
		}
		for (const { emoji, keywords } of EMOJIS) {
			if (q === "" || keywords.includes(q)) choices.push({ kind: "icon", icon: { kind: "text", text: emoji }, label: keywords });
		}
		if (q !== "") {
			for (const iconId of getIconIds()) {
				const id = iconId.replace(/^lucide-/, "");
				if (id.includes(q)) choices.push({ kind: "icon", icon: { kind: "lucide", id }, label: id });
			}
		}
		return choices;
	}

	renderSuggestion(choice: IconChoice, el: HTMLElement): void {
		el.addClass("ftn-picker-row");
		const iconEl = el.createSpan({ cls: "ftn-picker-icon" });
		if (choice.kind === "remove") {
			setIcon(iconEl, "x");
			el.createSpan({ text: "Remove icon" });
			return;
		}
		renderIcon(iconEl, choice.icon);
		el.createSpan({ cls: "ftn-picker-label", text: choice.label });
	}

	onChooseSuggestion(choice: IconChoice): void {
		this.onPick(choice.kind === "remove" ? null : choice.icon);
	}
}

export type CoverPick =
	| { kind: "file"; file: TFile }
	| { kind: "url"; url: string }
	| { kind: "gradient"; id: string }
	| { kind: "upload" }
	| { kind: "remove" };

/** Picks a cover: an upload, a built-in gradient, an image in the vault, or a pasted https URL. */
export class CoverPickerModal extends SuggestModal<CoverPick> {
	constructor(
		app: App,
		private readonly hasCover: boolean,
		private readonly onPick: (pick: CoverPick) => void
	) {
		super(app);
		this.setPlaceholder("Search images in the vault, or paste an image URL");
		this.limit = LIMIT;
	}

	getSuggestions(query: string): CoverPick[] {
		const q = query.trim().toLowerCase();
		const picks: CoverPick[] = [];
		if (q === "" && this.hasCover) picks.push({ kind: "remove" });
		if (isCoverUrl(query)) picks.push({ kind: "url", url: query.trim() });
		if ("upload image from computer".includes(q)) picks.push({ kind: "upload" });
		for (const id of Object.keys(COVER_GRADIENTS)) {
			if (q === "" || `gradient ${id}`.includes(q)) picks.push({ kind: "gradient", id });
		}
		const images = this.app.vault
			.getFiles()
			.filter((file) => IMAGE_EXTENSIONS.has(file.extension.toLowerCase()) && file.path.toLowerCase().includes(q))
			.sort((a, b) => b.stat.mtime - a.stat.mtime);
		for (const file of images) picks.push({ kind: "file", file });
		return picks;
	}

	renderSuggestion(pick: CoverPick, el: HTMLElement): void {
		el.addClass("ftn-picker-row");
		if (pick.kind === "file") {
			el.createEl("img", { cls: "ftn-picker-thumb", attr: { src: this.app.vault.getResourcePath(pick.file), loading: "lazy" } });
			el.createSpan({ cls: "ftn-picker-label", text: pick.file.path });
			return;
		}
		if (pick.kind === "gradient") {
			el.createDiv({ cls: "ftn-picker-thumb" }).style.background = COVER_GRADIENTS[pick.id];
			el.createSpan({ cls: "ftn-picker-label", text: `Gradient: ${pick.id}` });
			return;
		}
		const [icon, label] = pick.kind === "url"
			? ["link", `Use ${pick.url}`]
			: pick.kind === "upload"
			? ["upload", "Upload image from computer…"]
			: ["x", "Remove cover"];
		setIcon(el.createSpan({ cls: "ftn-picker-icon" }), icon);
		el.createSpan({ cls: "ftn-picker-label", text: label });
	}

	onChooseSuggestion(pick: CoverPick): void {
		this.onPick(pick);
	}
}
