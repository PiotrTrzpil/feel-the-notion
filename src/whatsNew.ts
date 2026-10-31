/**
 * The "What's new" card shown once after an update.
 *
 * Plain data plus one decision, so when the card appears is testable without
 * Obsidian. The modal itself lives in whatsNewModal.ts.
 * See test/whatsNew.test.mjs.
 */

export interface ReleaseNotes {
	version: string;
	items: string[];
}

/**
 * What this release changed, in user terms.
 *
 * Bump `version` together with manifest.json. A mismatch shows nothing rather
 * than an older release's notes under a newer version number.
 */
export const RELEASE_NOTES: ReleaseNotes = {
	version: "0.10.0",
	items: [
		"Block keys, as in Notion: Cmd+Shift+Up/Down moves a block with its children, Cmd+D duplicates it, and Esc selects it. Then arrows move between blocks, Backspace deletes and Tab indents.",
		"Type @ to link a page, or insert today's date.",
		"Paste a URL to keep it, turn it into a link titled from the page, or embed it.",
		"Page icons show beside links and on tabs. The folders in a note's header open their folder notes. Hover a folder in the explorer for a \"+\" that adds a page inside it.",
		"Covers span the whole pane, and can be a gradient or an uploaded image. Empty pages offer templates from your Templates folder. Full width and Small text are in each note's menu.",
		"New insert items: Sub-pages, Database (an inline Base) and Toggle list. \"Go to page\" is a switcher with page icons; bind it to Cmd+O under Hotkeys.",
	],
};

/**
 * Whether to open the card on load.
 *
 * Only on an update: `hadSavedData` is false on a fresh install, where
 * nothing is "new". Everyone already on the plugin has a data.json, including
 * users from before this field existed, so a missing `lastSeen` with saved
 * data still counts as an update.
 */
export function shouldShowWhatsNew(
	hadSavedData: boolean,
	lastSeen: string | undefined,
	current: string,
	notesVersion: string
): boolean {
	return hadSavedData && lastSeen !== current && notesVersion === current;
}
