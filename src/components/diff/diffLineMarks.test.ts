//
//  diffLineMarks.test.ts
//  VelaTerm
//
//  Created by zhangxiuming on 2026/10/07.
//

//! Coverage for the one-sided diff marks, using the real `diff` from @codemirror/merge rather than a stub:
//! the line arithmetic around offset boundaries is the part worth pinning down, and a stubbed comparison
//! would assert nothing about it.

import { describe, expect, it } from "vitest";
import { diffLineMarks } from "./diffLineMarks";

/** Line numbers marked on one side, as a sorted array, for terser expectations. */
function lines(original: string, modified: string, side: "old" | "new"): number[] {
  return diffLineMarks(original, modified, side).map((mark) => mark.line);
}

describe("diffLineMarks", () => {
  it("marks a replaced line on both sides", () => {
    const original = "a\nb\nc\n";
    const modified = "a\nB\nc\n";
    expect(lines(original, modified, "old")).toEqual([2]);
    expect(lines(original, modified, "new")).toEqual([2]);
  });

  it("marks an inserted line only on the new side", () => {
    const original = "a\nb\n";
    const modified = "a\nNEW\nb\n";
    expect(lines(original, modified, "old")).toEqual([]);
    expect(lines(original, modified, "new")).toEqual([2]);
  });

  it("marks a deleted line only on the old side", () => {
    const original = "a\nb\nc\n";
    const modified = "a\nc\n";
    expect(lines(original, modified, "old")).toEqual([2]);
    expect(lines(original, modified, "new")).toEqual([]);
  });

  it("marks every line of a multi-line change", () => {
    const original = "a\nb\nc\nd\ne\n";
    const modified = "a\nX\nY\nZ\ne\n";
    expect(lines(original, modified, "old")).toEqual([2, 3, 4]);
    expect(lines(original, modified, "new")).toEqual([2, 3, 4]);
  });

  it("marks an appended line at the end of the file", () => {
    const original = "a\n";
    const modified = "a\nb\n";
    expect(lines(original, modified, "old")).toEqual([]);
    expect(lines(original, modified, "new")).toEqual([2]);
  });

  it("marks nothing when the sides are identical", () => {
    const text = "a\nb\nc\n";
    expect(lines(text, text, "old")).toEqual([]);
    expect(lines(text, text, "new")).toEqual([]);
  });

  it("handles a change on the last line without a trailing newline", () => {
    const original = "a\nb";
    const modified = "a\nB";
    expect(lines(original, modified, "old")).toEqual([2]);
    expect(lines(original, modified, "new")).toEqual([2]);
  });

  it("carries the class matching the side being shown", () => {
    const original = "a\nb\n";
    const modified = "a\nB\n";
    expect(diffLineMarks(original, modified, "old")[0]?.className).toBe("cm-deletedLine");
    expect(diffLineMarks(original, modified, "new")[0]?.className).toBe("cm-insertedLine");
  });
});
