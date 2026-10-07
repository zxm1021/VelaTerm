//! Coverage for the Changes modal's view controls and its full-window layout. The three controls are
//! independent dimensions, and two of them describe a comparison that a single-side view does not perform —
//! so they must go inert, not silently do nothing. `/` toggles the layout from the keyboard.
//!
//! The file-list panel collapses by width rather than unmounting, the header names the project and branch the
//! diff belongs to, and the close chord belongs to the modal while it is open.
//!
//! CodeMirror is stubbed rather than rendered: jsdom has no layout engine, and what these tests care about
//! is which editor shape the modal asks for, which is exactly the boundary the stubs record.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mergeViews: [] as { a: string; b: string; collapseUnchanged?: unknown }[],
  editors: [] as { doc: string; unified: boolean }[],
  gitChangedFiles: vi.fn(),
  gitFileDiff: vi.fn(),
  getGitStatus: vi.fn(),
  mergeViewStub: vi.fn(),
  editorViewStub: vi.fn(),
  unifiedMergeViewStub: vi.fn(),
}));

vi.mock("../../ipc/commands", () => ({
  gitChangedFiles: mocks.gitChangedFiles,
  gitCommitFiles: vi.fn().mockResolvedValue([]),
  gitFileDiff: mocks.gitFileDiff,
  gitCommitFileDiff: vi.fn(),
}));

// The branch shown in the header comes from the same call the Git panel's branch row uses.
vi.mock("../../ipc/info", () => ({
  getGitStatus: mocks.getGitStatus,
}));

vi.mock("@codemirror/merge", () => ({
  MergeView: class {
    constructor(config: { a: { doc: string }; b: { doc: string }; collapseUnchanged?: unknown }) {
      mocks.mergeViews.push({ a: config.a.doc, b: config.b.doc, collapseUnchanged: config.collapseUnchanged });
      mocks.mergeViewStub();
    }
    destroy() {}
  },
  unifiedMergeView: (config: unknown) => {
    mocks.unifiedMergeViewStub(config);
    return [];
  },
  // The one-sided layouts replay the comparison to mark changed lines. The real algorithm is covered by
  // diffLineMarks.test.ts; here only the fact that it is asked for a side matters.
  diff: () => [],
}));

vi.mock("@codemirror/view", () => ({
  EditorView: class {
    constructor(config: { doc: string }) {
      // The unified extension is pushed into the same list, so a marker in it is what distinguishes the
      // merged column from a plain one-sided file.
      mocks.editors.push({ doc: config.doc, unified: mocks.unifiedMergeViewStub.mock.calls.length > 0 });
      mocks.editorViewStub();
    }
    destroy() {}
    static theme() {
      return [];
    }
    static editable = { of: () => [] };
    static lineWrapping = [];
    static decorations = { compute: () => [] };
  },
  lineNumbers: () => [],
  gutterLineClass: { compute: () => [] },
  Decoration: { line: () => ({}) },
  GutterMarker: class {},
}));

vi.mock("@codemirror/state", () => ({
  EditorState: { readOnly: { of: () => [] } },
  Text: { of: (lines: string[]) => ({ lines }) },
  RangeSetBuilder: class {
    add() {}
    finish() {
      return [];
    }
  },
}));

