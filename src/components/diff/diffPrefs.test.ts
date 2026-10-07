//! Coverage for the Changes modal's persisted view preferences: a hand-edited or outdated stored value must
//! never reach CodeMirror as garbage, and the context choice has to translate into the right collapse option.

import { beforeEach, describe, expect, it } from "vitest";
import {
  collapseFor,
  DEFAULT_DIFF_PREFS,
  DIFF_PREFS_KEY,
  loadDiffPrefs,
  saveDiffPrefs,
} from "./diffPrefs";

describe("diffPrefs", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("falls back to the defaults when nothing is stored", () => {
    expect(loadDiffPrefs()).toEqual(DEFAULT_DIFF_PREFS);
  });

  it("round-trips a saved choice", () => {
    saveDiffPrefs({ content: "new", context: "all", layout: "unified" });
    expect(loadDiffPrefs()).toEqual({ content: "new", context: "all", layout: "unified" });
  });

  it("drops individual fields that are missing or unrecognized", () => {
    localStorage.setItem(DIFF_PREFS_KEY, JSON.stringify({ content: "sideways", context: "20" }));
    expect(loadDiffPrefs()).toEqual({ content: "both", context: "20", layout: "split" });
  });

  it("survives corrupt JSON", () => {
    localStorage.setItem(DIFF_PREFS_KEY, "{not json");
    expect(loadDiffPrefs()).toEqual(DEFAULT_DIFF_PREFS);
  });

  it("maps the context choice onto collapseUnchanged, and full context onto no collapsing at all", () => {
    expect(collapseFor("3")).toEqual({ margin: 3, minSize: 4 });
    expect(collapseFor("20")).toEqual({ margin: 20, minSize: 4 });
    expect(collapseFor("all")).toBeUndefined();
  });
});
