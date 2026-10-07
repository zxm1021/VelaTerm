//! Coverage for the panel toggles behind Cmd+B, Cmd+0 and Shift+Cmd+Enter. The combined toggle has to
//! treat the two sides as one piece of chrome: flipping each side independently would make alternate
//! presses show a different side instead of bringing both back.

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

import { useTermStore } from "./termStore";

const panels = () => {
  const { leftCollapsed, rightCollapsed } = useTermStore.getState();
  return { leftCollapsed, rightCollapsed };
};

beforeEach(() => {
  useTermStore.setState({ leftCollapsed: false, rightCollapsed: false });
});

describe("toggleBothPanels", () => {
  it("closes both sides when both are open", () => {
    useTermStore.getState().toggleBothPanels();
    expect(panels()).toEqual({ leftCollapsed: true, rightCollapsed: true });
  });

  it("closes the open side when only one is showing", () => {
    useTermStore.setState({ leftCollapsed: true, rightCollapsed: false });
    useTermStore.getState().toggleBothPanels();
    expect(panels()).toEqual({ leftCollapsed: true, rightCollapsed: true });
  });

  it("brings both sides back once they are both hidden", () => {
    useTermStore.setState({ leftCollapsed: true, rightCollapsed: true });
    useTermStore.getState().toggleBothPanels();
    expect(panels()).toEqual({ leftCollapsed: false, rightCollapsed: false });
  });

  it("round-trips without drifting into a one-sided layout", () => {
    const toggle = () => useTermStore.getState().toggleBothPanels();
    toggle();
    toggle();
    expect(panels()).toEqual({ leftCollapsed: false, rightCollapsed: false });
    toggle();
    expect(panels()).toEqual({ leftCollapsed: true, rightCollapsed: true });
  });
});

describe("single-side toggles", () => {
  it("leaves the other side alone", () => {
    useTermStore.getState().toggleLeft();
    expect(panels()).toEqual({ leftCollapsed: true, rightCollapsed: false });
    useTermStore.getState().toggleRight();
    expect(panels()).toEqual({ leftCollapsed: true, rightCollapsed: true });
  });
});
