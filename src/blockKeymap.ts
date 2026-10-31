import { ChangeSet, EditorSelection, EditorState, Extension, Prec, Text } from "@codemirror/state";
import { EditorView, KeyBinding, keymap } from "@codemirror/view";
import NotionBlock from "./main";
import { planBackspace, planSelectAll } from "./blockCommands";
import { LineSpan, detectIndentUnit } from "./dragRange";
import {
	BlockShift,
	HiddenEnd,
	blockSelectionSpan,
	blockSpanAt,
	blockText,
	nextBlockLine,
	planDeleteBlocks,
	planDuplicateBlock,
	planIndentBlocks,
	planMoveBlock,
	previousBlockLine,
	spanRange,
	touchedBlocks,
} from "./blockKeys";
import { BlockSelection, blockSelectionField, setBlockSelection } from "./blockSelection";
import { dispatchBlockEdit } from "./history";
import { foldHidingLineEnd } from "./blockFold";

/**
 * Notion's block keys: block-aware Cmd+A and Backspace, Cmd+Shift+Up/Down to
 * move a block past its sibling, Cmd+D to duplicate it, and Esc to select the
 * block as a whole — after which arrows, Backspace, Tab, Enter, copy and cut
 * act on whole blocks.
 *
 * Prec.highest because most of these keys already have owners: CodeMirror's
 * default keymap binds them, and Obsidian binds Cmd+A as an app command.
 * Returning true from a CM6 command calls preventDefault, which Obsidian's
 * scope handling respects — but only if this runs first.
 *
 * Every command returns false wherever the existing behaviour is already
 * correct, so the editor's own handling stays in place by default rather than
 * being replaced wholesale. The setting is read on every key, so toggling it
 * takes effect without a reload.
 */
export const blockKeymapExtension = (plugin: NotionBlock): Extension => [
	Prec.highest(keymap.of(bindings(plugin))),
	EditorView.domEventHandlers({
		// The editor selection already spans the blocks, but CodeMirror copies
		// an empty selection (a selected blank line) as the whole line plus
		// its break. Writing the text explicitly keeps copy and cut identical
		// whatever was selected.
		copy: (event, view) => copyBlocks(plugin, view, event, false),
		cut: (event, view) => copyBlocks(plugin, view, event, true),
	}),
];

function bindings(plugin: NotionBlock): KeyBinding[] {
	/** Wraps a command so it only runs while block keys are switched on. */
	const when = (run: (view: EditorView) => boolean) => (view: EditorView) => isEnabled(plugin) && run(view);
	/** Wraps a command that only applies inside an Esc block selection. */
	const inBlocks = (run: (view: EditorView, blocks: BlockSelection) => boolean) =>
		when((view) => {
			const blocks = view.state.field(blockSelectionField, false);
			return blocks ? run(view, blocks) : false;
		});

	return [
		{ key: "Mod-a", run: when(selectAll) },
		{ key: "Backspace", run: when((view) => deleteSelectedBlocks(view) || backspace(view)) },
		{ key: "Delete", run: inBlocks((view) => deleteSelectedBlocks(view)) },
		{ key: "Mod-Shift-ArrowUp", run: when((view) => moveBlocks(view, "up")) },
		{ key: "Mod-Shift-ArrowDown", run: when((view) => moveBlocks(view, "down")) },
		{ key: "Mod-d", run: when(duplicateBlocks) },
		{ key: "Escape", run: when((view) => leaveBlocks(view) || enterBlocks(plugin, view)) },
		{ key: "ArrowUp", run: inBlocks((view, blocks) => stepBlocks(view, blocks, "up", false)) },
		{ key: "ArrowDown", run: inBlocks((view, blocks) => stepBlocks(view, blocks, "down", false)) },
		{ key: "Shift-ArrowUp", run: inBlocks((view, blocks) => stepBlocks(view, blocks, "up", true)) },
		{ key: "Shift-ArrowDown", run: inBlocks((view, blocks) => stepBlocks(view, blocks, "down", true)) },
		{ key: "Tab", run: inBlocks((view, blocks) => indentBlocks(view, blocks, "in")) },
		{ key: "Shift-Tab", run: inBlocks((view, blocks) => indentBlocks(view, blocks, "out")) },
		{ key: "Enter", run: inBlocks((view, blocks) => editBlock(view, blocks)) },
		// Last, so it only sees keys no binding above handled.
		{ any: (view, event) => isEnabled(plugin) && typedIntoBlocks(view, event) },
	];
}

