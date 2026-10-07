//! Persisted view preferences for the Changes modal: which side(s) of a file to show, how much unchanged
//! context to keep around each change, and whether the diff is split into two columns or merged into one.
//!
//! Stored in localStorage so the modal reopens the way it was left. Every field is validated on read:
//! a hand-edited or outdated value falls back to the default instead of reaching CodeMirror as garbage.

/** Which content the diff shows: both sides compared, or a single side's full file. */
export type DiffContentMode = "both" | "old" | "new";

/** Unchanged lines kept on each side of a change; "all" disables collapsing entirely. */
export type DiffContextMode = "3" | "20" | "all";

/** Two columns side by side, or one merged column with deletions inlined above their replacement. */
export type DiffLayoutMode = "split" | "unified";

/** The three independent view dimensions of the Changes modal. */
export interface DiffPrefs {
  content: DiffContentMode;
  context: DiffContextMode;
  layout: DiffLayoutMode;
}

/** localStorage key holding the serialized DiffPrefs. */
export const DIFF_PREFS_KEY = "vlx-diff-prefs";

export const DEFAULT_DIFF_PREFS: DiffPrefs = { content: "both", context: "3", layout: "split" };

const CONTENT_MODES: readonly string[] = ["both", "old", "new"];
const CONTEXT_MODES: readonly string[] = ["3", "20", "all"];
const LAYOUT_MODES: readonly string[] = ["split", "unified"];

/**
 * Read the stored preferences, discarding any field that is absent or outside its allowed set.
 * Returns the defaults when storage is unavailable or the stored JSON is corrupt.
 */
export function loadDiffPrefs(): DiffPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(DIFF_PREFS_KEY) || "{}") as Partial<DiffPrefs>;
    return {
      content: CONTENT_MODES.includes(raw.content as string)
        ? (raw.content as DiffContentMode)
        : DEFAULT_DIFF_PREFS.content,
      context: CONTEXT_MODES.includes(raw.context as string)
        ? (raw.context as DiffContextMode)
        : DEFAULT_DIFF_PREFS.context,
      layout: LAYOUT_MODES.includes(raw.layout as string)
        ? (raw.layout as DiffLayoutMode)
        : DEFAULT_DIFF_PREFS.layout,
    };
  } catch {
    return { ...DEFAULT_DIFF_PREFS };
  }
}

/** Persist the preferences; a failed write (private mode, quota) leaves the modal working from memory. */
export function saveDiffPrefs(prefs: DiffPrefs): void {
  try {
    localStorage.setItem(DIFF_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage is best-effort here: the current session already holds the values in React state.
  }
}

/**
 * Translate a context choice into CodeMirror's `collapseUnchanged` option, or undefined to leave the
 * diff fully expanded. `minSize` stays at the editor default so a run of unchanged lines shorter than
 * the margin is never collapsed into a stub the user cannot read around.
 */
export function collapseFor(context: DiffContextMode): { margin: number; minSize: number } | undefined {
  if (context === "all") return undefined;
  return { margin: Number(context), minSize: 4 };
}
