import { RangeSet, StateEffect, StateField } from "@codemirror/state";
import { GutterMarker, gutterLineClass } from "@codemirror/view";

/**
 * Hides the line number of the line the hover handle sits on.
 *
 * With line numbers on, the gutter is where a left-side handle is drawn, so
 * the two overlap. Notion has no line numbers to collide with; hiding the one
 * number under the handle keeps the handle readable and the rest of the
 * numbers in place.
 *
 * Done through gutterLineClass, a class CodeMirror itself puts on that line's
 * gutter elements, rather than by touching the gutter DOM, which CodeMirror
 * rebuilds and reuses for other lines whenever it likes. styles.css scopes
 * the class to the line-number gutter.
 */

/** The handle's line, by the position of its start; null when no handle shows. */
export const setHandleLine = StateEffect.define<number | null>();

class HandleLineMarker extends GutterMarker {
	elementClass = "ftn-handle-line";
}
const handleLineMarker = new HandleLineMarker();

export const handleLineField = StateField.define<number | null>({
	create: () => null,
	update(pos, tr) {
		for (const effect of tr.effects) if (effect.is(setHandleLine)) return effect.value;
		return pos === null || !tr.docChanged ? pos : tr.changes.mapPos(pos);
	},
	provide: (field) =>
		gutterLineClass.compute([field], (state) => {
			const pos = state.field(field);
			return pos === null ? RangeSet.empty : RangeSet.of(handleLineMarker.range(state.doc.lineAt(pos).from));
		}),
});
