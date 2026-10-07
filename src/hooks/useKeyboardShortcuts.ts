//! Global keyboard shortcuts.
//! - Cmd/Ctrl+1–9 focuses the numbered open tab and is fixed to tab positions.
//! - Cmd/Ctrl++/- changes terminal font size and Cmd/Ctrl+0 resets it (Shift+Cmd+0 where mod is Cmd,
//!   because bare Cmd+0 toggles the info panel); fixed to those semantics.
//! - Cmd+K clears the active terminal on macOS and is fixed to that key; elsewhere Ctrl+K stays the
//!   shell's kill-line key.
//! - Cmd+B, Cmd+0 and Shift+Cmd+Enter show or hide the sidebar, the info panel, and both at once.
//!   Cmd-only on every platform so no bare-Ctrl shell key is taken; text fields and editors keep the
//!   chords they own (Cmd+B is bold in the markdown editor).
//! - Settings may remap temporary-terminal creation, desktop browser tabs, pane/tab closure, both
//!   split directions, terminal/global search, terminal selection, and document save. Defaults live in shortcutRegistry
//!   and overrides in vlx-settings. Remapping changes only triggers, not contextual behavior.
//!
//! Platform defaults use Cmd on macOS and Ctrl+Alt on Windows/Linux (see DEFAULT_BINDINGS). Bare Ctrl
//! letters are critical shell keys, Ctrl+Shift may be consumed by IMEs, and Alt is terminal Meta.
//! usePtySession blocks these Ctrl+Alt combinations from xterm so it cannot emit stray Escape bytes.
//! This listener runs in document capture phase before xterm/editors. The shortcut recorder runs even
//! earlier on window capture and stops propagation while recording.
//! Plain-browser clients (URL remote access) use Ctrl+Alt for most actions. macOS browser splits
//! use Cmd+D / Cmd+Shift+D, cancelling the browser default when an active session can split.

/** Custom document-save event name; detail is the document-tab ID and DocView listens for it. */
export const DOC_SAVE_EVENT = "vlx:doc-save";
/** Custom PDF-export event name; detail is the document-tab ID and DocView listens for it. */
export const DOC_EXPORT_PDF_EVENT = "vlx:doc-export-pdf";

import { useEffect } from "react";
import { isTauri } from "../ipc/transport";
import { isShareSurface } from "../ipc/shareBase";
import { env } from "../platform";
import { useTermStore } from "../store/termStore";
import { DEFAULT_TERMINAL_FONT_SIZE } from "../theme";
import { activeAgentLocation, agentPickerUrl, navigateAgentPicker, newAgentPickerRoute, readAgentPickerRoute } from "../layout/NewAgentSession/navigation";
import { clearTerminal, focusTerminal, getTerminal, selectAll as selectAllTerminalContent } from "../terminal/registry";
import {
  DEFAULT_BINDINGS,
  IS_MAC,
  IS_PLAIN_BROWSER,
  MOD_IS_CMD,
  hasMod,
  matchCombo,
  type ShortcutAction,
} from "./shortcutRegistry";

