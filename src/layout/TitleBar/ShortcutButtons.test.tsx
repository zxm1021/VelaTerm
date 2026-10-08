import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ShortcutRunError, runShortcutButton } from "../../shortcutRunner";
import type { ShortcutButton } from "../../shortcutButtons";
import { ShortcutButtons } from "./ShortcutButtons";

vi.mock("../../shortcutRunner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shortcutRunner")>();
  return { ...actual, runShortcutButton: vi.fn() };
});

const run = vi.mocked(runShortcutButton);

function button(id: string, title: string): ShortcutButton {
  return { id, title, type: "url", value: `https://${id}.example.com` };
}

const GLOBAL = button("g", "Docs");
const PROJECT = button("p", "Gerrit");

beforeEach(() => {
  run.mockReset();
  run.mockResolvedValue(undefined);
});

describe("ShortcutButtons", () => {
  it("shows the project's buttons after the global ones, with a divider only when both groups exist", () => {
    const { container, unmount } = render(
      <ShortcutButtons globals={[GLOBAL]} projectButtons={[PROJECT]} rootPath="/repo" onEdit={() => {}} />,
    );
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    // The trailing entry is the editor's "+", which has no label of its own.
    expect(labels.slice(0, 2)).toEqual([GLOBAL.title, PROJECT.title]);
    expect(container.querySelector(".tb-shortcuts-sep")).not.toBeNull();
    unmount();

    // A divider between nothing and something would mark a boundary that is not there.
    const { container: alone } = render(
      <ShortcutButtons globals={[GLOBAL]} projectButtons={[]} rootPath={null} onEdit={() => {}} />,
    );
    expect(alone.querySelector(".tb-shortcuts-sep")).toBeNull();
  });

  it("runs the clicked button against the project directory", () => {
    render(<ShortcutButtons globals={[GLOBAL]} projectButtons={[PROJECT]} rootPath="/repo" onEdit={() => {}} />);
    fireEvent.click(screen.getByTitle(GLOBAL.value));
    expect(run).toHaveBeenCalledWith(GLOBAL, "/repo");
  });

  it("reports a failure next to the buttons and clears the report on the next click", async () => {
    run.mockRejectedValueOnce(new ShortcutRunError("could not open it"));
    render(<ShortcutButtons globals={[GLOBAL]} projectButtons={[]} rootPath="/repo" onEdit={() => {}} />);
    fireEvent.click(screen.getByTitle(GLOBAL.value));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "could not open it");

    // The message belongs to the click that caused it, so a second click must not leave it standing.
    fireEvent.click(screen.getByTitle(GLOBAL.value));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("falls back to the error's own text when it is not a run failure", async () => {
    run.mockRejectedValueOnce(new Error("boom"));
    render(<ShortcutButtons globals={[GLOBAL]} projectButtons={[]} rootPath={null} onEdit={() => {}} />);
    fireEvent.click(screen.getByTitle(GLOBAL.value));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Error: boom");
  });

  it("opens the editor from the add button", () => {
    const onEdit = vi.fn();
    render(<ShortcutButtons globals={[]} projectButtons={[]} rootPath={null} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit shortcut buttons" }));
    expect(onEdit).toHaveBeenCalledOnce();
  });
});