function isEnabled(plugin: NotionBlock): boolean {
	return plugin.settings.enabled && plugin.settings.blockKeys;
}

// ── Cmd+A and Backspace ────────────────────────────────────────────────────

function selectAll(view: EditorView): boolean {
	const { state } = view;
	if (state.selection.ranges.length !== 1) return false;

	const plan = planSelectAll(state.doc, state.selection.main);
	if (!plan) return false;

	view.dispatch({
		selection: EditorSelection.single(plan.from, plan.to),
		userEvent: "select.block",
	});
	return true;
}

function backspace(view: EditorView): boolean {
	const { state } = view;
	if (state.selection.ranges.length !== 1) return false;
	const range = state.selection.main;
	if (!range.empty) return false;

	const plan = planBackspace(state.doc, range.head, detectIndentUnit(state.doc));
	if (!plan) return false;

	// A plain dispatch, not dispatchBlockEdit: Backspace should keep grouping
	// with the typing around it, so undo walks back through an edit at typing
	// speed rather than one press per character removed.
	view.dispatch({
		changes: plan.changes,
		selection: EditorSelection.cursor(plan.anchor),
		scrollIntoView: true,
		userEvent: "delete.backward",
	});
	return true;
}

// ── Moving and duplicating ─────────────────────────────────────────────────

/**
 * The blocks a move or duplicate acts on, or null when there is no single
 * selection to read them from: the Esc block selection, else every block the
 * caret or text selection touches.
 */
function targetSpan(state: EditorState): LineSpan | null {
	const blocks = state.field(blockSelectionField, false);
	if (blocks) return blockSelectionSpan(state.doc, blocks);
	if (state.selection.ranges.length !== 1) return null;
	return touchedBlocks(state.doc, state.selection.main);
}

function moveBlocks(view: EditorView, direction: "up" | "down"): boolean {
	const span = targetSpan(view.state);
	if (!span) return false;
	const plan = planMoveBlock(view.state.doc, span, direction);
	// No sibling that way. Still handled: falling through to the default
	// (select to the start or end of the note) is not what the key was for.
	if (plan) applyShift(view, span, plan, "move.block");
	return true;
}

function duplicateBlocks(view: EditorView): boolean {
	const span = targetSpan(view.state);
	if (!span) return false;
	applyShift(view, span, planDuplicateBlock(view.state.doc, span), "duplicate.block");
	return true;
}

/**
 * Applies a move or duplicate, with the selection travelling with the text:
 * a caret or text selection by `plan.offset`, a block selection by
 * `plan.lines`. For a duplicate that lands both in the copy, as in Notion.
 */
function applyShift(view: EditorView, span: LineSpan, plan: BlockShift, userEvent: string): void {
	const { state } = view;
	const changes = state.changes(plan.changes);
	const doc = changes.apply(state.doc);
	const blocks = state.field(blockSelectionField, false);

	if (blocks) {
		const range = spanRange(state.doc, span);
		const inside = blocks.caret >= range.from && blocks.caret <= range.to;
		const next: BlockSelection = {
			anchor: blocks.anchor + plan.lines,
			head: blocks.head + plan.lines,
			caret: inside ? blocks.caret + plan.offset : changes.mapPos(blocks.caret),
		};
		dispatchBlockEdit(view, { changes, ...selectBlocksSpec(doc, next), scrollIntoView: true, userEvent });
		return;
	}

	const main = state.selection.main;
	dispatchBlockEdit(view, {
		changes,
		selection: EditorSelection.range(main.anchor + plan.offset, main.head + plan.offset),
		scrollIntoView: true,
		userEvent,
	});
}