export function useKeyboardShortcuts() {
  useEffect(() => {
    // Zero-based Cmd+1–9 tab index, with layout/IME-independent e.code fallback; otherwise -1.
    const digitIndex = (e: KeyboardEvent) => {
      if (e.key >= "1" && e.key <= "9") return Number(e.key) - 1;
      if (/^Digit[1-9]$/.test(e.code)) return Number(e.code.slice(5)) - 1;
      return -1;
    };

    // The active tab's session ID when it is a session tab, or null for document, browser, and task
    // tabs. Shared by the fixed shortcuts that must act on a terminal only.
    const activeSessionTabId = (): string | null => {
      const { activeSessionId, activeTabId, docTabs, browserTabs, taskTabs } = useTermStore.getState();
      if (!activeSessionId) return null;
      if (activeTabId && (docTabs[activeTabId] || browserTabs[activeTabId] || taskTabs[activeTabId])) return null;
      return activeSessionId;
    };

    // Whether the event targets a place where the user is typing or formatting text. Focused terminals
    // are excluded: their hidden helper textarea is a textarea too, and the panel toggles must keep
    // working from the terminal — the most common place to press them. Used only by the panel toggles,
    // whose Cmd+B collides with the markdown editor's Mod-b (bold) on a document tab.
    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const { activeSessionId } = useTermStore.getState();
      const terminal = activeSessionId ? getTerminal(activeSessionId) : undefined;
      if (terminal?.element?.contains(target)) return false;
      // Walk up as well as test the node itself: a rich-text editor marks only its root as editable, so
      // a keystroke inside it targets a descendant. The attribute selector also covers environments that
      // do not implement isContentEditable.
      return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable ||
        !!target.closest('[contenteditable=""], [contenteditable="true"]')
      );
    };

    const handler = (e: KeyboardEvent) => {
      // ── Fixed shortcut 1: Cmd+1–9 selects the nth tab ──
      const tabIdx = digitIndex(e);
      // Cmd/Ctrl+Alt+digit is left to editors, where the document editor maps it to heading levels.
      if (hasMod(e) && !e.altKey && tabIdx >= 0) {
        const { openTabs, setActiveTab } = useTermStore.getState();
        if (tabIdx < openTabs.length) {
          e.preventDefault();
          setActiveTab(openTabs[tabIdx]);
        }
        return;
      }

      // ── Fixed shortcut 2: Cmd++/- and the font-size reset ──
      // Apply only to active session tabs; document/browser tabs retain their own handling.
      //
      // Reset moved to Shift+Cmd+0 where mod is Cmd, because bare Cmd+0 now toggles the info panel (see
      // below) and the larger/smaller/reset triple stays on one key row. Everywhere else bare mod+0
      // keeps resetting, so Ctrl+0 users lose nothing. Shifted +/- are the shifted faces of the same
      // physical keys and stay unclaimed, so this branch falls through rather than consuming them.
      if (hasMod(e)) {
        const isPlus = e.key === "+" || e.key === "=" || e.code === "Equal";
        const isMinus = e.key === "-" || e.key === "_" || e.code === "Minus";
        const isZero = e.key === "0" || e.key === ")" || e.code === "Digit0";
        const adjusts = (isPlus || isMinus) && !e.shiftKey;
        const resets = isZero && e.shiftKey === MOD_IS_CMD;
        if (adjusts || resets) {
          const { termFontSize, setTermFontSize } = useTermStore.getState();
          if (activeSessionTabId()) {
            e.preventDefault();
            if (resets) setTermFontSize(DEFAULT_TERMINAL_FONT_SIZE);
            else setTermFontSize(termFontSize + (isPlus ? 0.5 : -0.5));
          }
          return;
        }
      }

      // ── Fixed shortcut 3: Cmd+K clears the active terminal ──
      // macOS only: elsewhere Ctrl+K is the shell's kill-line key and must reach the PTY. A bare Cmd+K
      // carries no PTY input, so clearing is safe; focus returns to the terminal afterwards. The
      // terminal must exist, which also keeps a conversation view (no xterm instance) untouched.
      //
      // This branch must return WITHOUT cancelling the event when no terminal qualifies: the markdown
      // editor binds Mod-k to insert a link (pmTypora.ts), and a doc tab is exactly the case where this
      // guard fails. Cancelling here would silently break that command.
      if (IS_MAC && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.code === "KeyK") {
        if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || e.repeat) return;
        const id = activeSessionTabId();
        if (id && getTerminal(id)) {
          e.preventDefault();
          clearTerminal(id);
          focusTerminal(id);
        }
        return;
      }

      // ── Fixed shortcut 4: Cmd+B / Cmd+0 / Shift+Cmd+Enter toggle the side panels ──
      // Cmd+B and Cmd+0 show or hide the sidebar and the info panel, matching the title-bar buttons and
      // the panel toggles VS Code uses; Shift+Cmd+Enter drives both sides as one "clear the chrome" key
      // rather than two independent flips.
      //
      // These chords are Cmd-only on every platform: Cmd is free on macOS, while the fixed shortcuts
      // elsewhere stay on Ctrl+Alt so no shell key is stolen (bare Ctrl+B is the shell's backward-char,
      // Ctrl+0 a terminal reset, and Alt alone is terminal Meta). Plain-browser clients keep the native
      // browser behavior, where Cmd+B and Cmd+0 are not ours to take.
      //
      // Checked after the font-size branch above, which claims Shift+Cmd+0 first and leaves bare Cmd+0
      // to fall through to here.
      if (!IS_PLAIN_BROWSER && IS_MAC && e.metaKey && !e.ctrlKey && !e.altKey) {
        const isLeftPanel = !e.shiftKey && e.code === "KeyB";
        const isRightPanel = !e.shiftKey && (e.code === "Digit0" || e.key === ")" || e.key === "0");
        const isBothPanels = e.shiftKey && e.code === "Enter";
        if (isLeftPanel || isRightPanel || isBothPanels) {
          // Never steal a chord from a text field or a rich-text editor. On a document tab Cmd+B is
          // bold in the markdown editor, and the panel toggles must not swallow it.
          if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || e.repeat) return;
          if (isTypingTarget(e.target)) return;
          e.preventDefault();
          const { toggleLeft, toggleRight, toggleBothPanels } = useTermStore.getState();
          if (isLeftPanel) toggleLeft();
          else if (isRightPanel) toggleRight();
          else toggleBothPanels();
          return;
        }
      }

      // ── Remappable actions: exactly match the user override or default binding ──
      const { shortcutOverrides } = useTermStore.getState();
      const sc = (a: ShortcutAction) => shortcutOverrides[a] || DEFAULT_BINDINGS[a];

      // A shortcut saved before this action existed keeps its trigger, even if it now overlaps our default.
      const existingOverride = Object.entries(shortcutOverrides).some(([action, combo]) =>
        action !== "newAgentSession" && action in DEFAULT_BINDINGS && !!combo && matchCombo(e, combo));
      if (!existingOverride && matchCombo(e, sc("newAgentSession"))) {
        if (isShareSurface || e.defaultPrevented || e.isComposing || e.keyCode === 229 || e.repeat) return;
        e.preventDefault();
        e.stopPropagation();
        if (!readAgentPickerRoute()) navigateAgentPicker(agentPickerUrl(newAgentPickerRoute(activeAgentLocation(useTermStore.getState()))));
        return;
      }

      if (matchCombo(e, sc("openProject"))) {
        e.preventDefault();
        if(!isShareSurface)void useTermStore.getState().importProject();
        return;
      }

      if (matchCombo(e, sc("newTab"))) {
        e.preventDefault();
        if(!isShareSurface)useTermStore.getState().newScratchTab();
        return;
      }

      // New browser tabs are available only in Tauri/Electron desktop shells.
      if (matchCombo(e, sc("newBrowserTab"))) {
        if (isTauri || env.isElectron) {
          e.preventDefault();
          useTermStore.getState().openBrowserTab();
        }
        return;
      }

      if (matchCombo(e, sc("closePane"))) {
        const { activeTabId, docTabs, browserTabs, taskTabs, requestCloseDocTab, closeTab, activeSessionId, closePane } =
          useTermStore.getState();
        // Document tabs close directly when clean or route dirty state to DocView confirmation.
        if (activeTabId && docTabs[activeTabId]) {
          e.preventDefault();
          requestCloseDocTab(activeTabId);
          return;
        }
        // Browser and task tabs close directly: a browser tab has no unsaved state (unmounting destroys the
        // child WebView), and a task tab only shows what the agent reports.
        if (activeTabId && (browserTabs[activeTabId] || taskTabs[activeTabId])) {
          e.preventDefault();
          closeTab(activeTabId);
          return;
        }
        if (activeSessionId) {
          e.preventDefault();
          // Close the current pane, or the tab when it is the final pane.
          closePane();
        }
        return;
      }

      if (matchCombo(e, sc("saveDoc"))) {
        // Intercept save only for an active document tab.
        const { activeTabId, docTabs } = useTermStore.getState();
        if (activeTabId && docTabs[activeTabId]) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent(DOC_SAVE_EVENT, { detail: activeTabId }));
        }
        return;
      }

      // Check vertical split before horizontal split because custom bindings may overlap by modifiers.
      if (matchCombo(e, sc("splitDown"))) {
        const { activeSessionId, splitNew } = useTermStore.getState();
        if (activeSessionId) {
          e.preventDefault();
          void splitNew("vertical", "shortcut");
        }
        return;
      }
      if (matchCombo(e, sc("splitRight"))) {
        const { activeSessionId, splitNew } = useTermStore.getState();
        if (activeSessionId) {
          e.preventDefault();
          void splitNew("horizontal", "shortcut");
        }
        return;
      }

      // Check global search before terminal search for the same possible modifier overlap.
      if (matchCombo(e, sc("globalSearch"))) {
        e.preventDefault();
        useTermStore.getState().setGlobalSearchOpen(true);
        return;
      }
      if (matchCombo(e, sc("search"))) {
        const { activeTabId, docTabs, activeSessionId, openSearch } = useTermStore.getState();
        // DocView owns document-tab search, so do not open terminal search here.
        if (activeTabId && docTabs[activeTabId]) return;
        if (activeSessionId) {
          e.preventDefault();
          openSearch();
        }
        return;
      }

      // Only the focused terminal owns this action; inputs, conversation views and overlays keep their
      // native selection. Stop handled keys before xterm can turn a rebound Ctrl+A into PTY input.
      if (matchCombo(e, sc("selectAllTerminal"))) {
        if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
        const { activeSessionId, activeTabId, docTabs, browserTabs, taskTabs } = useTermStore.getState();
        const onSessionTab =
          !!activeSessionId &&
          !(activeTabId && (docTabs[activeTabId] || browserTabs[activeTabId] || taskTabs[activeTabId]));
        if (!onSessionTab) return;
        const terminal = getTerminal(activeSessionId!);
        if (!(e.target instanceof Node) || !terminal?.element?.contains(e.target)
          || !terminal.element.contains(document.activeElement)) return;
        e.preventDefault();
        e.stopPropagation();
        selectAllTerminalContent(activeSessionId!);
      }
    };

    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, []);
}
