//! Coverage for the forced hydration break dialog.
//!
//! The whole promise of this dialog is that it cannot be dismissed, so these tests attack it the way a
//! user would: Escape, a click on the backdrop, and the keys the global shortcut listener would
//! otherwise act on. The countdown is checked with fake timers so the 20 seconds cost nothing.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../i18n", () => ({ useT: () => (key: string) => key, t: (key: string) => key }));
// The store's module-level initializer reads the tree and shell list; stub the transport so importing it
// stays inert, the same way the other store-backed component tests do.
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
import { WaterBreakModal } from "./WaterBreakModal";
import { useTermStore } from "../store/termStore";

const openBreak = () => act(() => useTermStore.setState({ waterBreakOpen: true }));

beforeEach(() => {
  vi.useFakeTimers();
  useTermStore.setState({ waterBreakOpen: false });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("WaterBreakModal", () => {
  it("renders nothing while the break is not open", () => {
    render(<WaterBreakModal />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("counts down and closes itself when the countdown ends", () => {
    render(<WaterBreakModal />);
    openBreak();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("20")).toBeTruthy();

    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByText("15")).toBeTruthy();

    act(() => vi.advanceTimersByTime(15_000));
    expect(useTermStore.getState().waterBreakOpen).toBe(false);
  });

  it("does not close on Escape", () => {
    render(<WaterBreakModal />);
    openBreak();
    const card = screen.getByRole("alertdialog");
    fireEvent.keyDown(card, { key: "Escape" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useTermStore.getState().waterBreakOpen).toBe(true);
  });

  it("does not close when the backdrop is clicked", () => {
    render(<WaterBreakModal />);
    openBreak();
    // The backdrop is the alertdialog's parent; clicking it is the gesture every other dialog dismisses on.
    const backdrop = screen.getByRole("alertdialog").parentElement!;
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(useTermStore.getState().waterBreakOpen).toBe(true);
  });

  it("survives keys the global shortcuts would otherwise act on", () => {
    render(<WaterBreakModal />);
    openBreak();
    const card = screen.getByRole("alertdialog");
    for (const key of ["Enter", "Tab", "1", "w"]) {
      fireEvent.keyDown(card, { key, metaKey: true });
    }
    expect(useTermStore.getState().waterBreakOpen).toBe(true);
  });

  it("pulls focus back when it escapes the card", () => {
    render(<WaterBreakModal />);
    openBreak();
    const card = screen.getByRole("alertdialog");
    expect(document.activeElement).toBe(card);

    // Focus landing outside the card is how the terminal behind it would start receiving keystrokes again.
    const outside = document.createElement("input");
    document.body.appendChild(outside);
    outside.focus();
    fireEvent.focusIn(outside);
    expect(document.activeElement).toBe(card);
    outside.remove();
  });
});
