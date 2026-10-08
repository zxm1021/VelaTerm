//! The title bar's custom shortcut buttons.
//!
//! Global buttons stay visible in every project; the selected project's own buttons follow it. The two
//! groups render as one row with a divider at the boundary, so the row reads as "these always, these
//! here" without a label. Running a button reports its failure in place rather than in a dialog, since
//! the button that failed is right there and a modal would cover the terminal the user is working in.

import { useEffect, useRef, useState } from "react";
import Icons from "../../components/Icons";
import { useT } from "../../i18n";
import { ShortcutRunError, runShortcutButton } from "../../shortcutRunner";
import type { ShortcutButton } from "../../shortcutButtons";

/** How long a failure stays under the button before it clears itself. */
const ERROR_TIMEOUT_MS = 8000;

export function ShortcutButtons({
  globals,
  projectButtons,
  rootPath,
  onEdit,
}: {
  globals: ShortcutButton[];
  projectButtons: ShortcutButton[];
  /** Directory the project's buttons run in; null when no project is selected. */
  rootPath: string | null;
  onEdit: () => void;
}) {
  const t = useT();
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  // A failure message is transient: it belongs to the click that caused it, and leaving it up would
  // read as a permanent state of the button.
  useEffect(() => {
    if (!error) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setError(null), ERROR_TIMEOUT_MS);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [error]);

  const click = async (button: ShortcutButton) => {
    setError(null);
    setRunning(button.id);
    try {
      await runShortcutButton(button, rootPath);
    } catch (e) {
      const message = e instanceof ShortcutRunError ? e.message : String(e);
      setError({ id: button.id, message });
    } finally {
      setRunning(null);
    }
  };

  // The divider marks where the always-on buttons end and the current project's begin. It appears only
  // when both groups are non-empty, since a leading or trailing rule would mark nothing.
  const showDivider = globals.length > 0 && projectButtons.length > 0;

  return (
    <div className="tb-shortcuts">
      {globals.map((button) => (
        <ShortcutButtonView
          key={button.id}
          button={button}
          running={running === button.id}
          failed={error?.id === button.id}
          onClick={() => void click(button)}
        />
      ))}
      {showDivider && <span className="tb-shortcuts-sep" />}
      {projectButtons.map((button) => (
        <ShortcutButtonView
          key={button.id}
          button={button}
          running={running === button.id}
          failed={error?.id === button.id}
          onClick={() => void click(button)}
        />
      ))}
      <button
        className="tb-shortcuts-edit"
        title={t("shortcut.edit")}
        aria-label={t("shortcut.edit")}
        onClick={onEdit}
      >
        <Icons.plus size={13} />
      </button>
      {error && (
        <span className="tb-shortcuts-error" role="alert" title={error.message}>
          {error.message}
        </span>
      )}
    </div>
  );
}

/**
 * One button. The label is text rather than an icon: a shortcut button names a destination the user
 * chose, and no icon set would cover "Gerrit" and "the release checklist" alike.
 */
function ShortcutButtonView({
  button,
  running,
  failed,
  onClick,
}: {
  button: ShortcutButton;
  running: boolean;
  failed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`tb-shortcuts-btn${failed ? " failed" : ""}`}
      title={button.value}
      disabled={running}
      onClick={onClick}
    >
      {running ? <span className="tb-shortcuts-spin" /> : actionGlyph(button.type)}
      <span className="tb-shortcuts-label">{button.title}</span>
    </button>
  );
}

/** A small leading glyph so the three action kinds are distinguishable at a glance. */
function actionGlyph(type: ShortcutButton["type"]) {
  if (type === "url") return <Icons.globe size={12} />;
  if (type === "app") return <Icons.grid size={12} />;
  return <Icons.terminal size={12} />;
}
