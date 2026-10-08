import { describe, expect, it, vi, beforeEach } from "vitest";
import { ShortcutRunError, runShortcutButton } from "./shortcutRunner";
import { t } from "./i18n";
import type { ShortcutButton } from "./shortcutButtons";

const openExternal = vi.fn();
const openPath = vi.fn();
const runShortcutCommand = vi.fn();
const recordRequestError = vi.fn();

vi.mock("./platform", () => ({
  platform: {
    opener: {
      openExternal: (...args: unknown[]) => openExternal(...args),
      openPath: (...args: unknown[]) => openPath(...args),
    },
  },
}));
vi.mock("./ipc/tree", () => ({
  runShortcutCommand: (...args: unknown[]) => runShortcutCommand(...args),
}));
vi.mock("./ipc/reqLog", () => ({
  recordRequestError: (...args: unknown[]) => recordRequestError(...args),
}));

function button(type: ShortcutButton["type"], value: string): ShortcutButton {
  return { id: "b", title: "Gerrit", type, value };
}

beforeEach(() => {
  for (const fn of [openExternal, openPath, runShortcutCommand, recordRequestError]) fn.mockReset();
  openExternal.mockResolvedValue(undefined);
  openPath.mockResolvedValue(undefined);
});

describe("runShortcutButton", () => {
  it("opens an http(s) address and normalizes it first", async () => {
    await runShortcutButton(button("url", "https://example.com/a b"), "/repo");
    expect(openExternal).toHaveBeenCalledWith("https://example.com/a%20b");
  });

  it("refuses anything that is not http(s), so a button cannot launch an arbitrary scheme", async () => {
    for (const value of ["file:///etc/passwd", "javascript:alert(1)", "vlxterm://pair?x=1", "not a url"]) {
      await expect(runShortcutButton(button("url", value), "/repo")).rejects.toThrow(t("shortcut.errBadUrl"));
    }
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("reports an opener failure against the button's own title", async () => {
    openExternal.mockRejectedValue(new Error("no handler"));
    await expect(runShortcutButton(button("url", "https://example.com"), "/repo")).rejects.toThrow(
      t("shortcut.errOpenUrl", "Gerrit"),
    );
    expect(recordRequestError).toHaveBeenCalledWith("shortcut_open_url", expect.any(Error));
  });

  it("opens the project directory with the app and requires a project to do it", async () => {
    await runShortcutButton(button("app", "/Applications/SourceTree.app"), "/repo");
    expect(openPath).toHaveBeenCalledWith("/Applications/SourceTree.app");

    openPath.mockRejectedValue(new Error("gone"));
    await expect(runShortcutButton(button("app", "/Applications/Gone.app"), "/repo")).rejects.toThrow(
      t("shortcut.errOpenApp", "/Applications/Gone.app"),
    );
    await expect(runShortcutButton(button("app", "/Applications/SourceTree.app"), null)).rejects.toThrow(
      t("shortcut.errNoProject"),
    );
  });

  it("runs a command in the project directory and stays quiet on success", async () => {
    runShortcutCommand.mockResolvedValue({ exitCode: 0, stdout: "ok\n", stderr: "" });
    await expect(runShortcutButton(button("bash", "make test"), "/repo")).resolves.toBeUndefined();
    expect(runShortcutCommand).toHaveBeenCalledWith("/repo", "make test");
    await expect(runShortcutButton(button("bash", "make test"), null)).rejects.toThrow(t("shortcut.errNoProject"));
  });

  it("surfaces a non-zero exit with the command's own output, stderr first", async () => {
    runShortcutCommand.mockResolvedValue({ exitCode: 2, stdout: "stdout noise", stderr: "  boom  " });
    await expect(runShortcutButton(button("bash", "make test"), "/repo")).rejects.toThrow(
      t("shortcut.errCommandExit", 2, "boom"),
    );
    // With nothing on stderr, stdout is what explains the failure.
    runShortcutCommand.mockResolvedValue({ exitCode: 2, stdout: "stdout noise", stderr: "   " });
    await expect(runShortcutButton(button("bash", "make test"), "/repo")).rejects.toThrow(
      t("shortcut.errCommandExit", 2, "stdout noise"),
    );
  });

  it("caps the output it carries into the message", async () => {
    runShortcutCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "x".repeat(2000) });
    await expect(runShortcutButton(button("bash", "make test"), "/repo")).rejects.toThrow(
      t("shortcut.errCommandExit", 1, "x".repeat(600)),
    );
  });

  it("wraps a transport failure rather than letting it escape as a raw error", async () => {
    runShortcutCommand.mockRejectedValue(new Error("ipc down"));
    const failure = await runShortcutButton(button("bash", "make test"), "/repo").catch((e) => e);
    expect(failure).toBeInstanceOf(ShortcutRunError);
    expect((failure as Error).message).toContain(t("shortcut.errCommand", "ipc down"));
    expect(recordRequestError).toHaveBeenCalledWith("shortcut_run_command", expect.any(Error));
  });

  it("turns the two failures a stale button hits into a sentence", async () => {
    runShortcutCommand.mockRejectedValue(new Error("shortcut_command_bad_cwd:/gone"));
    await expect(runShortcutButton(button("bash", "make test"), "/gone")).rejects.toThrow(
      t("shortcut.errCommand", t("shortcut.errNoDirectory")),
    );
    runShortcutCommand.mockRejectedValue(new Error("shortcut_command_timeout:60"));
    await expect(runShortcutButton(button("bash", "make test"), "/repo")).rejects.toThrow(
      t("shortcut.errCommand", t("shortcut.errCommandTimeout", 60)),
    );
  });
});