// ── Esc block selection ────────────────────────────────────────────────────

/** The transaction fields that show `blocks` as the current block selection. */
function selectBlocksSpec(doc: Text, blocks: BlockSelection) {
	const range = spanRange(doc, blockSelectionSpan(doc, blocks));
	return {
		selection: EditorSelection.single(range.from, range.to),
		effects: setBlockSelection.of(blocks),
	};
}

/**
 * Esc while editing: select the block under the caret as a whole.
 *
 * Esc has other owners, and each of them wins:
 *   - a text selection: the first Esc collapses it (the editor's default);
 *   - vim mode, where Esc is how you leave insert mode;
 *   - an open suggest, context menu, popover or one of this plugin's menus,
 *     which Esc should close. Those that listen in the capture phase have
 *     already consumed the key; Obsidian's own suggest and menus are checked
 *     here because their scopes see the key after the editor does.
 */
function enterBlocks(plugin: NotionBlock, view: EditorView): boolean {
	const { state } = view;
	if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return false;
	if (vimMode(plugin) || escapeOwnedElsewhere(view)) return false;

	const caret = state.selection.main.head;
	const line = blockSpanAt(state.doc, state.doc.lineAt(caret).number).firstLine;
	view.dispatch({
		...selectBlocksSpec(state.doc, { anchor: line, head: line, caret }),
		userEvent: "select.block",
	});
	return true;
}

/** Esc in a block selection: back to a caret, where it was if still inside. */
function leaveBlocks(view: EditorView): boolean {
	const blocks = view.state.field(blockSelectionField, false);
	if (!blocks) return false;

	const { doc } = view.state;
	const range = spanRange(doc, blockSelectionSpan(doc, blocks));
	const caret = blocks.caret >= range.from && blocks.caret <= range.to ? blocks.caret : firstBlockEnd(doc, blocks);
	placeCaret(view, caret);
	return true;
}

/** Enter in a block selection: edit at the end of the first selected block. */
function editBlock(view: EditorView, blocks: BlockSelection): boolean {
	placeCaret(view, firstBlockEnd(view.state.doc, blocks));
	return true;
}

/**
 * A printable key in a block selection leaves block mode and is dropped.
 *
 * The editor selection spans the blocks, so letting the key through would
 * replace every selected block with one letter. Notion ignores typing over a
 * block selection; dropping out of block mode is the harmless version of that
 * which still leaves the user editing.
 */
function typedIntoBlocks(view: EditorView, event: KeyboardEvent): boolean {
	const blocks = view.state.field(blockSelectionField, false);
	if (!blocks) return false;
	if (event.key.length !== 1 || event.metaKey || event.ctrlKey) return false;
	placeCaret(view, firstBlockEnd(view.state.doc, blocks));
	return true;
}

function firstBlockEnd(doc: Text, blocks: BlockSelection): number {
	return doc.line(blockSelectionSpan(doc, blocks).firstLine).to;
}

function placeCaret(view: EditorView, pos: number): void {
	view.dispatch({
		selection: EditorSelection.cursor(pos),
		effects: setBlockSelection.of(null),
		scrollIntoView: true,
		userEvent: "select",
	});
}

/**
 * Up/Down move the block selection to the previous/next visible block;
 * with Shift they move only its head, extending or shrinking it.
 *
 * At the top or bottom of the note the key is still handled, so the
 * selection stays put rather than the editor's own arrow handling turning
 * it back into ragged text.
 */
