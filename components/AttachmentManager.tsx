"use client";

/*
  AttachmentManager — reusable, enterprise document manager for EVERY ERP module.
  ==============================================================================
  Drop into any screen with <AttachmentManager module="gl" recordId="1000" />.
  Files are stored as REAL files in the application storage directory
  (/storage/attachments/<module>/<recordId>/) via the DMS API — never in the
  database. Metadata (versions, tags, audit trail) is JSON on disk.

  Features: drag & drop + browse, multi-file upload with progress / cancel /
  retry, versioning (same-name never overwrites — v1/v2/v3, restorable), tags,
  search, folder statistics, audit history, inline preview (PDF / image / text),
  and role-based gating (read-only users can only view + download).
*/

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons";
import { Menu, type MenuItem } from "@/components/overlay";
import { inputClass } from "./FormField";
import {
  ACCEPTED_LABELS,
  ALLOWED_EXT,
  CATEGORY_BADGE,
  MAX_FILE_MB,
  TAG_PRESETS,
  categoryOf,
  formatSize,
  moduleLabel,
  previewKindOf,
  validateUpload,
} from "@/lib/attachments/config";
import {
  deleteAttachment,
  downloadAttachment,
  fileUrl,
  listAttachments,
  renameAttachment,
  restoreAttachmentVersion,
  setAttachmentTags,
  uploadAttachment,
  userCanWrite,
} from "@/lib/attachments/client";
import type { AttachmentListResponse, AttachmentMeta } from "@/lib/attachments/types";

interface UploadTask {
  id: string;
  name: string;
  pct: number;
  status: "uploading" | "error";
  error?: string;
  file: File;
  controller: AbortController;
}
type Dialog =
  | { type: "preview"; att: AttachmentMeta }
  | { type: "rename"; att: AttachmentMeta }
  | { type: "delete"; att: AttachmentMeta }
  | { type: "tags"; att: AttachmentMeta }
  | { type: "versions"; att: AttachmentMeta }
  | { type: "history" }
  | null;

function fmtDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "—", time: "" };
  return {
    date: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
  };
}
function relative(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function AttachmentManager({
  module,
  recordId,
  readOnly = false,
}: {
  module: string;
  recordId: string;
  readOnly?: boolean;
}) {
  const [data, setData] = useState<AttachmentListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [uploads, setUploads] = useState<UploadTask[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dragOver, setDragOver] = useState(false);
  const [note, setNote] = useState<{ msg: string; tone: "ok" | "err" } | null>(null);
  // Single open Actions menu at a time; anchored to the clicked ⋯ button element.
  const [menu, setMenu] = useState<{ att: AttachmentMeta; anchorEl: HTMLElement } | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<AttachmentMeta | null>(null);

  const writable = !readOnly && userCanWrite();
  const flash = useCallback((msg: string, tone: "ok" | "err" = "ok") => {
    setNote({ msg, tone });
    setTimeout(() => setNote(null), 3200);
  }, []);

  const load = useCallback(async () => {
    try {
      setData(await listAttachments(module, recordId));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, [module, recordId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // ---- uploads (progress / cancel / retry) --------------------------------
  const runUpload = useCallback(
    async (file: File, taskId: string, controller: AbortController) => {
      try {
        const res = await uploadAttachment(module, recordId, file, {
          signal: controller.signal,
          onProgress: (pct) => setUploads((u) => u.map((t) => (t.id === taskId ? { ...t, pct } : t))),
        });
        setData(res);
        setUploads((u) => u.filter((t) => t.id !== taskId));
      } catch (e) {
        const err = e as Error;
        if (err.name === "AbortError") setUploads((u) => u.filter((t) => t.id !== taskId));
        else setUploads((u) => u.map((t) => (t.id === taskId ? { ...t, status: "error", error: err.message } : t)));
      }
    },
    [module, recordId],
  );

  const startUpload = useCallback(
    (file: File) => {
      const v = validateUpload(file.name, file.size);
      if (!v.ok) {
        flash(v.error ?? "Unsupported file.", "err");
        return;
      }
      const id = crypto.randomUUID();
      const controller = new AbortController();
      setUploads((u) => [...u, { id, name: file.name, pct: 0, status: "uploading", file, controller }]);
      void runUpload(file, id, controller);
    },
    [runUpload, flash],
  );

  const retry = useCallback(
    (task: UploadTask) => {
      const controller = new AbortController();
      setUploads((u) => u.map((t) => (t.id === task.id ? { ...t, status: "uploading", pct: 0, error: undefined, controller } : t)));
      void runUpload(task.file, task.id, controller);
    },
    [runUpload],
  );

  const handleFiles = useCallback(
    (list: FileList | File[] | null) => {
      if (!list) return;
      if (!writable) {
        flash("You have read-only access — uploading is disabled.", "err");
        return;
      }
      for (const file of Array.from(list)) startUpload(file);
    },
    [startUpload, writable, flash],
  );

  // ---- actions ------------------------------------------------------------
  const doDownload = useCallback(
    async (att: AttachmentMeta, version?: number) => {
      try {
        await downloadAttachment(module, recordId, att.id, att.name, version);
        void load(); // refresh audit trail
      } catch {
        flash("Download failed.", "err");
      }
    },
    [module, recordId, load, flash],
  );

  const doDelete = useCallback(
    async (att: AttachmentMeta) => {
      try {
        setData(await deleteAttachment(module, recordId, att.id));
        flash(`Deleted “${att.name}”.`);
      } catch (e) {
        flash(e instanceof Error ? e.message : "Delete failed.", "err");
      }
    },
    [module, recordId, flash],
  );

  const storagePath = data?.storagePath ?? `/storage/attachments/${module}/${recordId}`;
  const copyPath = useCallback(
    async (att: AttachmentMeta) => {
      try {
        await navigator.clipboard.writeText(`${storagePath}/${att.name}`);
        flash("File path copied.");
      } catch {
        flash("Couldn't copy path.", "err");
      }
    },
    [storagePath, flash],
  );
  const openFolder = useCallback(() => {
    const n = data?.files.length ?? 0;
    setSearch("");
    flash(`Opened folder — showing all ${n} file${n === 1 ? "" : "s"}.`);
  }, [data, flash]);
  const openReplace = useCallback((att: AttachmentMeta) => {
    replaceTarget.current = att;
    replaceInput.current?.click();
  }, []);

  // Build the portal Actions menu for a file (role-gated).
  const buildMenuItems = useCallback(
    (a: AttachmentMeta): MenuItem[] => {
      const view: MenuItem[] = [
        { icon: "eye", label: "View", onClick: () => setDialog({ type: "preview", att: a }) },
        { icon: "download", label: "Download", onClick: () => void doDownload(a) },
      ];
      const nav: MenuItem[] = [
        { icon: "link", label: "Copy File Path", onClick: () => void copyPath(a) },
        { icon: "folder", label: "Open Folder", onClick: () => openFolder() },
      ];
      if (!writable) return [...view, { separator: true }, ...nav];
      return [
        ...view,
        { separator: true },
        { icon: "pencil", label: "Rename", onClick: () => setDialog({ type: "rename", att: a }) },
        { icon: "upload", label: "Replace File", onClick: () => openReplace(a) },
        { icon: "copy", label: "Upload New Version", onClick: () => openReplace(a) },
        { icon: "star", label: "Tags", onClick: () => setDialog({ type: "tags", att: a }) },
        { separator: true },
        ...nav,
        { separator: true },
        { icon: "trash", label: "Delete", danger: true, onClick: () => setDialog({ type: "delete", att: a }) },
      ];
    },
    [writable, doDownload, copyPath, openFolder, openReplace],
  );

  // ---- derived ------------------------------------------------------------
  const files = data?.files ?? [];
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q
      ? files.filter((a) => `${a.name} ${a.ext} ${a.uploadedBy} ${a.tags.join(" ")} ${fmtDateTime(a.modifiedAt).date}`.toLowerCase().includes(q))
      : files;
    return [...rows].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }, [files, search]);

  const acceptAttr = ALLOWED_EXT.map((x) => `.${x}`).join(",");

  // ---- drag & drop --------------------------------------------------------
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div
      className="flex flex-col gap-3"
      onDragOver={(e) => {
        if (!writable) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {/* hidden inputs */}
      <input ref={fileInput} type="file" multiple accept={acceptAttr} className="hidden" onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
      <input
        ref={replaceInput}
        type="file"
        accept={acceptAttr}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const target = replaceTarget.current;
          e.target.value = "";
          if (!file || !target) return;
          const v = validateUpload(file.name, file.size);
          if (!v.ok) return flash(v.error ?? "Unsupported file.", "err");
          const id = crypto.randomUUID();
          const controller = new AbortController();
          setUploads((u) => [...u, { id, name: file.name, pct: 0, status: "uploading", file, controller }]);
          void (async () => {
            try {
              const res = await uploadAttachment(module, recordId, file, {
                replaceId: target.id,
                signal: controller.signal,
                onProgress: (pct) => setUploads((u) => u.map((t) => (t.id === id ? { ...t, pct } : t))),
              });
              setData(res);
              setUploads((u) => u.filter((t) => t.id !== id));
              flash(`Replaced — new version of “${target.name}”.`);
            } catch (err) {
              setUploads((u) => u.map((t) => (t.id === id ? { ...t, status: "error", error: (err as Error).message } : t)));
            }
          })();
        }}
      />

      {/* folder statistics */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-2.5 text-sm dark:border-slate-800 dark:bg-slate-800/30">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <Stat icon="folder" label={`${data?.stats.count ?? 0} File${(data?.stats.count ?? 0) === 1 ? "" : "s"}`} />
          <Stat icon="download" label={formatSize(data?.stats.totalBytes ?? 0)} />
          <Stat icon="clock" label={`Updated ${relative(data?.stats.lastUpdated ?? null)}`} />
          {(data?.stats.uploaders.length ?? 0) > 0 && <Stat icon="users" label={data!.stats.uploaders.slice(0, 3).join(", ")} />}
        </div>
        <button onClick={() => setDialog({ type: "history" })} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-brand dark:text-slate-400">
          <Icon name="clock" size={14} /> Audit history
        </button>
      </div>
      <p className="-mt-1 truncate px-1 text-[11px] text-slate-400" title={data?.storagePath}>
        {moduleLabel(module)} · <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{data?.storagePath ?? `/storage/attachments/${module}/${recordId}`}</code>
        {readOnly || !userCanWrite() ? " · read-only" : ""}
      </p>

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => fileInput.current?.click()}
          disabled={!writable}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon name="upload" size={15} /> Upload Files
        </button>
        <div className="relative ml-auto min-w-[10rem] flex-1">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" size={15} /></span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, type, tag, uploader…" className={`${inputClass} w-full py-1.5 pl-8 text-sm`} />
        </div>
      </div>

      {/* uploads in progress */}
      {uploads.length > 0 && (
        <div className="space-y-1.5">
          {uploads.map((t) => (
            <div key={t.id} className="rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-800">
              <div className="flex items-center gap-2 text-xs">
                <Icon name="upload" size={13} className={t.status === "error" ? "text-red-500" : "text-brand"} />
                <span className="truncate font-medium text-slate-700 dark:text-slate-200">{t.name}</span>
                <span className={`ml-auto ${t.status === "error" ? "text-red-500" : "text-slate-400"}`}>{t.status === "error" ? t.error ?? "Failed" : `${t.pct}%`}</span>
                {t.status === "error" && (
                  <button onClick={() => retry(t)} title="Retry" className="rounded p-0.5 text-slate-400 hover:text-brand"><Icon name="upload" size={13} /></button>
                )}
                <button onClick={() => { t.controller.abort(); setUploads((u) => u.filter((x) => x.id !== t.id)); }} className="rounded p-0.5 text-slate-400 hover:text-red-600" title="Cancel"><Icon name="close" size={13} /></button>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                <div className={`h-full rounded-full transition-all ${t.status === "error" ? "bg-red-500" : "bg-brand"}`} style={{ width: `${t.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* dropzone hint */}
      {writable && (
        <div
          onClick={() => fileInput.current?.click()}
          className={`cursor-pointer rounded-xl border border-dashed py-2.5 text-center text-xs transition ${
            dragOver ? "border-brand bg-brand/5 text-brand" : "border-slate-300 text-slate-400 hover:border-brand hover:text-brand dark:border-slate-700"
          }`}
        >
          Drag &amp; drop files here, or click to browse · {ACCEPTED_LABELS.join(" · ")} · max {MAX_FILE_MB} MB
        </div>
      )}

      {/* grid / states */}
      {loading ? (
        <div className="rounded-xl border border-slate-200 py-10 text-center text-sm text-slate-400 dark:border-slate-700">Loading documents…</div>
      ) : loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{loadError}</div>
      ) : files.length === 0 ? (
        <EmptyState writable={writable} onUpload={() => fileInput.current?.click()} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs dark:bg-slate-800/60">
              <tr className="text-left text-slate-500 dark:text-slate-400">
                <th className="px-3 py-2.5 font-semibold">File</th>
                <th className="px-3 py-2.5 font-semibold">Size</th>
                <th className="px-3 py-2.5 font-semibold">Uploaded By</th>
                <th className="px-3 py-2.5 font-semibold">Uploaded On</th>
                <th className="px-3 py-2.5 font-semibold">Version</th>
                <th className="px-3 py-2.5 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-400">No documents match “{search}”.</td></tr>
              ) : (
                visible.map((a) => {
                  const cat = categoryOf(a.ext);
                  const when = fmtDateTime(a.modifiedAt);
                  return (
                    <tr key={a.id} className="border-t border-slate-100 hover:bg-brand/[0.03] dark:border-slate-800 dark:hover:bg-brand/10">
                      <td className="px-3 py-2.5">
                        <div className="flex items-start gap-2.5">
                          <span className={`mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-lg text-[10px] font-bold uppercase ${CATEGORY_BADGE[cat]}`}>{a.ext || "?"}</span>
                          <div className="min-w-0">
                            <button onClick={() => setDialog({ type: "preview", att: a })} className="block max-w-[240px] truncate text-left font-medium text-slate-800 hover:text-brand hover:underline dark:text-slate-100" title={a.name}>{a.name}</button>
                            {a.description && (
                              <p className="max-w-[240px] truncate text-[11px] text-slate-400 dark:text-slate-500" title={a.description}>{a.description}</p>
                            )}
                            {a.tags.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {a.tags.map((t) => (
                                  <span key={t} className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">{t}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-500 dark:text-slate-400">{formatSize(a.size)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-600 dark:text-slate-300">{a.uploadedBy}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-500 dark:text-slate-400">{when.date} <span className="text-slate-400">{when.time}</span></td>
                      <td className="px-3 py-2.5">
                        <button onClick={() => setDialog({ type: "versions", att: a })} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600" title="Version history">
                          v{a.version}{a.versions.length > 1 ? ` · ${a.versions.length}` : ""}
                        </button>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-0.5">
                          <ActionIcon name="eye" label="View" onClick={() => setDialog({ type: "preview", att: a })} />
                          <ActionIcon name="download" label="Download" onClick={() => void doDownload(a)} />
                          <button
                            type="button"
                            title="More actions"
                            aria-label="More actions"
                            aria-haspopup="menu"
                            aria-expanded={menu?.att.id === a.id}
                            onClick={(e) => setMenu({ att: a, anchorEl: e.currentTarget })}
                            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-brand-light"
                          >
                            <Icon name="dots" size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {note && (
        <div className={`fixed bottom-6 left-1/2 z-[5000] -translate-x-1/2 rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-soft ${note.tone === "ok" ? "bg-slate-900 dark:bg-slate-700" : "bg-red-600"}`}>{note.msg}</div>
      )}

      {/* dialogs */}
      {dialog?.type === "preview" && <PreviewModal module={module} recordId={recordId} att={dialog.att} onClose={() => setDialog(null)} onDownload={() => void doDownload(dialog.att)} />}
      {dialog?.type === "rename" && (
        <NameDialog title="Rename file" initial={dialog.att.name.replace(/\.[^.]+$/, "")} confirmLabel="Save" onCancel={() => setDialog(null)}
          onConfirm={async (name) => { try { setData(await renameAttachment(module, recordId, dialog.att.id, name)); flash("Renamed."); } catch (e) { flash((e as Error).message, "err"); } setDialog(null); }} />
      )}
      {dialog?.type === "delete" && (
        <ConfirmModal title="Delete document?" message={`“${dialog.att.name}” and all its versions will be permanently removed from storage.`}
          onCancel={() => setDialog(null)} onConfirm={async () => { await doDelete(dialog.att); setDialog(null); }} />
      )}
      {dialog?.type === "tags" && (
        <TagsDialog att={dialog.att} onCancel={() => setDialog(null)}
          onSave={async (tags) => { try { setData(await setAttachmentTags(module, recordId, dialog.att.id, tags)); flash("Tags updated."); } catch (e) { flash((e as Error).message, "err"); } setDialog(null); }} />
      )}
      {dialog?.type === "versions" && (
        <VersionsModal att={dialog.att} writable={writable} onClose={() => setDialog(null)} onDownload={(v) => void doDownload(dialog.att, v)}
          onRestore={async (v) => { try { setData(await restoreAttachmentVersion(module, recordId, dialog.att.id, v)); flash(`Restored v${v}.`); } catch (e) { flash((e as Error).message, "err"); } setDialog(null); }} />
      )}
      {dialog?.type === "history" && <HistoryModal data={data} onClose={() => setDialog(null)} />}

      {/* Portal Actions menu — shared overlay system (never clipped; z-hierarchy,
          viewport flip/shift, single-open, keyboard nav, Esc). */}
      {menu && <Menu anchorEl={menu.anchorEl} items={buildMenuItems(menu.att)} onClose={() => setMenu(null)} />}
    </div>
  );
}

// ===========================================================================
// Sub-components
// ===========================================================================

function Stat({ icon, label }: { icon: IconName; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
      <Icon name={icon} size={14} className="text-slate-400" />
      <span className="font-medium">{label}</span>
    </span>
  );
}

function ActionIcon({ name, label, onClick, danger }: { name: IconName; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label}
      className={`rounded-md p-1.5 transition-colors ${danger ? "text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400" : "text-slate-400 hover:bg-slate-100 hover:text-brand dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-brand-light"}`}>
      <Icon name={name} size={16} />
    </button>
  );
}

function EmptyState({ writable, onUpload }: { writable: boolean; onUpload: () => void }) {
  return (
    <div onClick={writable ? onUpload : undefined} className={`flex flex-col items-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${writable ? "cursor-pointer border-slate-300 hover:border-brand dark:border-slate-700" : "border-slate-200 dark:border-slate-800"}`}>
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"><Icon name="folder" size={28} /></span>
      <p className="mt-3 text-base font-semibold text-slate-700 dark:text-slate-200">No documents yet</p>
      <p className="mt-1 max-w-xs text-sm text-slate-500 dark:text-slate-400">{writable ? "Drag & drop or upload supporting documents for this record." : "No documents have been uploaded for this record."}</p>
      <div className="mt-3 flex flex-wrap justify-center gap-1.5">
        {ACCEPTED_LABELS.map((t) => (<span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">{t}</span>))}
      </div>
      {writable && (
        <button className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark"><Icon name="upload" size={15} /> Upload First File</button>
      )}
    </div>
  );
}

function ModalShell({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return createPortal(
    <div className="fixed inset-0 z-[4000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className={`relative z-10 flex max-h-[88vh] w-full ${wide ? "max-w-3xl" : "max-w-md"} flex-col overflow-hidden rounded-2xl bg-white shadow-drawer animate-scale-in dark:bg-slate-900`}>{children}</div>
    </div>,
    document.body,
  );
}

function Btn({ children, onClick, primary }: { children: React.ReactNode; onClick?: () => void; primary?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${primary ? "bg-brand text-white hover:bg-brand-dark shadow-sm" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"}`}>
      {children}
    </button>
  );
}

function NameDialog({ title, initial, confirmLabel, onCancel, onConfirm }: { title: string; initial: string; confirmLabel: string; onCancel: () => void; onConfirm: (name: string) => void }) {
  const [value, setValue] = useState(initial);
  const trimmed = value.trim();
  return (
    <ModalShell onClose={onCancel}>
      <div className="p-6">
        <h3 className="text-base font-bold text-slate-900 dark:text-white">{title}</h3>
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && trimmed && onConfirm(trimmed)} className={`${inputClass} mt-3 w-full`} />
        <div className="mt-5 flex justify-end gap-2"><Btn onClick={onCancel}>Cancel</Btn><Btn primary onClick={() => trimmed && onConfirm(trimmed)}>{confirmLabel}</Btn></div>
      </div>
    </ModalShell>
  );
}

function ConfirmModal({ title, message, onCancel, onConfirm }: { title: string; message: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <ModalShell onClose={onCancel}>
      <div className="p-6">
        <div className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"><Icon name="trash" size={20} /></div>
        <h3 className="text-base font-bold text-slate-900 dark:text-white">{title}</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Btn onClick={onCancel}>Cancel</Btn>
          <button onClick={onConfirm} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-500/10"><Icon name="trash" size={15} /> Delete</button>
        </div>
      </div>
    </ModalShell>
  );
}

function TagsDialog({ att, onCancel, onSave }: { att: AttachmentMeta; onCancel: () => void; onSave: (tags: string[]) => void }) {
  const [tags, setTags] = useState<string[]>(att.tags);
  const [input, setInput] = useState("");
  const add = (t: string) => { const v = t.trim(); if (v && !tags.includes(v)) setTags((x) => [...x, v]); setInput(""); };
  return (
    <ModalShell onClose={onCancel}>
      <div className="p-6">
        <h3 className="text-base font-bold text-slate-900 dark:text-white">Tags — {att.name}</h3>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand dark:text-brand-light">
              {t}<button onClick={() => setTags((x) => x.filter((y) => y !== t))} className="hover:text-red-600"><Icon name="close" size={11} /></button>
            </span>
          ))}
          {tags.length === 0 && <span className="text-xs text-slate-400">No tags yet.</span>}
        </div>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add(input)} placeholder="Add a tag and press Enter" className={`${inputClass} mt-3 w-full text-sm`} />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {TAG_PRESETS.filter((p) => !tags.includes(p)).map((p) => (
            <button key={p} onClick={() => add(p)} className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-500 hover:border-brand hover:text-brand dark:border-slate-700 dark:text-slate-400">+ {p}</button>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2"><Btn onClick={onCancel}>Cancel</Btn><Btn primary onClick={() => onSave(tags)}>Save Tags</Btn></div>
      </div>
    </ModalShell>
  );
}

function VersionsModal({ att, writable, onClose, onDownload, onRestore }: { att: AttachmentMeta; writable: boolean; onClose: () => void; onDownload: (v: number) => void; onRestore: (v: number) => void }) {
  const rows = [...att.versions].sort((a, b) => b.version - a.version);
  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
        <h3 className="truncate text-base font-bold text-slate-900 dark:text-white">Versions — {att.name}</h3>
        <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><Icon name="close" /></button>
      </div>
      <div className="overflow-y-auto p-2">
        {rows.map((v) => {
          const when = fmtDateTime(v.uploadedAt);
          const current = v.version === att.version;
          return (
            <div key={v.version} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800">
              <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-slate-100 text-xs font-bold text-slate-500 dark:bg-slate-700 dark:text-slate-300">v{v.version}</span>
              <div className="min-w-0 flex-1 text-xs">
                <p className="font-medium text-slate-700 dark:text-slate-200">
                  {current && <span className="mr-1 rounded bg-emerald-50 px-1 text-[10px] text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">current</span>}
                  {formatSize(v.size)}
                </p>
                <p className="text-slate-400">{v.uploadedBy} · {when.date} {when.time}</p>
              </div>
              {writable && !current && <button onClick={() => onRestore(v.version)} className="rounded px-2 py-1 text-xs font-medium text-brand hover:bg-brand/10 dark:text-brand-light">Restore</button>}
              <ActionIcon name="download" label="Download" onClick={() => onDownload(v.version)} />
            </div>
          );
        })}
      </div>
    </ModalShell>
  );
}

const ACTION_TONE: Record<string, string> = {
  uploaded: "text-emerald-600 dark:text-emerald-400",
  replaced: "text-sky-600 dark:text-sky-400",
  renamed: "text-amber-600 dark:text-amber-400",
  tagged: "text-violet-600 dark:text-violet-400",
  restored: "text-brand dark:text-brand-light",
  downloaded: "text-slate-500 dark:text-slate-400",
  deleted: "text-red-600 dark:text-red-400",
};

function HistoryModal({ data, onClose }: { data: AttachmentListResponse | null; onClose: () => void }) {
  const history = data?.history ?? [];
  return (
    <ModalShell onClose={onClose} wide>
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
        <h3 className="text-base font-bold text-slate-900 dark:text-white">Audit History</h3>
        <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><Icon name="close" /></button>
      </div>
      <div className="overflow-y-auto">
        {history.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">No activity recorded yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs dark:bg-slate-800/80">
              <tr className="text-left text-slate-500 dark:text-slate-400">
                <th className="px-4 py-2 font-semibold">Action</th>
                <th className="px-4 py-2 font-semibold">File</th>
                <th className="px-4 py-2 font-semibold">User</th>
                <th className="px-4 py-2 font-semibold">Date</th>
                <th className="px-4 py-2 font-semibold">Time</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => {
                const when = fmtDateTime(h.at);
                return (
                  <tr key={h.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className={`px-4 py-2 font-medium capitalize ${ACTION_TONE[h.action] ?? "text-slate-600"}`}>{h.action}{h.detail ? <span className="ml-1 text-[11px] font-normal text-slate-400">{h.detail}</span> : null}</td>
                    <td className="max-w-[200px] truncate px-4 py-2 text-slate-700 dark:text-slate-200" title={h.file}>{h.file}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-600 dark:text-slate-300">{h.user}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-500 dark:text-slate-400">{when.date}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-500 dark:text-slate-400">{when.time}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </ModalShell>
  );
}

function PreviewModal({ module, recordId, att, onClose, onDownload }: { module: string; recordId: string; att: AttachmentMeta; onClose: () => void; onDownload: () => void }) {
  const kind = previewKindOf(att.ext);
  const url = fileUrl(module, recordId, att.id);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== "text") return;
    let cancelled = false;
    void fetch(url).then((r) => r.text()).then((t) => { if (!cancelled) setText(t.slice(0, 100_000)); }).catch(() => {});
    return () => { cancelled = true; };
  }, [url, kind]);

  return (
    <ModalShell onClose={onClose} wide>
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold text-slate-900 dark:text-white">{att.name}</h3>
          <p className="text-xs text-slate-400">{formatSize(att.size)} · v{att.version} · {att.uploadedBy}</p>
        </div>
        <div className="flex flex-none items-center gap-1">
          <ActionIcon name="download" label="Download" onClick={onDownload} />
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><Icon name="close" /></button>
        </div>
      </div>
      <div className="flex-1 overflow-auto bg-slate-50 dark:bg-slate-950">
        {kind === "pdf" && <iframe src={url} title={att.name} className="h-[70vh] w-full" />}
        {kind === "image" && <div className="flex h-full items-center justify-center p-4"><img src={url} alt={att.name} className="max-h-[70vh] max-w-full rounded" /></div>}
        {kind === "text" && <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap p-4 text-xs text-slate-700 dark:text-slate-300">{text ?? "Loading…"}</pre>}
        {kind === "none" && (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"><Icon name="file" size={26} /></span>
            <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">Preview not available for .{att.ext} files</p>
            <p className="mt-1 text-xs text-slate-400">Download to open it in its native application.</p>
            <button onClick={onDownload} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"><Icon name="download" size={15} /> Download</button>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
