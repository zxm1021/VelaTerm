//! Coverage for the reminder scheduler's lifecycle.
//!
//! The scheduler is the part that cannot be checked by reading the schedule arithmetic: whether it arms
//! only while the preference is on, whether a reminder that comes due while the window is unfocused is
//! retried rather than dropped, and whether it defers to a dialog that is already open. All three are
//! invisible until one of them goes wrong at 15:00 on a Tuesday.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
// The scheduler deliberately no-ops outside a desktop shell, so the suite has to claim to be one. Only
// `env` is overridden; everything else on the platform module is left alone for the store's benefit.
vi.mock("../platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../platform")>();
  return { ...actual, env: { ...actual.env, isTauri: true } };
});

import { useTermStore } from "../store/termStore";
import { nextWaterReminderAt, startWaterReminder } from "./waterReminder";

/** Local 2026-10-08 is a Thursday, so every slot is a weekday slot. */
const THURSDAY_9AM = new Date(2026, 9, 8, 9, 0, 0);

let stop: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(THURSDAY_9AM);
  useTermStore.setState({
    waterReminder: true,
    waterBreakOpen: false,
    windowFocused: true,
    settingsOpen: false,
    shareOpen: false,
    errorLogOpen: false,
    cloneModalOpen: false,
    notifyGuideOpen: false,
  });
});

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
});

/**
 * Advance the fake clock from wherever it is to `hour`, firing the scheduler's pending timer on the way.
 * `setSystemTime` alone would move the clock without running the timer, which is exactly the wrong thing
 * here: the point is to observe what the scheduler does when its timer fires.
 */
const advanceToSlot = (hour: number) => {
  const target = new Date(2026, 9, 8, hour, 0, 0).getTime();
  vi.advanceTimersByTime(target - Date.now());
};

describe("startWaterReminder", () => {
  it("does not arm while the preference is off", () => {
    useTermStore.setState({ waterReminder: false });
    stop = startWaterReminder();
    advanceToSlot(10);
    expect(useTermStore.getState().waterBreakOpen).toBe(false);
  });

  it("opens the break when a slot arrives", () => {
    stop = startWaterReminder();
    advanceToSlot(10);
    expect(useTermStore.getState().waterBreakOpen).toBe(true);
  });

  it("arms as soon as the preference is switched on", () => {
    useTermStore.setState({ waterReminder: false });
    stop = startWaterReminder();
    advanceToSlot(10);
    expect(useTermStore.getState().waterBreakOpen).toBe(false);

    useTermStore.setState({ waterReminder: true });
    advanceToSlot(11);
    expect(useTermStore.getState().waterBreakOpen).toBe(true);
  });

  it("cancels a pending reminder when the preference is switched off", () => {
    stop = startWaterReminder();
    useTermStore.setState({ waterReminder: false });
    advanceToSlot(10);
    expect(useTermStore.getState().waterBreakOpen).toBe(false);
  });

  it("retries a reminder that came due while the window was unfocused", () => {
    stop = startWaterReminder();
    useTermStore.setState({ windowFocused: false });
    advanceToSlot(10);
    // Unfocused: refused, and still owed.
    expect(useTermStore.getState().waterBreakOpen).toBe(false);

    useTermStore.setState({ windowFocused: true });
    // The retry cadence, not the next slot, is what brings it back.
    vi.advanceTimersByTime(5_000);
    expect(useTermStore.getState().waterBreakOpen).toBe(true);
  });

  it("defers to a dialog that is already open, then fires once it closes", () => {
    stop = startWaterReminder();
    useTermStore.setState({ settingsOpen: true });
    advanceToSlot(10);
    expect(useTermStore.getState().waterBreakOpen).toBe(false);

    useTermStore.setState({ settingsOpen: false });
    vi.advanceTimersByTime(5_000);
    expect(useTermStore.getState().waterBreakOpen).toBe(true);
  });

  it("stops entirely once torn down", () => {
    stop = startWaterReminder();
    stop();
    stop = undefined;
    advanceToSlot(10);
    expect(useTermStore.getState().waterBreakOpen).toBe(false);
  });

  it("re-arms for the following slot after a break completes", () => {
    stop = startWaterReminder();
    advanceToSlot(10);
    expect(useTermStore.getState().waterBreakOpen).toBe(true);

    // The dialog closing is what lets the next slot be armed.
    useTermStore.setState({ waterBreakOpen: false });
    advanceToSlot(11);
    expect(useTermStore.getState().waterBreakOpen).toBe(true);
  });

  it("schedules against the same slots the schedule arithmetic reports", () => {
    // Guards against the scheduler and the schedule drifting apart, which would show up as a break at the
    // wrong hour rather than as a failure.
    expect(nextWaterReminderAt(THURSDAY_9AM)!.getHours()).toBe(10);
  });
});
