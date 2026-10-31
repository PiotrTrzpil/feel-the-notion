import { isSlashTriggerPosition } from "./slashTrigger";

/**
 * When the `@` mention list opens, and what it filters on.
 *
 * Pure, so the trigger rules can be tested without typing into an editor.
 * See test/mentionTrigger.test.mjs.
 */

/** Past this many characters the user is writing prose, not picking a page. */
export const MENTION_QUERY_MAX = 40;

export interface MentionQuery {
	/** Column of the `@` on its line. */
	col: number;
	/** What was typed between the `@` and the caret. */
	query: string;
}

/**
 * The mention being typed at the caret, or null when there is none.
 *
 * `textBeforeCaret` is the caret's line up to the caret. The `@` must open a
 * word: at the start of a block or after whitespace, the same guard the inline
 * slash trigger uses, which is what keeps "a@b.com" and "user@host" quiet.
 *
 * The query may hold single spaces, because note names have them ("@project
 * plan"), but not a leading space or two in a row: "@ 5pm" and a sentence
 * that runs on after a bare "@" are prose, and keeping the list alive through
 * them would fuzzy-match the vault on every keystroke of ordinary writing.
 */
export function findMentionQuery(textBeforeCaret: string): MentionQuery | null {
	const col = textBeforeCaret.lastIndexOf("@");
	if (col < 0) return null;

	const query = textBeforeCaret.slice(col + 1);
	if (!isMentionQuery(query)) return null;

	const before = textBeforeCaret.slice(0, col);
	if (!isSlashTriggerPosition(before, true)) return null;
	if (isInsideInlineCode(before)) return null;

	return { col, query };
}

function isMentionQuery(query: string): boolean {
	if (query.length > MENTION_QUERY_MAX) return false;
	if (/^\s/.test(query)) return false;
	if (/\s\s|\t/.test(query)) return false;
	return true;
}

/**
 * Whether the end of `text` sits inside an inline code span.
 *
 * A span closes only with a backtick run of the length it opened with, so
 * "``a ` b``" is one span. An unclosed run counts as open: CommonMark would
 * render it as a literal backtick, but while typing, an open backtick before
 * the caret almost always means code is being written.
 */
export function isInsideInlineCode(text: string): boolean {
	let open = 0;
	for (const run of text.match(/`+/g) ?? []) {
		if (open === 0) open = run.length;
		else if (run.length === open) open = 0;
	}
	return open !== 0;
}
