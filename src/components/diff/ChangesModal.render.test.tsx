//! End-to-end rendering coverage for the Changes modal, driving the real CodeMirror instead of stubbing it.
//!
//! ChangesModal.test.tsx stubs the editors so it can assert which shape the modal asks for; this file does the
//! opposite, mounting the actual merge extensions to prove the shapes render. It exists because the merged
//! column is the one layout whose output cannot be inferred from the config: `unifiedMergeView` decides for
//! itself how to draw a replaced line, and only its DOM shows whether deleted text really lands inline above
//! its replacement rather than disappearing or duplicating.
//!
//! jsdom has no layout engine, so nothing here asserts geometry — only structure and text order, which is
//! exactly what the CodeMirror merge extension computes in JavaScript.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gitChangedFiles: vi.fn(),
  gitFileDiff: vi.fn(),
}));

vi.mock("../../ipc/commands", () => ({
  gitChangedFiles: mocks.gitChangedFiles,
  gitCommitFiles: vi.fn().mockResolvedValue([]),
  gitFileDiff: mocks.gitFileDiff,
  gitCommitFileDiff: vi.fn(),
}));

vi.mock("../../hooks/nativeViewSuspend", () => ({ useSuspendNativeViews: () => {} }));

// The language catalogue pulls in every grammar in @codemirror/language-data; the diff does not need syntax
// highlighting to prove which lines are drawn where.
vi.mock("./codeMirrorTheme", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./codeMirrorTheme")>();
  return { ...actual, languageExtensionFor: vi.fn().mockResolvedValue(null) };
});

import { ChangesModal } from "./ChangesModal";
import { useTermStore } from "../../store/termStore";

const ORIGINAL = "line one\nOLD line\nline three\n";
const MODIFIED = "line one\nNEW line\nline three\n";

async function openModal(diff?: { original: string; modified: string }) {
  mocks.gitChangedFiles.mockResolvedValue([
    { path: "src/a.ts", status: "modified", additions: 1, deletions: 1, binary: false },
  ]);
  mocks.gitFileDiff.mockResolvedValue({
    path: "src/a.ts",
    original: diff?.original ?? ORIGINAL,
    modified: diff?.modified ?? MODIFIED,
    binary: false,
  });
  useTermStore.getState().openChanges("/repo");
  const view = render(<ChangesModal />);
  await waitFor(() => expect(screen.getByText("a.ts")).toBeTruthy());
  // The editors mount through a dynamic import; wait for the first one to land.
  await waitFor(() => expect(view.container.querySelector(".cm-editor")).toBeTruthy());
  return view;
}

describe("ChangesModal rendering", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.gitChangedFiles.mockReset();
    mocks.gitFileDiff.mockReset();
  });

  afterEach(() => {
    cleanup();
    useTermStore.getState().closeChanges();
  });

  it("draws two aligned editors in the split layout", async () => {
    const { container } = await openModal();
    await waitFor(() => expect(container.querySelectorAll(".cm-editor").length).toBe(2));
    expect(container.querySelector(".cm-mergeView")).toBeTruthy();
    expect(container.querySelector(".cm-merge-a")).toBeTruthy();
    expect(container.querySelector(".cm-merge-b")).toBeTruthy();
  });

  it("merges the comparison into one column with deleted lines inlined above their replacement", async () => {
    const { container } = await openModal();
    fireEvent.click(screen.getByText("Unified"));

    await waitFor(() => expect(container.querySelector(".cm-deletedChunk")).toBeTruthy());
    expect(container.querySelectorAll(".cm-editor").length).toBe(1);
    expect(container.querySelector(".cm-mergeView")).toBeNull();

    // The deleted line is present and comes before the line that replaced it — that ordering is the whole
    // point of the merged layout, and it is decided inside the merge extension rather than by this modal.
    const text = container.querySelector(".cm-content")!.textContent!;
    expect(text).toContain("OLD line");
    expect(text).toContain("NEW line");
    expect(text.indexOf("OLD line")).toBeLessThan(text.indexOf("NEW line"));
  });

  it("shows a single side's file on its own, with the lines that changed marked", async () => {
    const { container } = await openModal();
    fireEvent.click(screen.getByText("Old"));

    await waitFor(() => expect(container.querySelectorAll(".cm-editor").length).toBe(1));
    // One editor, not a comparison: no merge view and none of its inlined deleted chunks.
    expect(container.querySelector(".cm-mergeView")).toBeNull();
    expect(container.querySelector(".cm-deletedChunk")).toBeNull();
    const text = container.querySelector(".cm-content")!.textContent!;
    expect(text).toContain("OLD line");
    expect(text).not.toContain("NEW line");

    // The side is still marked as a diff: the old side shows its removed line, and nothing is marked as
    // inserted because that line lives on the other side.
    expect(container.querySelectorAll(".cm-deletedLine").length).toBe(1);
    expect(container.querySelectorAll(".cm-insertedLine").length).toBe(0);

    fireEvent.click(screen.getByText("New"));
    await waitFor(() => expect(container.querySelector(".cm-content")!.textContent).toContain("NEW line"));
    expect(container.querySelector(".cm-content")!.textContent).not.toContain("OLD line");

    // The marks follow the side: additions here, no deletions.
    expect(container.querySelectorAll(".cm-insertedLine").length).toBe(1);
    expect(container.querySelectorAll(".cm-deletedLine").length).toBe(0);
  });

  it("hides unchanged context when the context control is set to 3 lines", async () => {
    // 20 unchanged lines on each side of a one-line change: a 3-line margin folds the middle away, while the
    // whole-file setting must leave no fold behind. Only the fold marker is asserted — CodeMirror renders just
    // the lines its viewport covers, and jsdom has no layout, so the distant lines are legitimately absent
    // from the DOM either way and prove nothing.
    const head = Array.from({ length: 20 }, (_, i) => `head ${i}`).join("\n");
    const tail = Array.from({ length: 20 }, (_, i) => `tail ${i}`).join("\n");

    const { container } = await openModal({
      original: `${head}\nOLD\n${tail}\n`,
      modified: `${head}\nNEW\n${tail}\n`,
    });
    await waitFor(() => expect(container.querySelector(".cm-collapsedLines")).toBeTruthy());

    fireEvent.click(screen.getByText("Full"));
    await waitFor(() => expect(container.querySelector(".cm-collapsedLines")).toBeNull());
    // Both sides are still drawn, with the change present in each.
    const sides = Array.from(container.querySelectorAll(".cm-content")).map((n) => n.textContent ?? "");
    expect(sides.length).toBe(2);
    expect(sides.join("\n")).toContain("OLD");
    expect(sides.join("\n")).toContain("NEW");
  });
});
