//! Shared CodeMirror colors, highlighting, language loading, and layout extensions for the ChangesModal
//! diff view. The theme uses Vlinx CSS variables and follows light/dark mode automatically; the highlight
//! map uses the five-color palette plus text-hierarchy variables. SourceEditor.tsx currently carries an
//! equivalent definition that can later be consolidated into this module.
//!
//! `vlxMergeDiffTheme` additionally overrides the merge view's own diff colors, which do not follow the
//! app theme on their own; see its comment for why.

import {
  HighlightStyle,
  LanguageDescription,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { tags } from "@lezer/highlight";

/** Highlight map shared by Markdown and code, using Vlinx's five colors and text hierarchy with automatic light/dark switching. */
export const vlxHighlight = HighlightStyle.define([
  // ── Markdown ──
  { tag: tags.heading, color: "var(--accent)", fontWeight: "600" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.monospace, color: "var(--mag)" },
  { tag: tags.link, color: "var(--cyan)" },
  { tag: tags.url, color: "var(--cyan)", textDecoration: "underline" },
  { tag: tags.quote, color: "var(--text-mid)", fontStyle: "italic" },
  { tag: tags.contentSeparator, color: "var(--text-dim)" },
  // ── General code ──
  { tag: tags.comment, color: "var(--text-dim)", fontStyle: "italic" },
  { tag: tags.meta, color: "var(--text-dim)" },
  { tag: tags.processingInstruction, color: "var(--text-dim)" },
  { tag: tags.keyword, color: "var(--mag)" },
  { tag: tags.string, color: "var(--green)" },
  { tag: tags.number, color: "var(--yellow)" },
  { tag: tags.typeName, color: "var(--yellow)" },
  { tag: tags.className, color: "var(--yellow)" },
  { tag: tags.bool, color: "var(--yellow)" },
  { tag: tags.atom, color: "var(--yellow)" },
  { tag: tags.null, color: "var(--yellow)" },
  { tag: tags.attributeName, color: "var(--yellow)" },
  { tag: tags.function(tags.variableName), color: "var(--cyan)" },
  { tag: tags.function(tags.propertyName), color: "var(--cyan)" },
  { tag: tags.tagName, color: "var(--red)" },
  { tag: tags.regexp, color: "var(--red)" },
  { tag: tags.escape, color: "var(--red)" },
  { tag: tags.definition(tags.variableName), color: "var(--text)" },
  { tag: tags.operator, color: "var(--text-mid)" },
  { tag: tags.punctuation, color: "var(--text-mid)" },
  { tag: tags.bracket, color: "var(--text-mid)" },
]);

/** Base CodeMirror theme using Vlinx variables, a transparent background, and automatic light/dark mode. */
export const vlxCmTheme = EditorView.theme({
  "&": {
    // One step above the app's 12.5px UI default: a diff is read line by line against a line number, and the
    // extra size is what keeps the two sides comfortable to scan. Only the diff modal uses this theme.
    fontSize: "13.5px",
    backgroundColor: "transparent",
    color: "var(--text)",
  },
  ".cm-content": { fontFamily: "var(--font-mono)" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--text-faint)",
    border: "none",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { lineHeight: "1.5" },
});

/** Highlight and theme extensions shared by both sides of a diff. */
export function vlxCmHighlighting(): Extension {
  return [syntaxHighlighting(vlxHighlight), vlxCmTheme];
}

/**
 * Make a standalone editor fill its container instead of growing to its content height.
 *
 * A MergeView cannot use this: it sizes both editors to their content so the two sides scroll together,
 * and a 100% height would break that alignment. Single-editor views — a one-sided file or the merged
 * column — have no sibling to align with and must fill the pane, or a short file leaves the scroller
 * shorter than the modal and the background shows through below it.
 */
export function vlxCmFillHeight(): Extension {
  return EditorView.theme({
    "&": { height: "100%" },
    ".cm-scroller": { overflow: "auto" },
  });
}

/**
 * GitHub-style diff colors for the merge view, in the spirit of the diff2html theme used elsewhere in the
 * Vlinx tooling.
 *
 * Two problems make this necessary. First, the merge view's own defaults are a muted brown/tan
 * (`rgba(160, 128, 100, .08)` for deletions, `rgba(100, 160, 128, .08)` for insertions) rather than the red
 * and green a diff is read by, and nothing in this module ever replaced them. Second, the merge view picks
 * between its light and dark palettes through CodeMirror's `darkTheme` facet, which this app never sets:
 * its editors follow `[data-theme]` instead, so a dark window was being shown the light palette.
 *
 * The app's scheme is therefore keyed off `[data-theme]` directly. That prefix is not decoration: the merge
 * view injects its own base theme into the same shared extension list, *after* the caller's extensions, and
 * a theme injected later wins at equal specificity. Writing a bare `&.cm-merge-a` selector would therefore
 * lose to the brown default it means to replace. The attribute prefix raises specificity above it.
 *
 * Color values follow the diff2html palette: `#fee8e9`/`#dfd` on light, and GitHub's translucent
 * `rgba(248, 81, 73, …)`/`rgba(46, 160, 67, …)` on dark. Those alphas are tuned for GitHub's `#0d1117`
 * canvas, which is much darker than this app's `--bg-0`, so the dark values are composed with `color-mix`
 * against the real background instead: the same hue, at a weight that stays legible here.
 *
 * Every selector spells out its own `&`, even where a plain class would read better. CodeMirror only
 * substitutes the theme class into a selector that contains `&`; without one it falls back to prefixing the
 * whole selector with the editor's class, which turns `[data-theme='dark'] .cm-x` into "a dark element
 * *inside* the editor" — a selector that never matches, since the attribute sits on `documentElement`.
 * `&` must therefore follow the `[data-theme]` ancestor part and stay glued to the class it modifies.
 */
export const vlxMergeDiffTheme = EditorView.theme({
  // Whole changed lines. `cm-merge-a` is the original side, `cm-merge-b` the modified one; the unified
  // merge view also carries `cm-merge-b`, so its inlined deletions are handled separately below.
  "&.cm-merge-a .cm-changedLine": { backgroundColor: "#fee8e9" },
  "&.cm-merge-b .cm-changedLine": { backgroundColor: "#dfd" },
  "[data-theme='dark'] &.cm-merge-a .cm-changedLine": {
    backgroundColor: "color-mix(in srgb, #f85149 16%, var(--bg-0))",
  },
  "[data-theme='dark'] &.cm-merge-b .cm-changedLine": {
    backgroundColor: "color-mix(in srgb, #3fb950 16%, var(--bg-0))",
  },

  // The characters that actually changed within a line. diff2html only colors whole lines, but CodeMirror
  // already computes the character-level range, so the distinction comes for free.
  //
  // These set `background` rather than `background-color`. The merge view marks changed characters with a
  // 2px gradient bar pinned to the bottom of the span (`background: linear-gradient(…) center bottom /
  // 100% 2px no-repeat`), which reads as an underline. Cascade resolves per longhand, so setting only
  // `background-color` left that rule's `background-image` in place and the bar kept painting over the new
  // color. The shorthand resets every background sub-property at once, which drops the bar.
  "&.cm-merge-a .cm-changedText": { background: "#ffb6ba" },
  "&.cm-merge-b .cm-changedText": { background: "#97f295" },
  "& .cm-deletedChunk .cm-deletedText": { background: "#ffb6ba" },
  "[data-theme='dark'] &.cm-merge-a .cm-changedText": {
    background: "color-mix(in srgb, #f85149 34%, var(--bg-0))",
  },
  "[data-theme='dark'] &.cm-merge-b .cm-changedText": {
    background: "color-mix(in srgb, #3fb950 34%, var(--bg-0))",
  },
  "[data-theme='dark'] & .cm-deletedChunk .cm-deletedText": {
    background: "color-mix(in srgb, #f85149 34%, var(--bg-0))",
  },

  // Blocks the unified merge view inlines above the text that replaced them.
  "& .cm-deletedChunk": { backgroundColor: "#fee8e9" },
  "[data-theme='dark'] & .cm-deletedChunk": {
    backgroundColor: "color-mix(in srgb, #f85149 16%, var(--bg-0))",
  },

  // The old/new layouts render one file on its own, so `diffLineMarks` decorates it with these classes
  // rather than the merge view's. The merge view only ever strips their text decoration and never colors
  // them, so the palette has to be applied here; it matches the two-sided view's.
  "& .cm-deletedLine": { backgroundColor: "#fee8e9" },
  "& .cm-insertedLine": { backgroundColor: "#dfd" },
  "[data-theme='dark'] & .cm-deletedLine": {
    backgroundColor: "color-mix(in srgb, #f85149 16%, var(--bg-0))",
  },
  "[data-theme='dark'] & .cm-insertedLine": {
    backgroundColor: "color-mix(in srgb, #3fb950 16%, var(--bg-0))",
  },

  // The 3px change bar in the gutter. diff2html has no equivalent; it is kept because it is the only cue
  // that survives once a changed line scrolls out of the colored region.
  "&.cm-merge-a .cm-changedLineGutter": { backgroundColor: "#e9aeae" },
  "&.cm-merge-b .cm-changedLineGutter": { backgroundColor: "#b4e2b4" },
  "& .cm-deletedLineGutter": { backgroundColor: "#e9aeae" },
  "& .cm-insertedLineGutter": { backgroundColor: "#b4e2b4" },
  "[data-theme='dark'] &.cm-merge-a .cm-changedLineGutter": { backgroundColor: "#f85149" },
  "[data-theme='dark'] &.cm-merge-b .cm-changedLineGutter": { backgroundColor: "#3fb950" },
  "[data-theme='dark'] & .cm-deletedLineGutter": { backgroundColor: "#f85149" },
  "[data-theme='dark'] & .cm-insertedLineGutter": { backgroundColor: "#3fb950" },

  // Collapsed runs of unchanged lines. diff2html keeps a gray band with a count; the merge view shows a
  // pair of ⦚ glyphs, which is left alone — only the band is recolored to the app's surfaces.
  "& .cm-collapsedLines": { color: "var(--text-dim)" },
  "[data-theme='light'] & .cm-collapsedLines": {
    background: "linear-gradient(to bottom, transparent 0, #f7f7f7 30%, #f7f7f7 70%, transparent 100%)",
  },
  "[data-theme='dark'] & .cm-collapsedLines": {
    background: "linear-gradient(to bottom, transparent 0, var(--bg-2) 30%, var(--bg-2) 70%, transparent 100%)",
  },
});

/** Match a language by filename and load its extension asynchronously; return null for plain text on no match or load failure. */export async function languageExtensionFor(
  path: string,
): Promise<Extension | null> {
  const basename = path.split("/").pop() || path;
  const desc = LanguageDescription.matchFilename(languages, basename);
  if (!desc) return null;
  try {
    return await desc.load();
  } catch {
    return null;
  }
}
