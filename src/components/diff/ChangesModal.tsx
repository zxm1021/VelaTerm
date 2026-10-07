//! Changes modal showing all uncommitted workspace changes relative to HEAD: staged, unstaged, and untracked.
//! The left side lists changed files; selecting one renders a line-by-line diff on the right. Mounted at the
//! App root and driven by changesCwd in the store, this self-contained overlay does not interact with center
//! tabs or keep-alive behavior.
//!
//! With changesCommit set the same layout shows one commit instead of the worktree: the file list comes from
//! that commit and each diff compares its parent against it. The Git panel's history opens the modal this way,
//! so committed and uncommitted changes are read through one viewer.
//!
//! The overlay fills the whole window: a diff is read by the screenful, and the floating panel wasted a margin
//! on every side. Three view controls sit in the header and persist across sessions (see diffPrefs) — which
//! content to show (both sides compared, or one side's file as it stands), how much unchanged context to keep
//! around each change, and whether the comparison is split into two columns or merged into one. `/` flips the
//! layout without leaving the keyboard.

import { useEffect, useRef, useState } from "react";
import type { MergeView } from "@codemirror/merge";
import { useT } from "../../i18n";
import { useSuspendNativeViews } from "../../hooks/nativeViewSuspend";
import { DEFAULT_BINDINGS, matchCombo } from "../../hooks/shortcutRegistry";
import { Seg } from "../../layout/TitleBar/settingsParts";
import {
  gitChangedFiles,
  gitCommitFileDiff,
  gitCommitFiles,
  gitFileDiff,
  type ChangedFile,
  type FileDiff,
} from "../../ipc/commands";
import { useTermStore } from "../../store/termStore";
import { STATUS_META } from "./changeStatus";
import {
  collapseFor,
  loadDiffPrefs,
  saveDiffPrefs,
  type DiffContentMode,
  type DiffContextMode,
  type DiffLayoutMode,
  type DiffPrefs,
} from "./diffPrefs";

/**
 * Render a single-file diff by loading the texts into a read-only CodeMirror instance, adding language
 * support transparently once loaded.
 *
 * `content` picks what is compared: "both" builds a MergeView, while "old" and "new" render one side's
 * file on its own. `layout` applies only to "both", where "unified" merges the comparison into a single
 * column with deleted lines inlined above the text that replaced them. `tick` is the modal's refresh
 * counter: it carries no data, it only forces the open diff to reload so it cannot disagree with the
 * refreshed line counts beside it.
 */
function DiffView({
  cwd,
  path,
  tick,
  commit,
  content,
  context,
  layout,
}: {
  cwd: string;
  path: string;
  tick: number;
  commit: string | null;
  content: DiffContentMode;
  context: DiffContextMode;
  layout: DiffLayoutMode;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    setDiff(null);
    setErr("");
    const load = commit ? gitCommitFileDiff(cwd, commit, path) : gitFileDiff(cwd, path);
    void load
      .then((d) => {
        if (alive) setDiff(d);
      })
      .catch((e) => {
        if (alive) setErr(String(e));
      });
    return () => {
      alive = false;
    };
  }, [cwd, path, tick, commit]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !diff || diff.binary) return;
    let mv: MergeView | null = null;
    let single: { destroy(): void } | null = null;
    let cancelled = false;
    void (async () => {
      // CodeMirror and the language catalogue load on demand: the modal is opened rarely, and a static
      // import would place roughly 330 kB of editor code in the entry chunk.
      const [merge, view, state, theme] = await Promise.all([
        import("@codemirror/merge"),
        import("@codemirror/view"),
        import("@codemirror/state"),
        import("./codeMirrorTheme"),
      ]);
      const { EditorView, lineNumbers } = view;
      const { EditorState } = state;
      const langExt = await theme.languageExtensionFor(diff.path);
      if (cancelled || !ref.current) return;
      const base = [
        lineNumbers(),
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        EditorView.lineWrapping,
        theme.vlxCmHighlighting(),
      ];
      const side = langExt ? [...base, langExt] : base;
      const collapse = collapseFor(context);

      if (content === "both" && layout === "split") {
        mv = new merge.MergeView({
          a: { doc: diff.original, extensions: side },
          b: { doc: diff.modified, extensions: side },
          parent: ref.current,
          collapseUnchanged: collapse,
          gutter: true,
          highlightChanges: true,
        });
        return;
      }

      // One editor from here on. Fill-height is added to these branches only: the merge view deliberately
      // sizes its editors to their content so the two sides scroll as one, and forcing 100% height on them
      // would break that alignment.
      const extensions = [...side, theme.vlxCmFillHeight()];
      if (content === "both") {
        // Merged column: the modified file is the document and each changed chunk carries the lines it
        // replaced, inlined above them. Revert controls are for editing, which this viewer never does.
        extensions.push(
          ...merge.unifiedMergeView({
            original: diff.original,
            mergeControls: false,
            collapseUnchanged: collapse,
          }),
        );
      }
      single = new EditorView({
        doc: content === "old" ? diff.original : diff.modified,
        extensions,
        parent: ref.current,
      });
    })();
    return () => {
      cancelled = true;
      mv?.destroy();
      single?.destroy();
    };
  }, [diff, content, context, layout]);

  if (err) {
    return (
      <div style={{ padding: 16, fontSize: 12.5, color: "var(--danger, #e05252)", whiteSpace: "pre-wrap" }}>
        {err}
      </div>
    );
  }
  if (!diff) {
    return (
      <div style={{ padding: 16, fontSize: 12.5, color: "var(--text-muted)" }}>
        {t("changes.loadingDiff")}
      </div>
    );
  }
  if (diff.binary) {
    return (
      <div style={{ padding: 16, fontSize: 12.5, color: "var(--text-muted)" }}>
        {t("changes.binary")}
      </div>
    );
  }
  return <div ref={ref} style={{ height: "100%", overflow: "auto" }} />;
}

