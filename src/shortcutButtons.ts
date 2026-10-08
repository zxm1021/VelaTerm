//! Custom shortcut buttons shown in the middle of the title bar.
//!
//! Two scopes share one button shape. Global buttons live in `vlx-settings` and stay visible in every
//! project; per-project buttons are stored on the project row itself, so switching projects swaps them.
//! The two groups render together with a divider between them, matching the toolbar the reference
//! implementation (my-claude-ide) builds.

import { genId } from "./genId";
import { isVirtualProject, type Group, type Project, type Session } from "./types";

/** What a button does when clicked. */
export type ShortcutActionType = "url" | "app" | "bash";

export interface ShortcutButton {
  id: string;
  title: string;
  type: ShortcutActionType;
  /**
   * The action's target, read according to `type`: an http(s) URL, an absolute path to a `.app`, or a
   * shell command line.
   */
  value: string;
}

export const SHORTCUT_ACTION_TYPES: readonly ShortcutActionType[] = ["url", "app", "bash"];

/** Per-project buttons are capped; the global list is not, since it is shared by every project. */
export const MAX_PROJECT_SHORTCUTS = 5;

/** Longest title accepted, in characters. */
export const MAX_SHORTCUT_TITLE = 24;

function isActionType(v: unknown): v is ShortcutActionType {
  return v === "url" || v === "app" || v === "bash";
}

/**
 * A button with a valid shape, or null.
 *
 * Values arrive from persisted JSON that a user or an older build may have written, so every field is
 * checked rather than trusted: a button with no title or no target would render as an unclickable box,
 * and an unknown type would reach the runner and match no branch.
 */
function parseButton(raw: unknown): ShortcutButton | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.id !== "string" || !b.id) return null;
  if (typeof b.title !== "string" || !b.title.trim()) return null;
  if (!isActionType(b.type)) return null;
  if (typeof b.value !== "string" || !b.value.trim()) return null;
  return {
    id: b.id,
    title: b.title.trim().slice(0, MAX_SHORTCUT_TITLE),
    type: b.type,
    value: b.value.trim(),
  };
}

/**
 * Drop unusable buttons and duplicates, and enforce `max`.
 *
 * Duplicate IDs would make React reuse the wrong row when the list is reordered, so the first
 * occurrence wins and later ones are dropped. `max` applies after filtering, so an oversized list
 * keeps its first `max` usable entries rather than losing entries to junk that was removed anyway.
 */
export function sanitizeShortcutButtons(raw: unknown, max: number | null): ShortcutButton[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ShortcutButton[] = [];
  for (const entry of raw) {
    const button = parseButton(entry);
    if (!button || seen.has(button.id)) continue;
    seen.add(button.id);
    out.push(button);
  }
  return max === null ? out : out.slice(0, max);
}

/** Create a button with a fresh ID from the dialog's three fields. */
export function makeShortcutButton(title: string, type: ShortcutActionType, value: string): ShortcutButton {
  return { id: genId(), title: title.trim(), type, value: value.trim() };
}

/** Move the entry at `index` by `delta`, returning a new array; an out-of-range move is a no-op. */
export function moveShortcutButton(
  buttons: ShortcutButton[],
  index: number,
  delta: -1 | 1,
): ShortcutButton[] {
  const target = index + delta;
  if (index < 0 || index >= buttons.length || target < 0 || target >= buttons.length) return buttons;
  const next = [...buttons];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

/**
 * Read a project's stored buttons from the JSON string on its row.
 *
 * Anything unparseable reads as "no buttons of its own" rather than throwing: the column is written by
 * an older build or a hand-edited database as easily as by this one, and a project with a damaged
 * button list should still open.
 */
export function parseProjectShortcutButtons(raw: string | null | undefined): ShortcutButton[] {
  if (!raw) return [];
  try {
    return sanitizeShortcutButtons(JSON.parse(raw), MAX_PROJECT_SHORTCUTS);
  } catch {
    return [];
  }
}

/** Serialize buttons for the project row; an empty list stores null so the column stays clear. */
export function serializeProjectShortcutButtons(buttons: ShortcutButton[]): string | null {
  const clean = sanitizeShortcutButtons(buttons, MAX_PROJECT_SHORTCUTS);
  return clean.length ? JSON.stringify(clean) : null;
}

/** The project that owns a sidebar node, used to pick which project's buttons the toolbar shows. */
export interface ShortcutScope {
  projects: Project[];
  groups: Group[];
  sessions: Session[];
  activeSessionId: string | null;
  selection: { id: string; kind: string }[];
  inspectTarget: { id: string; kind: string } | null;
}

/**
 * Resolve which project's shortcut buttons belong in the toolbar.
 *
 * The sidebar selection leads, because that is what the user just clicked; the active tab is the
 * fallback, since a project's buttons should follow the terminal being worked in when nothing is
 * selected. A collection has no directory and no buttons of its own, so selecting one falls through
 * to the active tab rather than showing an unrelated project's buttons.
 */
export function resolveShortcutProjectId(state: ShortcutScope): string | null {
  // Only a single node is unambiguous; with several selected there is no one project to show.
  const node = state.selection.length === 1 ? state.selection[0] : (state.inspectTarget ?? null);
  const fromNode = node ? projectIdOfNode(state, node.id, node.kind) : null;
  if (fromNode) return fromNode;

  const active = state.activeSessionId
    ? state.sessions.find((s) => s.id === state.activeSessionId)
    : undefined;
  return active?.projectId ?? null;
}

/** The project a single node belongs to, or null for a collection or an unknown id. */
function projectIdOfNode(state: ShortcutScope, id: string, kind: string): string | null {
  switch (kind) {
    case "project": {
      const project = state.projects.find((p) => p.id === id);
      return project && !isVirtualProject(project) ? project.id : null;
    }
    case "group":
      return state.groups.find((g) => g.id === id)?.projectId ?? null;
    case "session":
      return state.sessions.find((s) => s.id === id)?.projectId ?? null;
    default:
      return null;
  }
}