function stepBlocks(view: EditorView, blocks: BlockSelection, direction: "up" | "down", extend: boolean): boolean {
	const { doc } = view.state;
	const hidden: HiddenEnd = (n) => foldHidingLineEnd(view, n);
	const step = (line: number) =>
		direction === "up" ? previousBlockLine(doc, line, hidden) : nextBlockLine(doc, line, hidden);

	let next: BlockSelection | null = null;
	if (extend) {
		const head = step(blocks.head);
		if (head !== null) next = { ...blocks, head };
	} else {
		// From the selection's outer edge in the direction of travel.
		const from = direction === "up"
			? blockSelectionSpan(doc, blocks).firstLine
			: Math.max(blocks.anchor, blocks.head);
		const line = step(from);
		if (line !== null) next = { ...blocks, anchor: line, head: line };
	}

	if (next) {
		view.dispatch({ ...selectBlocksSpec(doc, next), scrollIntoView: true, userEvent: "select.block" });
	}
	return true;
}

function deleteSelectedBlocks(view: EditorView): boolean {
	const blocks = view.state.field(blockSelectionField, false);
	if (!blocks) return false;
	removeBlocks(view, blocks, "delete.block");
	return true;
}

function removeBlocks(view: EditorView, blocks: BlockSelection, userEvent: string): void {
	const { doc } = view.state;
	const plan = planDeleteBlocks(doc, blockSelectionSpan(doc, blocks));
	dispatchBlockEdit(view, {
		changes: plan.changes,
		selection: EditorSelection.cursor(plan.caret),
		effects: setBlockSelection.of(null),
		scrollIntoView: true,
		userEvent,
	});
}

/** Tab / Shift+Tab: the selected blocks one level in or out, still selected. */
function indentBlocks(view: EditorView, blocks: BlockSelection, direction: "in" | "out"): boolean {
	const { state } = view;
	const span = blockSelectionSpan(state.doc, blocks);
	const plan = planIndentBlocks(state.doc, span, detectIndentUnit(state.doc), direction);
	// Not legal here. Handled anyway: Obsidian's Tab would indent the lines
	// regardless, or replace the selection with a tab character.
	if (!plan) return true;

	const changes: ChangeSet = state.changes(plan);
	const doc = changes.apply(state.doc);
	dispatchBlockEdit(view, {
		changes,
		...selectBlocksSpec(doc, { ...blocks, caret: changes.mapPos(blocks.caret) }),
		userEvent: direction === "in" ? "indent.block" : "outdent.block",
	});
	return true;
}

/** Copy or cut in a block selection: whole lines, children included. */
function copyBlocks(plugin: NotionBlock, view: EditorView, event: ClipboardEvent, cut: boolean): boolean {
	if (!isEnabled(plugin) || !event.clipboardData) return false;
	const blocks = view.state.field(blockSelectionField, false);
	if (!blocks) return false;

	const { doc } = view.state;
	event.clipboardData.setData("text/plain", blockText(doc, blockSelectionSpan(doc, blocks)));
	event.preventDefault();
	if (cut) removeBlocks(view, blocks, "delete.cut");
	return true;
}

// ── Whose Escape is it ─────────────────────────────────────────────────────

/** Obsidian's vim mode, an app setting with no public accessor. */
function vimMode(plugin: NotionBlock): boolean {
	const vault = plugin.app.vault as unknown as { getConfig?: (key: string) => unknown };
	return vault.getConfig?.("vimMode") === true;
}

/**
 * Whether something on screen should get Esc instead: an editor suggest
 * (link, tag, slash), a context menu, this plugin's insert or action menu, or
 * a popover other than the one this editor lives in.
 */
function escapeOwnedElsewhere(view: EditorView): boolean {
	const doc = view.dom.ownerDocument;
	if (doc.querySelector(".suggestion-container, .menu, .wk-nb-action-menu")) return true;
	return Array.from(doc.querySelectorAll(".popover")).some((popover) => !popover.contains(view.dom));
}
