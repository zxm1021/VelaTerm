//! Side-panel shortcuts on the desktop macOS shell, where mod is Cmd and the chords are live.
//!
//! Kept apart from useKeyboardShortcuts.test.tsx, which runs as a plain-browser client: there the panel
//! chords are deliberately inert (Cmd+B and Cmd+0 belong to the browser), so the same file cannot cover
//! both environments. Here the platform mock reports a desktop shell so IS_PLAIN_BROWSER is false.

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  activeSessionId: "session-1" as string | null,
  activeTabId: "session-1" as string | null,
  docTabs: {} as Record<string, unknown>,
  browserTabs: {} as Record<string, unknown>,
  taskTabs: {} as Record<string, unknown>,
  shortcutOverrides: {} as Record<string, string>,
  termFontSize: 18,
  toggleLeft: vi.fn(),
  toggleRight: vi.fn(),
  toggleBothPanels: vi.fn(),
  setTermFontSize: vi.fn(),
}));

const terminalRegistry = vi.hoisted(() => ({
  getTerminal: vi.fn(),
  clearTerminal: vi.fn(),
  focusTerminal: vi.fn(),
  selectAll: vi.fn(),
}));

vi.mock("../terminal/registry", () => terminalRegistry);
// A desktop shell on macOS: not a plain browser, so Cmd is mod and the panel chords are claimed.
vi.mock("../platform", () => ({ env: { isBrowser: false, isRemoteWindow: false } }));
vi.mock("../ipc/transport", () => ({ isTauri: true }));
vi.mock("../store/termStore", () => ({ useTermStore: { getState: () => state } }));

beforeEach(async () => {
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  vi.resetModules();
  state.activeSessionId = "session-1";
  state.activeTabId = "session-1";
  state.docTabs = {};
  state.browserTabs = {};
  state.taskTabs = {};
  state.shortcutOverrides = {};
  state.termFontSize = 18;
  for (const fn of [state.toggleLeft, state.toggleRight, state.toggleBothPanels, state.setTermFontSize]) {
    fn.mockReset();
  }
  terminalRegistry.getTerminal.mockReset();
  const { useKeyboardShortcuts } = await import("./useKeyboardShortcuts");
  renderHook(() => useKeyboardShortcuts());
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function press(key: string, code: string, modifiers: KeyboardEventInit, target: HTMLElement = document.body) {
  const event = new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true, ...modifiers });
  target.dispatchEvent(event);
  return event;
}

it("toggles each side panel on its own chord", () => {
  expect(press("b", "KeyB", { metaKey: true }).defaultPrevented).toBe(true);
  expect(state.toggleLeft).toHaveBeenCalledOnce();
  expect(state.toggleRight).not.toHaveBeenCalled();

  expect(press("0", "Digit0", { metaKey: true }).defaultPrevented).toBe(true);
  expect(state.toggleRight).toHaveBeenCalledOnce();
  expect(state.toggleBothPanels).not.toHaveBeenCalled();
});

it("toggles both panels together on Shift+Cmd+Enter", () => {
  expect(press("Enter", "Enter", { metaKey: true, shiftKey: true }).defaultPrevented).toBe(true);
  expect(state.toggleBothPanels).toHaveBeenCalledOnce();
  expect(state.toggleLeft).not.toHaveBeenCalled();
  expect(state.toggleRight).not.toHaveBeenCalled();
});

it("moves the font-size reset to Shift+Cmd+0 so bare Cmd+0 can toggle the panel", () => {
  // Bare Cmd+0 belongs to the panel toggle; the reset must not also fire.
  press("0", "Digit0", { metaKey: true });
  expect(state.setTermFontSize).not.toHaveBeenCalled();
  expect(state.toggleRight).toHaveBeenCalledOnce();
  state.toggleRight.mockClear();

  expect(press("0", "Digit0", { metaKey: true, shiftKey: true }).defaultPrevented).toBe(true);
  expect(state.setTermFontSize).toHaveBeenCalledExactlyOnceWith(18);
  expect(state.toggleRight).not.toHaveBeenCalled();
});

it("leaves Cmd+B to the editor when a text field has focus", () => {
  // The markdown editor binds Mod-b to bold; the panel toggle must not swallow it.
  const editor = document.createElement("div");
  editor.setAttribute("contenteditable", "true");
  editor.tabIndex = 0;
  document.body.append(editor);
  editor.focus();
  expect(press("b", "KeyB", { metaKey: true }, editor).defaultPrevented).toBe(false);
  expect(state.toggleLeft).not.toHaveBeenCalled();

  const field = document.createElement("input");
  document.body.append(field);
  field.focus();
  expect(press("0", "Digit0", { metaKey: true }, field).defaultPrevented).toBe(false);
  expect(state.toggleRight).not.toHaveBeenCalled();
});

it("still toggles from the terminal, whose helper textarea is a text field", () => {
  const element = document.createElement("div");
  const textarea = document.createElement("textarea");
  element.append(textarea);
  document.body.append(element);
  terminalRegistry.getTerminal.mockReturnValue({ element });
  textarea.focus();
  expect(press("b", "KeyB", { metaKey: true }, textarea).defaultPrevented).toBe(true);
  expect(state.toggleLeft).toHaveBeenCalledOnce();
});

it("ignores IME composition and repeats", () => {
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }]) {
    expect(press("b", "KeyB", { metaKey: true, ...extra }).defaultPrevented).toBe(false);
  }
  expect(state.toggleLeft).not.toHaveBeenCalled();
});

it("does not claim the chords while a modifier the shell needs is held", () => {
  expect(press("b", "KeyB", { ctrlKey: true }).defaultPrevented).toBe(false);
  expect(press("b", "KeyB", { metaKey: true, altKey: true }).defaultPrevented).toBe(false);
  expect(press("Enter", "Enter", { metaKey: true }).defaultPrevented).toBe(false);
  expect(state.toggleLeft).not.toHaveBeenCalled();
  expect(state.toggleBothPanels).not.toHaveBeenCalled();
});
