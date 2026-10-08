//! Editor for the title bar's shortcut buttons.
//!
//! One dialog serves both scopes, because the two lists are the same shape and the user is usually
//! moving a button from one to the other: a segmented control picks the scope being edited, and saving
//! writes only that scope. The reference implementation (my-claude-ide's `ProjectShortcutEditorView`)
//! works the same way.

import { useState, type CSSProperties } from "react";
import { Backdrop } from "../../components/Backdrop";
import Icons from "../../components/Icons";
import Select from "../../components/Select";
import { useT } from "../../i18n";
import {
  MAX_PROJECT_SHORTCUTS,
  makeShortcutButton,
  moveShortcutButton,
  SHORTCUT_ACTION_TYPES,
  type ShortcutActionType,
  type ShortcutButton,
} from "../../shortcutButtons";

type Scope = "global" | "project";

/** Placeholder per action type, so the field shows the shape of the value it wants. */
function valuePlaceholderKey(type: ShortcutActionType) {
  switch (type) {
    case "url":
      return "shortcut.valueUrl" as const;
    case "app":
      return "shortcut.valueApp" as const;
    case "bash":
      return "shortcut.valueBash" as const;
  }
}

function typeLabelKey(type: ShortcutActionType) {
  switch (type) {
    case "url":
      return "shortcut.typeUrl" as const;
    case "app":
      return "shortcut.typeApp" as const;
    case "bash":
      return "shortcut.typeBash" as const;
  }
}

const card: CSSProperties = {
  width: 560,
  maxWidth: "calc(100vw - 32px)",
  maxHeight: "calc(100vh - 64px)",
  display: "flex",
  flexDirection: "column",
  background: "var(--bg-2)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--r-md)",
  boxShadow: "var(--shadow)",
  overflow: "hidden",
};

const iconBtn: CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 24,
  height: 24,
  flex: "none",
  border: "none",
  borderRadius: "var(--r-sm)",
  background: "none",
  color: "var(--text-dim)",
  cursor: "pointer",
};

const row: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 8px",
  background: "var(--bg-1)",
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
};

/**
 * Edit one scope's buttons.
 *
 * `projectName` being set is what turns on the scope switcher: without a project there is nowhere for
 * the second list to be saved, so the toolbar entry opens the global list alone.
 */
export function ShortcutButtonsEditor({
  globalButtons,
  projectButtons,
  projectName,
  onSaveGlobal,
  onSaveProject,
  onClose,
}: {
  globalButtons: ShortcutButton[];
  projectButtons: ShortcutButton[];
  /** Name of the selected project, or null when only the global list can be edited. */
  projectName: string | null;
  onSaveGlobal: (buttons: ShortcutButton[]) => void;
  onSaveProject: (buttons: ShortcutButton[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [scope, setScope] = useState<Scope>(projectName ? "project" : "global");
  const [globals, setGlobals] = useState(globalButtons);
  const [project, setProject] = useState(projectButtons);

  const editingGlobal = scope === "global";
  const buttons = editingGlobal ? globals : project;
  const setButtons = editingGlobal ? setGlobals : setProject;
  const max = editingGlobal ? null : MAX_PROJECT_SHORTCUTS;
  const atLimit = max !== null && buttons.length >= max;

  const add = () => {
    // A new button starts as a URL because that is the common case and the field is immediately valid
    // enough to edit; the type can be switched on the row.
    setButtons([...buttons, makeShortcutButton(t("shortcut.typeUrl"), "url", "")]);
  };

  const update = (index: number, patch: Partial<ShortcutButton>) => {
    setButtons(buttons.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  };

  const save = () => {
    // An empty title or value would render as a button that cannot be clicked usefully; drop those
    // rather than saving them, which is also what the persisted-value sanitizer would do on read.
    const cleaned = buttons.filter((b) => b.title.trim() && b.value.trim());
    if (editingGlobal) onSaveGlobal(cleaned);
    else onSaveProject(cleaned);
    onClose();
  };

  return (
    <Backdrop onClose={onClose}>
      <div style={card} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
            {projectName ? t("shortcut.editProject", projectName) : t("shortcut.edit")}
          </div>
          {projectName && (
            <div style={{ display: "flex", gap: 4, marginTop: 10 }}>
              <ScopeTab
                label={t("shortcut.scopeProject")}
                active={!editingGlobal}
                onClick={() => setScope("project")}
              />
              <ScopeTab
                label={t("shortcut.scopeGlobal")}
                active={editingGlobal}
                onClick={() => setScope("global")}
              />
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--text-dim)" }}>
            {editingGlobal ? t("shortcut.globalHint") : t("shortcut.projectHint")}
            {max !== null ? ` ${t("shortcut.limitProject", max)}` : ""}
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "10px 16px" }}>
          {buttons.length === 0 ? (
            <div style={{ padding: "18px 0", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>
              {editingGlobal ? t("shortcut.emptyGlobal") : t("shortcut.emptyProject")}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {buttons.map((button, index) => (
                <div key={button.id} style={row}>
                  <input
                    className="vlx-input"
                    style={{ flex: "none", width: 110 }}
                    value={button.title}
                    placeholder={t("shortcut.title")}
                    onChange={(e) => update(index, { title: e.target.value })}
                  />
                  <Select
                    size="sm"
                    width={92}
                    value={button.type}
                    options={SHORTCUT_ACTION_TYPES.map((type) => ({
                      value: type,
                      label: t(typeLabelKey(type)),
                    }))}
                    onChange={(type: ShortcutActionType) => update(index, { type })}
                  />
                  <input
                    className="vlx-input"
                    style={{ flex: 1, minWidth: 0 }}
                    value={button.value}
                    placeholder={t(valuePlaceholderKey(button.type))}
                    onChange={(e) => update(index, { value: e.target.value })}
                  />
                  <button
                    style={{ ...iconBtn, opacity: index === 0 ? 0.35 : 1 }}
                    title={t("shortcut.moveUp")}
                    disabled={index === 0}
                    onClick={() => setButtons(moveShortcutButton(buttons, index, -1))}
                  >
                    <Icons.chevUp size={14} />
                  </button>
                  <button
                    style={{ ...iconBtn, opacity: index === buttons.length - 1 ? 0.35 : 1 }}
                    title={t("shortcut.moveDown")}
                    disabled={index === buttons.length - 1}
                    onClick={() => setButtons(moveShortcutButton(buttons, index, 1))}
                  >
                    <Icons.chevDown size={14} />
                  </button>
                  <button
                    style={iconBtn}
                    title={t("shortcut.remove")}
                    onClick={() => setButtons(buttons.filter((_, i) => i !== index))}
                  >
                    <Icons.trash size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            className="vlx-btn"
            style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}
            disabled={atLimit}
            onClick={add}
          >
            <Icons.plus size={13} />
            {t("shortcut.add")}
          </button>

          {!editingGlobal && project.some((b) => b.type === "bash") && (
            <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--text-dim)" }}>
              {t("shortcut.bashWarn")}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 16px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <span style={{ flex: 1 }} />
          <button className="vlx-btn" onClick={onClose}>
            {t("shortcut.cancel")}
          </button>
          <button className="vlx-btn vlx-btn-primary" onClick={save}>
            {t("shortcut.save")}
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

/** One segment of the scope switcher, matching the title bar's `.tb-seg` look. */
function ScopeTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        height: 24,
        padding: "0 10px",
        fontSize: 12,
        border: "1px solid var(--border)",
        borderRadius: "var(--r-sm)",
        background: active ? "var(--accent-soft)" : "transparent",
        color: active ? "var(--accent)" : "var(--text-dim)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
