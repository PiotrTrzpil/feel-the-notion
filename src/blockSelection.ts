import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
} from "@codemirror/view";
import {
	EditorSelection,
	RangeSetBuilder,
	SelectionRange,
	StateEffect,
	StateField,
	Text,
} from "@codemirror/state";
import type NotionBlock from "./main";
import { BlockSelectionEnds, blockSelectionSpan } from "./blockKeys";

/**
 * Notion-style multi-block selection.
 *
 * THE DIFFERENCE
 * Dragging across three paragraphs in Obsidian gives a ragged text selection:
 * it starts mid-word in the first block and ends mid-word in the last, and the
 * highlight hugs the glyphs. Notion instead treats the blocks as objects — the
 * moment a selection crosses a block boundary it snaps to whole blocks and
 * paints each one edge to edge.
 *
 * SPLIT IN TWO, DELIBERATELY
 * `selectedLines` + the line decoration are purely visual: they paint whole
 * lines without touching the selection, so nothing about editing changes.
 * That half is on by default.
 *
 * Snapping the actual selection to block boundaries changes what Backspace and
 * typing replace, so it is behaviour rather than appearance and ships behind a
 * setting defaulting to OFF.
 *
 * WHY SNAPPING IS MOUSE-ONLY
 * Shift+Arrow is precision selection — the user is asking for exactly the
 * characters they named, and snapping would fight them. Only a pointer drag
 * across a boundary means "I want these blocks".
 */

/**
 * An Esc block selection (see blockKeymap.ts): whole blocks selected as
 * objects, with no caret, the way Notion's Esc leaves them.
 *
 * Kept as state beside the editor selection rather than read off it, because
 * a single block is a selection inside one line, which the paint below
 * deliberately leaves to CodeMirror; and because the keys that act on blocks
 * have to know the user is in block mode, not merely holding a selection that
 * happens to cover whole lines.
 *
 * The editor selection still spans the blocks, so native copy, drag and
 * anything else reading the selection act on exactly what is painted.
 */
export interface BlockSelection extends BlockSelectionEnds {
	/** Where the caret was on entering, so Esc can hand it back. */
	caret: number;
}

/** Sets or (with null) clears the block selection. */
export const setBlockSelection = StateEffect.define<BlockSelection | null>();

export const blockSelectionField = StateField.define<BlockSelection | null>({
	create: () => null,

	update(value, tr) {
		for (const effect of tr.effects) {
			if (effect.is(setBlockSelection)) return effect.value;
		}
		// Every block command sets the field alongside its own edit. Any other
		// edit or selection change (a click, Home, typing elsewhere, undo)
		// means the user has left block mode, and the recorded lines would no
		// longer describe what is on screen.
		if (tr.docChanged || tr.selection) return null;
		return value;
	},
});

/** Full-width tint on a whole line. Paint only — never touches geometry. */
const blockSelected = Decoration.line({ class: "ftn-block-selected" });

/**
 * Line numbers that should render as fully selected blocks: every line touched
 * by a selection range that crosses a line boundary.
 *
 * Single-line selections return nothing — inside one block the native ragged
 * highlight is correct, and that is what Notion does too.
 *
 * Pure, so it is testable without a DOM. See test/blockSelection.test.mjs.
 */
export function selectedLines(doc: Text, ranges: readonly SelectionRange[]): number[] {
	const lines = new Set<number>();

	for (const range of ranges) {
		if (range.empty) continue;
		const first = doc.lineAt(range.from).number;
		const last = doc.lineAt(range.to).number;
		if (first === last) continue; // within one block — leave it to CodeMirror
		for (let n = first; n <= last; n++) lines.add(n);
	}

	return [...lines].sort((a, b) => a - b);
}

/** Expands a range to cover whole lines. Used only when snapping is enabled. */
export function snapRangeToBlocks(doc: Text, range: SelectionRange): SelectionRange {
	if (range.empty) return range;
	const first = doc.lineAt(range.from);
	const last = doc.lineAt(range.to);
	if (first.number === last.number) return range;

	// Preserve drag direction so Shift+Arrow afterwards extends the way the
	// user expects rather than jumping to the other end.
	return range.anchor <= range.head
		? EditorSelection.range(first.from, last.to)
		: EditorSelection.range(last.to, first.from);
}

function buildDecorations(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const doc = view.state.doc;

	const lines = new Set(selectedLines(doc, view.state.selection.ranges));
	const blocks = view.state.field(blockSelectionField, false);
	if (blocks) {
		const span = blockSelectionSpan(doc, blocks);
		for (let n = span.firstLine; n <= span.lastLine; n++) lines.add(n);
	}

	for (const n of [...lines].sort((a, b) => a - b)) {
		const line = doc.line(n);
		// A line decoration is added as a zero-length range at line start.
		builder.add(line.from, line.from, blockSelected);
	}

	return builder.finish();
}

export function blockSelectionExtension(plugin: NotionBlock) {
	return [
		blockSelectionField,
		ViewPlugin.fromClass(
			class {
				decorations: DecorationSet;

				constructor(view: EditorView) {
					this.decorations = buildDecorations(view);
				}

				update(update: ViewUpdate) {
					const blocksChanged =
						update.startState.field(blockSelectionField, false) !==
						update.state.field(blockSelectionField, false);
					if (update.docChanged || update.viewportChanged || update.selectionSet || blocksChanged) {
						this.decorations = buildDecorations(update.view);
					}

					// Toggle a class on the editor so the stylesheet can suppress
					// CodeMirror's own ragged highlight while blocks are selected.
					// Doing it here rather than from the mouse handler keeps it
					// correct for selections made any other way, including
					// Select All.
					const active = this.decorations.size > 0;
					update.view.dom.classList.toggle("ftn-has-block-selection", active);
				}

			},
			{ decorations: (value) => value.decorations }
		),

		EditorView.domEventHandlers({
			mousedown(event, view) {
				if (event.button !== 0) return false;
				view.dom.dataset.ftnDragging = "1";
				return false;
			},

			mouseup(_event, view) {
				const wasDragging = view.dom.dataset.ftnDragging === "1";
				delete view.dom.dataset.ftnDragging;
				if (!wasDragging || !plugin.settings.snapSelectionToBlocks) return false;

				const doc = view.state.doc;
				const snapped = view.state.selection.ranges.map((r) => snapRangeToBlocks(doc, r));

				// Only dispatch when something actually changed — an unconditional
				// dispatch on every click would add a history entry per click and
				// fight the caret placement we spent Phase 1 fixing.
				const changed = snapped.some(
					(r, i) =>
						r.from !== view.state.selection.ranges[i].from ||
						r.to !== view.state.selection.ranges[i].to
				);
				if (!changed) return false;

				view.dispatch({
					selection: EditorSelection.create(snapped, view.state.selection.mainIndex),
					// Selection-only, so it must not create an undo entry.
					scrollIntoView: false,
				});
				return false;
			},
		}),
	];
}
