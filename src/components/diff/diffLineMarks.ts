//
//  diffLineMarks.ts
//  VelaTerm
//
//  Created by zhangxiuming on 2026/10/07.
//

//! Line decorations that keep a single side of a comparison marked as a diff.
//!
//! The "both" layout gets its marks from `MergeView` / `unifiedMergeView`, which diff the two sides
//! themselves. The "old" and "new" layouts show one file on its own, so nothing would be marked and the
//! user would be reading a plain file. These extensions re-run the same comparison and decorate the side
//! being displayed: removed lines on the old side, added lines on the new.
//!
//! Colors come from the merge view's own classes (`cm-deletedLine`, `cm-insertedLine`), which
//! `vlxMergeDiffTheme` already styles, so a one-sided view matches the two-sided one instead of
//! introducing a third palette.

import { diff } from "@codemirror/merge";
import { RangeSetBuilder } from "@codemirror/state";
import type { Extension, Text } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, gutterLineClass } from "@codemirror/view";

/** Which side of the comparison is on screen, and therefore which kind of line gets marked. */
export type DiffSide = "old" | "new";

/** One marked line: a 1-based line number, paired with the class describing what changed there. */
export interface DiffLineMark {
  line: number;
  className: string;
}

/**
 * Translate a string diff into the line numbers that changed on one side.
 *
 * `diff` reports character offsets, so a change spanning several lines arrives as a single range. The range
 * is expanded to every line it covers, which is what a line-oriented diff view is expected to show.
 *
 * Returns marks in ascending line order, as `RangeSetBuilder` requires.
 */
export function diffLineMarks(original: string, modified: string, side: DiffSide): DiffLineMark[] {
  const className = side === "old" ? "cm-deletedLine" : "cm-insertedLine";
  const starts = lineStarts(side === "old" ? original : modified);
  const marks: DiffLineMark[] = [];
  let previous = 0;

  for (const change of diff(original, modified)) {
    const from = side === "old" ? change.fromA : change.fromB;
    const to = side === "old" ? change.toA : change.toB;
    // A zero-width range means the *other* side changed here, so this one has nothing to mark.
    if (from === to) continue;

    const first = lineAt(starts, from);
    // The range is half-open, so its last character sits at `to - 1`. Resolving the line from `to` instead
    // would count one line too many whenever the range ends exactly on a line start — which is the normal
    // shape of an inserted line, since the range carries its trailing newline.
    const endLine = lineAt(starts, to - 1);

    for (let line = Math.max(first, previous + 1); line <= endLine; line += 1) {
      marks.push({ line, className });
      previous = line;
    }
  }

  return marks;
}

/** Offsets at which each line starts; index `i` holds line `i + 1`. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

/**
 * Index of the 1-based line holding `offset`, clamped to the last line. An offset sitting exactly on a line
 * start belongs to that line, which is why the comparison is `<=`.
 */
function lineAt(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

/** Gutter marker carrying the side's gutter color class, matching the merge view's own gutter. */
class DiffLineGutterMarker extends GutterMarker {
  constructor(readonly elementClass: string) {
    super();
  }
}

/**
 * Extension marking the changed lines of one side, tinting both the line background and its line-number
 * gutter cell.
 *
 * `doc` must be the text of the side being displayed, since line numbers are resolved against it. The view
 * is read-only and its document never changes, so the decorations are computed once with no inputs and
 * never need to react to edits.
 */
export function diffLineMarksExtension(
  original: string,
  modified: string,
  side: DiffSide,
  doc: Text,
): Extension[] {
  const marks = diffLineMarks(original, modified, side);
  const lineClass = side === "old" ? "cm-deletedLine" : "cm-insertedLine";
  const gutterClass = side === "old" ? "cm-deletedLineGutter" : "cm-insertedLineGutter";
  const lineDecoration = Decoration.line({ class: lineClass });
  const gutterMarker = new DiffLineGutterMarker(gutterClass);

  return [
    EditorView.decorations.compute([], () => {
      const builder = new RangeSetBuilder<Decoration>();
      for (const mark of marks) {
        builder.add(doc.line(mark.line).from, doc.line(mark.line).from, lineDecoration);
      }
      return builder.finish();
    }),
    gutterLineClass.compute([], () => {
      const builder = new RangeSetBuilder<GutterMarker>();
      for (const mark of marks) {
        builder.add(doc.line(mark.line).from, doc.line(mark.line).from, gutterMarker);
      }
      return builder.finish();
    }),
  ];
}