vi.mock("./codeMirrorTheme", () => ({
  vlxCmHighlighting: () => [],
  vlxCmFillHeight: () => [],
  vlxMergeDiffTheme: [],
  languageExtensionFor: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../hooks/nativeViewSuspend", () => ({ useSuspendNativeViews: () => {} }));

// Two things decide what "mod+w" means, and both are resolved from the environment rather than passed in:
// shortcutRegistry reads navigator.platform at module load to pick the macOS keymap, and MOD_IS_CMD keys off
// the client kind. jsdom reports a non-Mac platform and a browser client, which together select the
// Ctrl+Alt keymap, so the close chord under test would never match. Both are pinned to the macOS desktop
// values here; the registry's real combo parsing stays in play. This must run before the imports below.
vi.hoisted(() => {
  Object.defineProperty(globalThis.navigator, "platform", { value: "MacIntel", configurable: true });
});
vi.mock("../../platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../platform")>();
  return { ...actual, env: { ...actual.env, isBrowser: false } };
});

import { ChangesModal } from "./ChangesModal";
import { useTermStore } from "../../store/termStore";

/** Open the modal on a one-file repository with a known diff. */
async function openModal() {
  mocks.gitChangedFiles.mockResolvedValue([
    { path: "src/a.ts", status: "modified", additions: 1, deletions: 1, binary: false },
  ]);
  mocks.gitFileDiff.mockResolvedValue({
    path: "src/a.ts",
    original: "old line\n",
    modified: "new line\n",
    binary: false,
  });
  mocks.getGitStatus.mockResolvedValue({ isRepo: true, branch: "main", ahead: 0, behind: 0, staged: 0, unstaged: 1, untracked: 0 });
  // The header names the project owning the open repository, so one has to exist for the name to resolve.
  useTermStore.setState({
    projects: [
      { id: "p1", name: "demo-project", rootPath: "/repo", sortOrder: 0, collapsed: false, createdAt: 0 },
    ],
  });
  useTermStore.getState().openChanges("/repo");
  render(<ChangesModal />);
  await waitFor(() => expect(screen.getByText("a.ts")).toBeTruthy());
  await waitFor(() => expect(mocks.mergeViews.length).toBe(1));
}

/** The file-list panel, found through the row it renders rather than by a test-only attribute. */
function listPanel(): HTMLElement {
  return screen.getByText("a.ts").closest("div[style]")!.parentElement as HTMLElement;
}

describe("ChangesModal", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.mergeViews.length = 0;
    mocks.editors.length = 0;
    mocks.gitChangedFiles.mockReset();
    mocks.gitFileDiff.mockReset();
    mocks.getGitStatus.mockReset();
    mocks.mergeViewStub.mockClear();
    mocks.editorViewStub.mockClear();
    mocks.unifiedMergeViewStub.mockClear();
  });

  afterEach(() => {
    cleanup();
    useTermStore.getState().closeChanges();
  });

  it("fills the window instead of floating in it", async () => {
    await openModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog.style.position).toBe("fixed");
    expect(dialog.style.inset).toBe("0px");
    expect(dialog.style.background).toBe("var(--bg-panel)");
  });

  it("names the project and branch the diff belongs to", async () => {
    await openModal();
    expect(screen.getByText("main")).toBeTruthy();
    // The store is seeded with a project whose root contains the open repository, so the header can name it.
    await waitFor(() => expect(screen.getByText("demo-project")).toBeTruthy());
  });

  it("collapses the file list instead of unmounting it", async () => {
    await openModal();
    const panel = listPanel();
    expect(panel.style.width).toBe("280px");

    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
    // Width-collapsed, not unmounted: the rows survive so their scroll position does.
    expect(panel.style.width).toBe("0px");
    // Asserted through the longhand: jsdom serializes the `borderRight` shorthand back as "medium" whenever
    // a width is involved, so the shorthand reads as set even when its style is none.
    expect(panel.style.borderRightStyle).toBe("none");
    expect(screen.getByText("a.ts")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
    expect(panel.style.width).toBe("280px");
  });

  it("switches to a merged column on the layout control", async () => {
    await openModal();
    fireEvent.click(screen.getByText("Unified"));
    await waitFor(() => expect(mocks.editors.length).toBe(1));
    expect(mocks.mergeViews.length).toBe(1); // the split view is not rebuilt
    expect(mocks.unifiedMergeViewStub).toHaveBeenCalled();
    expect(mocks.editors[0]).toMatchObject({ doc: "new line\n", unified: true });
  });

  it("shows one side's file without comparing when Old or New is picked", async () => {
    await openModal();
    fireEvent.click(screen.getByText("Old"));
    await waitFor(() => expect(mocks.editors.length).toBe(1));
    expect(mocks.editors[0]).toMatchObject({ doc: "old line\n", unified: false });

    fireEvent.click(screen.getByText("New"));
    await waitFor(() => expect(mocks.editors.length).toBe(2));
    expect(mocks.editors[1]).toMatchObject({ doc: "new line\n", unified: false });
  });

  it("disables the comparison controls while a single side is shown", async () => {
    await openModal();
    const buttonFor = (label: string) => screen.getByText(label).closest("button") as HTMLButtonElement;
    fireEvent.click(screen.getByText("Old"));
    expect(buttonFor("3 lines").disabled).toBe(true);
    expect(buttonFor("Split").disabled).toBe(true);
    expect(buttonFor("Both").disabled).toBe(false);
  });

  it("toggles the layout with the slash key", async () => {
    await openModal();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "/" });
    await waitFor(() => expect(mocks.unifiedMergeViewStub).toHaveBeenCalled());
    expect(JSON.parse(localStorage.getItem("vlx-diff-prefs")!).layout).toBe("unified");

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "/" });
    await waitFor(() => expect(mocks.mergeViews.length).toBe(2));
    expect(JSON.parse(localStorage.getItem("vlx-diff-prefs")!).layout).toBe("split");
  });

  it("applies the stored context choice to the comparison", async () => {
    localStorage.setItem("vlx-diff-prefs", JSON.stringify({ content: "both", context: "all", layout: "split" }));
    await openModal();
    expect(mocks.mergeViews[0].collapseUnchanged).toBeUndefined();
  });

  it("closes on Escape", async () => {
    await openModal();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(useTermStore.getState().changesCwd).toBeNull();
  });

  // The global shortcut hook listens on document in the capture phase, so the modal has to claim the close
  // chord on window capture to run first. Without that, Cmd+W closed the pane behind the overlay.
  it("closes on the close-pane chord instead of letting it reach the pane behind", async () => {
    await openModal();
    const closePane = vi.fn();
    useTermStore.setState({ closePane });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", code: "KeyW", metaKey: true, bubbles: true, cancelable: true }));
    expect(useTermStore.getState().changesCwd).toBeNull();
    expect(closePane).not.toHaveBeenCalled();
  });

  it("honours a remapped close-pane chord", async () => {
    localStorage.setItem("vlx-settings", JSON.stringify({}));
    useTermStore.setState({ shortcutOverrides: { closePane: "mod+shift+q" } });
    await openModal();
    // The default chord is no longer the close chord once the action is remapped.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", code: "KeyW", metaKey: true, bubbles: true, cancelable: true }));
    expect(useTermStore.getState().changesCwd).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "q", code: "KeyQ", metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    expect(useTermStore.getState().changesCwd).toBeNull();
  });
});
