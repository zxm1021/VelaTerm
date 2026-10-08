//! Runs a shortcut button's action.
//!
//! Each action type goes through the capability that already exists for it: URLs and `.app` bundles
//! through the platform opener, shell commands through the backend command that runs them in the
//! project directory. Nothing here decides policy — the button editor has already validated the
//! values, and this module's job is to report a failure the user can act on.

import { platform } from "./platform";
import { runShortcutCommand } from "./ipc/tree";
import { recordRequestError } from "./ipc/reqLog";
import { t } from "./i18n";
import type { ShortcutButton } from "./shortcutButtons";

/** A failure worth showing the user, already localized. */
export class ShortcutRunError extends Error {}

/**
 * Run one button against `rootPath`, the directory the owning project lives in.
 *
 * Throws a `ShortcutRunError` whose message is ready to display. The caller shows it next to the
 * button; a button whose target has been uninstalled or whose command fails must not fail silently,
 * because the user clicked it and is waiting for something to happen.
 */
export async function runShortcutButton(button: ShortcutButton, rootPath: string | null): Promise<void> {
  console.info(`[shortcut] run "${button.title}" type=${button.type}`);
  switch (button.type) {
    case "url":
      await runUrl(button);
      return;
    case "app":
      await runApp(button, rootPath);
      return;
    case "bash":
      await runBash(button, rootPath);
      return;
  }
}

/** Open an http(s) URL in the system browser. */
async function runUrl(button: ShortcutButton): Promise<void> {
  // Only http(s): `openExternal` would happily launch any registered scheme, and a shortcut button is
  // not a place to be starting `file://` or a custom protocol handler by accident.
  let url: URL;
  try {
    url = new URL(button.value);
  } catch {
    throw new ShortcutRunError(t("shortcut.errBadUrl"));
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ShortcutRunError(t("shortcut.errBadUrl"));
  }
  try {
    await platform.opener.openExternal(url.href);
  } catch (error) {
    recordRequestError("shortcut_open_url", error);
    throw new ShortcutRunError(t("shortcut.errOpenUrl", button.title));
  }
}

/**
 * Open the project directory with the configured application.
 *
 * `openPath` hands the path to the OS, which resolves it through the bundle's declared document types;
 * that is what makes "open this repo in SourceTree" work without the app knowing anything about it. A
 * moved or uninstalled bundle surfaces as an OS error, which is reported against the button.
 */
async function runApp(button: ShortcutButton, rootPath: string | null): Promise<void> {
  if (!rootPath) throw new ShortcutRunError(t("shortcut.errNoProject"));
  try {
    await platform.opener.openPath(button.value);
  } catch (error) {
    recordRequestError("shortcut_open_app", error);
    throw new ShortcutRunError(t("shortcut.errOpenApp", button.value));
  }
}

/**
 * Run the command line in the project directory through the backend.
 *
 * A non-zero exit is reported with the command's own output, since "it failed" without the reason is
 * useless for a shell command the user wrote themselves.
 */
async function runBash(button: ShortcutButton, rootPath: string | null): Promise<void> {
  if (!rootPath) throw new ShortcutRunError(t("shortcut.errNoProject"));
  let result: { exitCode: number; stdout: string; stderr: string };
  try {
    result = await runShortcutCommand(rootPath, button.value);
  } catch (error) {
    // The raw message, not `safeError`'s classification: this copy is what the person who clicked the
    // button reads, while `recordRequestError` above has already filed the diagnostic form of it.
    recordRequestError("shortcut_run_command", error);
    throw new ShortcutRunError(t("shortcut.errCommand", commandFailureText(error)));
  }
  if (result.exitCode !== 0) {
    const detail = (result.stderr.trim() || result.stdout.trim()).slice(0, 600);
    throw new ShortcutRunError(t("shortcut.errCommandExit", result.exitCode, detail));
  }
}

/**
 * Turn a backend failure into text the user can act on.
 *
 * The two named cases are the ones a button left over from an earlier session actually hits — the project
 * directory was moved or deleted, or the command ran past its minute — and each has a better sentence than
 * its backend token. Everything else is shown as-is.
 */
function commandFailureText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("shortcut_command_bad_cwd")) return t("shortcut.errNoDirectory");
  if (message.includes("shortcut_command_timeout")) {
    const seconds = Number(message.split(":").pop());
    return t("shortcut.errCommandTimeout", Number.isFinite(seconds) ? seconds : 0);
  }
  return message;
}
