//! Coverage for the forced hydration break's open gate.
//!
//! `openWaterBreak` returns whether the dialog actually appeared, and the scheduler uses that answer to
//! decide between advancing to the next slot and retrying the one it already owes. So the interesting
//! behaviour is the refusal: an unfocused window or another dialog on screen must report false *and*
//! leave the flag untouched, or the break is silently dropped.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ipc/commands", () => ({
  createWorktree: vi.fn(),
  getSessionCwd: vi.fn().mockResolvedValue(null),
  ptyKill: vi.fn().mockResolvedValue(undefined),
  ptyWrite: vi.fn().mockResolvedValue(undefined),
  listShells: vi.fn().mockResolvedValue([]),
}));
vi.mock("../ipc/tree", () => ({
  listTree: vi.fn().mockResolvedValue({ projects: [], groups: [], sessions: [] }),
  setCollapsed: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../notify", () => ({
  notify: vi.fn(),
  getNotifyPermission: vi.fn().mockResolvedValue("granted"),
  requestNotifyPermission: vi.fn().mockResolvedValue("granted"),
  getEffectiveNotifyPermission: vi.fn().mockResolvedValue("granted"),
  requestEffectiveNotifyPermission: vi.fn().mockResolvedValue("granted"),
}));

import { useTermStore } from "../store/termStore";

/** Reset the flags this gate reads, since the store is a module-level singleton. */
beforeEach(() => {
  useTermStore.setState({
    waterBreakOpen: false,
    windowFocused: true,
    settingsOpen: false,
    shareOpen: false,
    errorLogOpen: false,
    cloneModalOpen: false,
    notifyGuideOpen: false,
  });
});

describe("openWaterBreak", () => {
  it("opens when the window is focused and nothing else is up", () => {
    expect(useTermStore.getState().openWaterBreak()).toBe(true);
    expect(useTermStore.getState().waterBreakOpen).toBe(true);
  });

  it("refuses while the window is unfocused and leaves the break pending", () => {
    useTermStore.setState({ windowFocused: false });
    expect(useTermStore.getState().openWaterBreak()).toBe(false);
    expect(useTermStore.getState().waterBreakOpen).toBe(false);
  });

  it("refuses while another dialog owns the screen", () => {
    // Every dialog that can already be on screen must block the break: stacking on top would strand
    // whichever of the two is dismissed second.
    for (const flag of [
      "settingsOpen",
      "shareOpen",
      "errorLogOpen",
      "cloneModalOpen",
      "notifyGuideOpen",
    ] as const) {
      useTermStore.setState({ [flag]: true });
      expect(useTermStore.getState().openWaterBreak()).toBe(false);
      expect(useTermStore.getState().waterBreakOpen).toBe(false);
      useTermStore.setState({ [flag]: false });
    }
  });

  it("is idempotent while the break is already on screen", () => {
    expect(useTermStore.getState().openWaterBreak()).toBe(true);
    // Reporting true again is what stops the scheduler from re-arming a second reminder on top of the
    // break that is already running.
    expect(useTermStore.getState().openWaterBreak()).toBe(true);
    expect(useTermStore.getState().waterBreakOpen).toBe(true);
  });

  it("closes only through closeWaterBreak", () => {
    useTermStore.getState().openWaterBreak();
    useTermStore.getState().closeWaterBreak();
    expect(useTermStore.getState().waterBreakOpen).toBe(false);
  });
});
