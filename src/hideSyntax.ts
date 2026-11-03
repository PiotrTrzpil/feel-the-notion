import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
} from "@codemirror/view";
import { Prec, RangeSetBuilder } from "@codemirror/state";
import { editorLivePreviewField } from "obsidian";
import { findMarkerRanges, openingMarkerAt } from "./markerRanges";
import { findFencedLines } from "./codeFence";
import type NotionBlock from "./main";

/**
 * Removes the horizontal jitter when the caret enters a formatted span.
 *
 * THE PROBLEM
 * Live Preview strips `**` from inactive lines and puts it back on the active
 * one. Putting it back costs layout width, so every character after it slides
 * sideways as the caret arrives, and slides back as it leaves. Notion never
 * reflows, because it has no syntax to reveal — that constant twitch is the
 * strongest signal that you are in a text editor rather than a document.
 *
 * THE APPROACH
 * Hide the markers on the active line too. Inactive lines already render zero
 * width; making the active line match means both states are identical and
 * there is nothing left to reflow.
 *
 * WHY atomicRanges MATTERS
 * Replacing a range hides it but leaves the document positions behind it.
 * Without atomicRanges the caret still visits those positions, so arrowing
 * through `**bold**` appears to stall for two presses at each end with no
 * visible movement. Registering the same ranges as atomic makes CodeMirror
 * step over each marker as a single unit, so Left/Right move by visible
 * characters — which is what the user is actually looking at.
 *
 * THE TRADE
 * In Live Preview the markers stay hidden on the active line too, so bold,
 * italics, highlights and headings never turn back into `**` or `###` while
 * you edit them. They cannot be clicked between there — Cmd+B and Cmd+I apply
 * them instead. Source mode still shows the characters, unless the setting
 * hides them there as well.
 */

const hiddenMarker = Decoration.replace({});

function isLivePreview(view: EditorView): boolean {
	return view.state.field(editorLivePreviewField, false) === true;
}

function buildDecorations(view: EditorView, hideInSource: boolean): DecorationSet {
	// Live Preview always hides the markers. Source mode shows them, unless
	// the setting asks for the same treatment there.
	if (!hideInSource && !isLivePreview(view)) return Decoration.none;

	const ranges = new RangeSetBuilder<Decoration>();
	// One document scan per pass rather than one per visible line — findFencedLines
	// is O(docLines) total, so calling isInsideCodeFence per line here instead
	// would make this whole function O(lines × docLines) on every keystroke.
	const fencedLines = findFencedLines(view.state.doc);

	for (const visible of view.visibleRanges) {
		let pos = visible.from;
		while (pos <= visible.to) {
			const line = view.state.doc.lineAt(pos);
			// Inside a fence nothing is markdown — the fenced content itself has no
			// idea it's in a block, which is what let e.g. `_VARIABLE_A_` get its
			// underscores hidden as if they were emphasis markers.
			if (!fencedLines.has(line.number)) {
				for (const range of findMarkerRanges(line.text, line.from)) {
					ranges.add(range.from, range.to, hiddenMarker);
				}
			}
			if (line.to + 1 > visible.to) break;
			pos = line.to + 1;
		}
	}

	return ranges.finish();
}

/**
 * A typed character that lands on a hidden opener is inserted after it.
 *
 * The marker has no width, so the caret just before `**` or `## ` and the
 * caret just after it are the same spot. Typing into the first would put the
 * letter in front of the marker and drop the formatting.
 */
function typePastMarker(view: EditorView, from: number, to: number, text: string, hidden: boolean): boolean {
	if (from !== to || text === "" || !hidden) return false;
	const line = view.state.doc.lineAt(from);
	const marker = openingMarkerAt(line.text, line.from, from);
	if (!marker) return false;
	view.dispatch({
		changes: { from: marker.to, insert: text },
		selection: { anchor: marker.to + text.length },
		userEvent: "input",
	});
	return true;
}

export function hideSyntaxExtension(plugin: NotionBlock) {
	const pluginClass = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(editor: EditorView) {
				this.decorations = buildDecorations(editor, plugin.settings.hideSyntaxMarkers);
			}

			update(update: ViewUpdate) {
				const hideInSource = plugin.settings.hideSyntaxMarkers;
				const live = isLivePreview(update.view);
				if (!hideInSource && !live) {
					this.decorations = Decoration.none;
					return;
				}
				// Selection changes matter as well as edits: Obsidian adds
				// and removes its own marker decorations as the caret moves
				// between lines, so ours have to be rebuilt in step. Toggling
				// Live Preview changes which markers are hidden without an edit.
				const enteredPreview = live !== (update.startState.field(editorLivePreviewField, false) === true);
				if (update.docChanged || update.viewportChanged || update.selectionSet || enteredPreview) {
					this.decorations = buildDecorations(update.view, hideInSource);
				}
			}
		},
		{ decorations: (value) => value.decorations }
	);

	return [
		// Above Live Preview, which puts `**` and `#` back on the line the caret
		// is on. This replacement has to stay on top of that.
		Prec.highest(pluginClass),
		EditorView.inputHandler.of((view, from, to, text) =>
			typePastMarker(view, from, to, text, isLivePreview(view) || plugin.settings.hideSyntaxMarkers)
		),
		// Same ranges again, as atomic. Kept as a separate facet provider
		// rather than derived from the plugin above so that if the decoration
		// plugin is ever rebuilt mid-update, the caret cannot briefly land
		// inside a hidden marker.
		EditorView.atomicRanges.of((view) => buildDecorations(view, plugin.settings.hideSyntaxMarkers)),
	];
}
