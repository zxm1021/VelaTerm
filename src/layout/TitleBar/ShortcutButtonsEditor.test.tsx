import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MAX_PROJECT_SHORTCUTS, type ShortcutButton } from "../../shortcutButtons";
import { ShortcutButtonsEditor } from "./ShortcutButtonsEditor";

function button(id: string, title: string, value: string): ShortcutButton {
  return { id, title, type: "url", value };
}

function setup({
  globalButtons = [],
  projectButtons = [],
  projectName = null as string | null,
}: {
  globalButtons?: ShortcutButton[];
  projectButtons?: ShortcutButton[];
  projectName?: string | null;
} = {}) {
  const onSaveGlobal = vi.fn();
  const onSaveProject = vi.fn();
  const onClose = vi.fn();
  render(
    <ShortcutButtonsEditor
      globalButtons={globalButtons}
      projectButtons={projectButtons}
      projectName={projectName}
      onSaveGlobal={onSaveGlobal}
      onSaveProject={onSaveProject}
      onClose={onClose}
    />,
  );
  return { onSaveGlobal, onSaveProject, onClose };
}

/** The title field of one row, found through the value field beside it. */
function titleFieldOf(value: string): HTMLInputElement {
  const row = screen.getByDisplayValue(value).parentElement as HTMLElement;
  return row.querySelectorAll("input")[0];
}

describe("ShortcutButtonsEditor", () => {
  it("edits the global list alone when no project is selected", () => {
    const { onSaveGlobal, onSaveProject } = setup({ globalButtons: [button("g", "Docs", "https://d")] });
    expect(screen.queryByText("Global")).toBeNull();
    fireEvent.change(titleFieldOf("https://d"), { target: { value: "Handbook" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSaveProject).not.toHaveBeenCalled();
    expect(onSaveGlobal).toHaveBeenCalledWith([button("g", "Handbook", "https://d")]);
  });

  it("defaults to the project's list and saves whichever scope is showing", () => {
    const { onSaveGlobal, onSaveProject } = setup({
      globalButtons: [button("g", "Docs", "https://d")],
      projectButtons: [button("p", "Gerrit", "https://g")],
      projectName: "VelaTerm",
    });
    expect(screen.getByText("Shortcut buttons · VelaTerm")).toBeTruthy();
    fireEvent.click(screen.getByText("Save"));
    expect(onSaveGlobal).not.toHaveBeenCalled();
    expect(onSaveProject).toHaveBeenCalledWith([button("p", "Gerrit", "https://g")]);

    // Switching scope is what makes the other list the one that gets written.
    fireEvent.click(screen.getByText("Global"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSaveGlobal).toHaveBeenCalledWith([button("g", "Docs", "https://d")]);
  });

  it("drops rows that are missing a title or a value instead of saving a button that cannot run", () => {
    const { onSaveGlobal } = setup({
      globalButtons: [button("a", "Docs", "https://d"), button("b", "", "https://b"), button("c", "Blank", "")],
    });
    fireEvent.click(screen.getByText("Save"));
    expect(onSaveGlobal).toHaveBeenCalledWith([button("a", "Docs", "https://d")]);
  });

  it("reorders with the move buttons and disables them at the ends", () => {
    const { onSaveProject } = setup({
      projectButtons: [button("a", "One", "https://1"), button("b", "Two", "https://2")],
      projectName: "VelaTerm",
    });
    const up = screen.getAllByTitle("Move up");
    const down = screen.getAllByTitle("Move down");
    expect((up[0] as HTMLButtonElement).disabled).toBe(true);
    expect((down[1] as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(down[0]);
    fireEvent.click(screen.getByText("Save"));
    expect(onSaveProject).toHaveBeenCalledWith([button("b", "Two", "https://2"), button("a", "One", "https://1")]);
  });

  it("refuses to add a sixth project button but lets the global list keep growing", () => {
    const many = Array.from({ length: MAX_PROJECT_SHORTCUTS }, (_, i) =>
      button(`p${i}`, `B${i}`, `https://${i}`),
    );
    const { onSaveGlobal } = setup({ projectButtons: many, projectName: "VelaTerm" });
    expect((screen.getByText("Add").closest("button") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByText("Global"));
    expect((screen.getByText("Add").closest("button") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByText("Add"));
    fireEvent.click(screen.getByText("Save"));
    // The new row starts as an empty URL button, which the save filter then drops: nothing is stored.
    expect(onSaveGlobal).toHaveBeenCalledWith([]);
  });

  it("closes without saving when cancelled", () => {
    const { onSaveGlobal, onClose } = setup({ globalButtons: [button("g", "Docs", "https://d")] });
    fireEvent.click(screen.getByText("Cancel"));
    expect(onSaveGlobal).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