export function ChangesModal() {
  const t = useT();
  const cwd = useTermStore((s) => s.changesCwd);
  const commit = useTermStore((s) => s.changesCommit);
  const initialPath = useTermStore((s) => s.changesPath);
  const close = useTermStore((s) => s.closeChanges);
  const [files, setFiles] = useState<ChangedFile[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  const [prefs, setPrefs] = useState<DiffPrefs>(loadDiffPrefs);

  // Write through on every change rather than in an effect, so the value on disk is never the stale one
  // from before a remount.
  const update = (patch: Partial<DiffPrefs>) => {
    const next = { ...prefs, ...patch };
    saveDiffPrefs(next);
    setPrefs(next);
  };

  // Opening a different directory or commit resets the list; a manual refresh keeps the current selection.
  useEffect(() => {
    setFiles(null);
    setSelected(null);
    setErr("");
  }, [cwd, commit]);

  useEffect(() => {
    if (!cwd) return;
    let alive = true;
    const load = commit ? gitCommitFiles(cwd, commit) : gitChangedFiles(cwd);
    void load
      .then((fs) => {
        if (!alive) return;
        setFiles(fs);
        // Keep whatever is already selected across a refresh; on first load honour the caller's
        // requested file, which is how clicking a row in the Git panel lands on that same file.
        setSelected((cur) => {
          const wanted = cur ?? initialPath;
          return wanted && fs.some((f) => f.path === wanted) ? wanted : (fs[0]?.path ?? null);
        });
        setErr("");
      })
      .catch((e) => {
        if (alive) setErr(String(e));
      });
    return () => {
      alive = false;
    };
  }, [cwd, commit, initialPath, tick]);

  // Suspend native browser views while the modal is visible so they cannot cover it (architecture document §17).
  useSuspendNativeViews(Boolean(cwd));

  // The close chord belongs to the modal while it is open. The global shortcut hook listens on document in the
  // capture phase, so without this it wins: Cmd+W closed the pane behind the overlay and left the modal sitting
  // on top of a session the user had just destroyed. Listening on window capture runs first, so the key closes
  // the modal and never reaches the pane. Only this one action is claimed — Cmd+T and the rest still work
  // behind the overlay, which is harmless because the modal keeps covering whatever they change.
  //
  // The bound chord is read from the store rather than hard-coded: it is remappable, and a user who moved
  // closePane elsewhere must have that chord close the modal too. Depends on `cwd` because the listener is
  // only worth installing while the modal is open.
  const open = Boolean(cwd);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const combo = useTermStore.getState().shortcutOverrides.closePane || DEFAULT_BINDINGS.closePane;
      if (!matchCombo(e, combo)) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  if (!cwd) return null;

  // Context and layout describe a comparison, so they are inert while a single side is displayed; disabling
  // them says that outright instead of leaving controls that quietly do nothing.
  const comparing = prefs.content === "both";
  const mergedColumn = comparing && prefs.layout === "unified";

  const onKeyDown = (e: React.KeyboardEvent) => {
    // isComposing lives on the native event: React's synthetic KeyboardEvent does not re-export it, and
    // without the check an IME candidate window would swallow the layout toggle.
    if (e.nativeEvent.isComposing || e.repeat) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    // The file list and the read-only editors are the only things that can hold focus here, so a bare `/`
    // is always the layout toggle; the modifier guard keeps browser and OS chords intact.
    if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      update({ layout: mergedColumn ? "split" : "unified" });
    }
  };

  return (
    <div
      role="dialog"
      aria-label={t("changes.title")}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-panel)",
      }}
    >
      {/* Header: title, the three view controls, and the actions. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 16px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div
          style={{
            flex: "none",
            maxWidth: "22vw",
            fontSize: 13.5,
            fontWeight: 600,
            color: "var(--text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {commit ? t("changes.commitTitle", commit) : t("changes.title")}
        </div>
        <div style={{ flex: 1, minWidth: 8 }} />
        {/* The controls keep their width and the title yields instead: the header has to fit at a narrow
            window width, and a wrapped or clipped control row is worse than a truncated commit hash. */}
        <Seg<DiffContentMode>
          value={prefs.content}
          options={[
            ["both", t("changes.contentBoth")],
            ["old", t("changes.contentOld")],
            ["new", t("changes.contentNew")],
          ]}
          onChange={(v) => update({ content: v })}
        />
        <Seg<DiffContextMode>
          value={prefs.context}
          options={[
            ["3", t("changes.context3")],
            ["20", t("changes.context20")],
            ["all", t("changes.contextAll")],
          ]}
          disabledOptions={comparing ? [] : ["3", "20", "all"]}
          onChange={(v) => update({ context: v })}
        />
        <Seg<DiffLayoutMode>
          value={prefs.layout}
          options={[
            ["split", t("changes.layoutSplit")],
            ["unified", t("changes.layoutUnified")],
          ]}
          disabledOptions={comparing ? [] : ["split", "unified"]}
          onChange={(v) => update({ layout: v })}
        />
        <button className="vlx-btn" style={{ flex: "none", whiteSpace: "nowrap" }} onClick={() => setTick((n) => n + 1)}>
          {t("changes.refresh")}
        </button>
        <button className="vlx-btn" style={{ flex: "none", whiteSpace: "nowrap" }} onClick={close}>
          {t("common.close")}
        </button>
      </div>

      {/* Body: file list on the left, diff on the right. */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div
          style={{
            width: 280,
            flex: "none",
            borderRight: "1px solid var(--border)",
            overflowY: "auto",
            padding: 6,
          }}
        >
          {err && (
            <div style={{ padding: 10, fontSize: 12, color: "var(--danger, #e05252)", whiteSpace: "pre-wrap" }}>
              {err}
            </div>
          )}
          {!err && files === null && (
            <div style={{ padding: 10, fontSize: 12, color: "var(--text-muted)" }}>
              {t("changes.loading")}
            </div>
          )}
          {!err && files !== null && files.length === 0 && (
            <div style={{ padding: 10, fontSize: 12, color: "var(--text-muted)" }}>
              {t("changes.noChanges")}
            </div>
          )}
          {files?.map((f) => {
            const meta = STATUS_META[f.status] ?? STATUS_META.modified;
            const active = f.path === selected;
            // Split into directory and filename. The directory may truncate with an ellipsis, while the filename
            // remains complete to preserve the most informative tail. Backend paths always use forward slashes
            // (see ChangedFile.path), so splitting on the final "/" is sufficient.
            const slash = f.path.lastIndexOf("/");
            const dir = slash >= 0 ? f.path.slice(0, slash + 1) : "";
            const base = slash >= 0 ? f.path.slice(slash + 1) : f.path;
            return (
              <div
                key={f.path}
                onClick={() => setSelected(f.path)}
                title={f.path}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "5px 8px",
                  borderRadius: 5,
                  cursor: "pointer",
                  background: active ? "var(--bg-hover)" : "transparent",
                }}
              >
                <span
                  style={{ flex: "none", width: 12, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, color: meta.color }}
                >
                  {meta.letter}
                </span>
                {/* DO NOT go back to direction:rtl. An early version used it to ellipsize from the
                    left and keep the trailing file name visible, but that bidi trick swallows the
                    first character of a purely LTR name under WebKit (Tauri's WKWebView) — for
                    example `java-app-samples` renders as `ava-app-samples`. The directory segment
                    now shrinks and truncates through flex while the file name is always shown,
                    which depends on no bidi behaviour, is identical on all three platforms, and
                    still keeps the trailing file name visible as originally intended. */}
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    overflow: "hidden",
                    fontSize: 12,
                    color: "var(--text-primary)",
                  }}
                >
                  {dir && (
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        color: "var(--text-muted)",
                      }}
                    >
                      {dir}
                    </span>
                  )}
                  <span style={{ flex: "none", whiteSpace: "nowrap" }}>{base}</span>
                </span>
                {!f.binary && (f.additions > 0 || f.deletions > 0) && (
                  <span style={{ flex: "none", fontSize: 10.5, fontFamily: "var(--font-mono)" }}>
                    <span style={{ color: "var(--green, #3fb950)" }}>+{f.additions}</span>{" "}
                    <span style={{ color: "var(--danger, #e05252)" }}>-{f.deletions}</span>
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          {selected ? (
            <DiffView
              cwd={cwd}
              path={selected}
              tick={tick}
              commit={commit}
              content={prefs.content}
              context={prefs.context}
              layout={prefs.layout}
            />
          ) : (
            <div style={{ padding: 16, fontSize: 12.5, color: "var(--text-muted)" }}>
              {t("changes.selectFile")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
