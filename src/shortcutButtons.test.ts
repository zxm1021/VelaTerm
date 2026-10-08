import { describe, expect, it } from "vitest";
import {
  MAX_PROJECT_SHORTCUTS,
  MAX_SHORTCUT_TITLE,
  makeShortcutButton,
  moveShortcutButton,
  resolveShortcutProjectId,
  sanitizeShortcutButtons,
  type ShortcutButton,
  type ShortcutScope,
} from "./shortcutButtons";
import type { Project, Session } from "./types";

const button = (id: string, title = id): ShortcutButton => ({ id, title, type: "url", value: "https://x" });

describe("sanitizeShortcutButtons", () => {
  it("keeps well-formed buttons and trims their fields", () => {
    expect(sanitizeShortcutButtons([{ id: "a", title: "  Gerrit ", type: "url", value: " https://g " }], null))
      .toEqual([{ id: "a", title: "Gerrit", type: "url", value: "https://g" }]);
  });

  it("drops entries a click could not carry out", () => {
    const raw = [
      { id: "a", title: "ok", type: "url", value: "https://a" },
      { id: "", title: "no id", type: "url", value: "https://b" },
      { id: "b", title: "   ", type: "url", value: "https://c" },
      { id: "c", title: "no value", type: "url", value: "  " },
      { id: "d", title: "unknown type", type: "webhook", value: "https://d" },
      42,
      null,
      "nonsense",
    ];
    expect(sanitizeShortcutButtons(raw, null).map((b) => b.id)).toEqual(["a"]);
  });

  it("keeps the first of a duplicated id", () => {
    const raw = [
      { id: "a", title: "first", type: "url", value: "https://a" },
      { id: "a", title: "second", type: "url", value: "https://b" },
    ];
    expect(sanitizeShortcutButtons(raw, null)).toEqual([
      { id: "a", title: "first", type: "url", value: "https://a" },
    ]);
  });

  it("caps the list after filtering, so junk does not consume the budget", () => {
    const raw = [
      { id: "a", title: "a", type: "url", value: "https://a" },
      { id: "", title: "junk", type: "url", value: "https://x" },
      { id: "b", title: "b", type: "url", value: "https://b" },
      { id: "c", title: "c", type: "url", value: "https://c" },
    ];
    expect(sanitizeShortcutButtons(raw, 2).map((b) => b.id)).toEqual(["a", "b"]);
    expect(MAX_PROJECT_SHORTCUTS).toBe(5);
  });

  it("caps an over-long title rather than rejecting the button", () => {
    const [only] = sanitizeShortcutButtons(
      [{ id: "a", title: "x".repeat(80), type: "bash", value: "ls" }],
      null,
    );
    expect(only.title).toHaveLength(MAX_SHORTCUT_TITLE);
  });

  it("returns an empty list for anything that is not an array", () => {
    expect(sanitizeShortcutButtons(undefined, null)).toEqual([]);
    expect(sanitizeShortcutButtons({ id: "a" }, null)).toEqual([]);
  });
});

describe("makeShortcutButton", () => {
  it("trims the dialog's fields and gives every button its own id", () => {
    const a = makeShortcutButton(" Gerrit ", "url", " https://gerrit ");
    const b = makeShortcutButton("Gerrit", "url", "https://gerrit");
    expect(a).toMatchObject({ title: "Gerrit", type: "url", value: "https://gerrit" });
    expect(a.id).not.toBe(b.id);
  });
});

describe("moveShortcutButton", () => {
  const list = [button("a"), button("b"), button("c")];

  it("swaps with the neighbour in the given direction", () => {
    expect(moveShortcutButton(list, 1, -1).map((b) => b.id)).toEqual(["b", "a", "c"]);
    expect(moveShortcutButton(list, 1, 1).map((b) => b.id)).toEqual(["a", "c", "b"]);
  });

  it("leaves the list alone at either end", () => {
    expect(moveShortcutButton(list, 0, -1)).toBe(list);
    expect(moveShortcutButton(list, 2, 1)).toBe(list);
  });
});

describe("resolveShortcutProjectId", () => {
  const project = (id: string, rootPath = `/tmp/${id}`): Project =>
    ({ id, name: id, rootPath, sortOrder: 0, collapsed: false, createdAt: 0 });
  const base: ShortcutScope = {
    // A collection carries an empty rootPath; see `isVirtualProject`.
    projects: [project("p1"), project("p2"), project("collection", "")],
    groups: [{ id: "gr1", projectId: "p2", name: "gr1", sortOrder: 0, collapsed: false, createdAt: 0 }],
    sessions: [
      { id: "s1", projectId: "p1" } as Session,
      { id: "s2", projectId: "p2" } as Session,
    ],
    activeSessionId: "s1",
    selection: [],
    inspectTarget: null,
  };

  it("follows the selected project, group and session", () => {
    expect(resolveShortcutProjectId({ ...base, selection: [{ id: "p2", kind: "project" }] })).toBe("p2");
    expect(resolveShortcutProjectId({ ...base, selection: [{ id: "gr1", kind: "group" }] })).toBe("p2");
    expect(resolveShortcutProjectId({ ...base, selection: [{ id: "s2", kind: "session" }] })).toBe("p2");
  });

  it("falls back to the active tab when nothing is selected", () => {
    expect(resolveShortcutProjectId(base)).toBe("p1");
  });

  it("ignores a multi-selection, which names no single project", () => {
    const state: ShortcutScope = {
      ...base,
      selection: [{ id: "s2", kind: "session" }, { id: "p2", kind: "project" }],
    };
    expect(resolveShortcutProjectId(state)).toBe("p1");
  });

  it("falls back to the inspected node when the sidebar selection is empty", () => {
    const state: ShortcutScope = { ...base, inspectTarget: { id: "s2", kind: "session" } };
    expect(resolveShortcutProjectId(state)).toBe("p2");
  });

  it("treats a collection as having no project, falling back to the active tab", () => {
    expect(resolveShortcutProjectId({ ...base, selection: [{ id: "collection", kind: "project" }] })).toBe("p1");
  });

  it("returns null with no selection, no active tab and no inspection", () => {
    expect(resolveShortcutProjectId({ ...base, activeSessionId: null })).toBeNull();
  });
});
