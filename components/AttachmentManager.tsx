"use client";

/*
  AttachmentManager — reusable, entity-agnostic document manager.
  ==============================================================
  Drop into ANY screen with <AttachmentManager entityType="…" entityId={id} />.
  All storage goes through the `provider` in lib/attachments.ts (IndexedDB today,
  Supabase Storage later — no change here). UI only; no business logic lives here.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons";
import { inputClass } from "./FormField";
import {
  provider,
  CURRENT_USER,
  CATEGORY_META,
  CATEGORY_FILTERS,
  FOLDER_PRESETS,
  MAX_FILE_BYTES,
  ALLOWED_EXT,
  formatSize,
  validateFile,
  previewKind,
  type Attachment,
  type AttachmentFolder,
  type EntityType,
  type FileCategory,
} from "@/lib/attachments";

type SortKey = "name" | "date" | "size" | "uploader";
type Dialog =
  | { type: "preview"; att: Attachment }
  | { type: "history"; att: Attachment }
  | { type: "move"; att: Attachment }
  | { type: "rename"; att: Attachment }
  | { type: "delete"; att: Attachment }
  | { type: "createFolder" }
  | null;

interface UploadTask {
  id: string;
  name: string;
  pct: number;
  status: "uploading" | "error";
  error?: string;
  controller: AbortController;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// small local button primitives (self-contained so this component is portable)
function TBtn({ children, onClick, primary, title }: { children: React.ReactNode; onClick?: () => void; primary?: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        primary
          ? "bg-brand text-white hover:bg-brand-dark shadow-sm"
          : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
      }`}
    >
      {children}
    </button>
  );
}

function ActionIcon({ name, label, onClick, danger }: { name: IconName; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`rounded-md p-1.5 transition-colors ${
        danger
          ? "text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
          : "text-slate-400 hover:bg-slate-100 hover:text-brand dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-brand-light"
      }`}
    >
      <Icon name={name} size={16} />
    </button>
  );
}

export function AttachmentManager({
  entityType,
  entityId,
  currentUser = CURRENT_USER,
}: {
  entityType: EntityType;
  entityId: string;
  currentUser?: string;
}) {
  const [files, setFiles] = useState<Attachment[]>([]);
  const [folders, setFolders] = useState<AttachmentFolder[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<FileCategory | "all">("all");
  const [folderFilter, setFolderFilter] = useState<string>("all"); // "all" | folderId
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [uploads, setUploads] = useState<UploadTask[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dragOver, setDragOver] = useState(false);
  const [note, setNote] = useState<{ msg: string; tone: "ok" | "err" } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<Attachment | null>(null);

  const flash = useCallback((msg: string, tone: "ok" | "err" = "ok") => {
    setNote({ msg, tone });
    setTimeout(() => setNote(null), 3200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [f, d] = await Promise.all([provider.list(entityType, entityId), provider.listFolders(entityType, entityId)]);
      setFiles(f);
      setFolders(d);
    } catch {
      /* storage unavailable */
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  // ---- uploads -------------------------------------------------------------
  const uploadOne = useCallback(
    async (file: File) => {
      const v = validateFile(file);
      if (!v.ok) {
        flash(v.error ?? "Unsupported file.", "err");
        return;
      }
      const taskId = crypto.randomUUID();
      const controller = new AbortController();
      setUploads((u) => [...u, { id: taskId, name: file.name, pct: 0, status: "uploading", controller }]);
      try {
        await provider.upload(
          {
            entityType,
            entityId,
            file,
            folderId: folderFilter === "all" ? null : folderFilter,
            description: "",
            uploadedBy: currentUser,
          },
          {
            signal: controller.signal,
            onProgress: (pct) => setUploads((u) => u.map((t) => (t.id === taskId ? { ...t, pct } : t))),
          },
        );
        setUploads((u) => u.filter((t) => t.id !== taskId));
        await refresh();
      } catch (e) {
        const err = e as Error;
        if (err.name === "AbortError") setUploads((u) => u.filter((t) => t.id !== taskId));
        else setUploads((u) => u.map((t) => (t.id === taskId ? { ...t, status: "error", error: err.message } : t)));
      }
    },
    [entityType, entityId, currentUser, folderFilter, refresh, flash],
  );

  const handleFiles = useCallback(
    (list: FileList | File[] | null) => {
      if (!list) return;
      for (const file of Array.from(list)) void uploadOne(file);
    },
    [uploadOne],
  );

  // ---- actions -------------------------------------------------------------
  const doDownload = useCallback(async (blobKey: string, name: string) => {
    const blob = await provider.getBlob(blobKey);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const copyLink = useCallback(
    async (att: Attachment) => {
      try {
        await navigator.clipboard.writeText(provider.refFor(att));
        flash("Reference copied. Public share links activate with cloud storage.");
      } catch {
        flash("Couldn't copy to clipboard.", "err");
      }
    },
    [flash],
  );

  // ---- derived -------------------------------------------------------------
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = files.filter((a) => {
      if (folderFilter !== "all" && a.folderId !== folderFilter) return false;
      if (catFilter !== "all" && a.category !== catFilter) return false;
      if (q) {
        const hay = `${a.name} ${a.description} ${a.uploadedBy}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    rows = [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "size") cmp = a.size - b.size;
      else if (sortKey === "uploader") cmp = a.uploadedBy.localeCompare(b.uploadedBy);
      else cmp = a.uploadedAt.localeCompare(b.uploadedAt);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [files, search, folderFilter, catFilter, sortKey, sortDir]);

  const folderCount = useCallback((id: string) => files.filter((a) => a.folderId === id).length, [files]);

  // ---- drag & drop ---------------------------------------------------------
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const acceptAttr = ALLOWED_EXT.map((x) => `.${x}`).join(",");

  return (
    <div
      className="flex flex-col gap-3"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {/* hidden inputs */}
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={acceptAttr}
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={replaceInput}
        type="file"
        accept={acceptAttr}
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          const target = replaceTarget.current;
          e.target.value = "";
          if (!file || !target) return;
          try {
            await provider.replace(target.id, file, currentUser);
            await refresh();
            flash(`Replaced — now v${target.version + 1}.`);
          } catch {
            flash("Replace failed.", "err");
          }
        }}
      />

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <TBtn primary onClick={() => fileInput.current?.click()}>
          <Icon name="upload" size={15} /> Upload Files
        </TBtn>
        <TBtn onClick={() => setDialog({ type: "createFolder" })}>
          <Icon name="folder" size={15} /> Create Folder
        </TBtn>
        <div className="relative ml-auto min-w-[10rem] flex-1">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">
            <Icon name="search" size={15} />
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search attachments…"
            className={`${inputClass} w-full py-1.5 pl-8 text-sm`}
          />
        </div>
      </div>

      {/* filter + sort */}
      <div className="flex flex-wrap items-center gap-1.5">
        {CATEGORY_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setCatFilter(f.key)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition ${
              catFilter === f.key
                ? "bg-brand/10 text-brand ring-brand/30 dark:text-brand-light"
                : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700 dark:hover:bg-slate-700"
            }`}
          >
            {f.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className={`${inputClass} py-1 text-xs`}
            title="Sort by"
          >
            <option value="name">Name</option>
            <option value="date">Uploaded Date</option>
            <option value="size">Size</option>
            <option value="uploader">Uploaded By</option>
          </select>
          <button
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            title={sortDir === "asc" ? "Ascending" : "Descending"}
            className="rounded-md border border-slate-300 p-1.5 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-700"
          >
            <span className="text-[11px]">{sortDir === "asc" ? "▲" : "▼"}</span>
          </button>
        </div>
      </div>

      {/* folder chips */}
      {folders.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <FolderChip label="All Files" active={folderFilter === "all"} onClick={() => setFolderFilter("all")} count={files.length} />
          {folders.map((f) => (
            <FolderChip key={f.id} label={f.name} active={folderFilter === f.id} onClick={() => setFolderFilter(f.id)} count={folderCount(f.id)} onDelete={async () => {
              await provider.removeFolder(f.id);
              if (folderFilter === f.id) setFolderFilter("all");
              await refresh();
            }} />
          ))}
        </div>
      )}

      {/* uploads in progress */}
      {uploads.length > 0 && (
        <div className="space-y-1.5">
          {uploads.map((t) => (
            <div key={t.id} className="rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-800">
              <div className="flex items-center gap-2 text-xs">
                <Icon name="upload" size={13} className={t.status === "error" ? "text-red-500" : "text-brand"} />
                <span className="truncate font-medium text-slate-700 dark:text-slate-200">{t.name}</span>
                <span className="ml-auto text-slate-400">{t.status === "error" ? "Failed" : `${t.pct}%`}</span>
                <button
                  onClick={() => {
                    t.controller.abort();
                    setUploads((u) => u.filter((x) => x.id !== t.id));
                  }}
                  className="rounded p-0.5 text-slate-400 hover:text-red-600"
                  title="Cancel"
                >
                  <Icon name="close" size={13} />
                </button>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                <div className={`h-full rounded-full ${t.status === "error" ? "bg-red-500" : "bg-brand"}`} style={{ width: `${t.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* list / empty state / dropzone */}
      {loading ? (
        <div className="rounded-xl border border-slate-200 py-10 text-center text-sm text-slate-400 dark:border-slate-700">Loading…</div>
      ) : visible.length === 0 && files.length === 0 ? (
        <EmptyState dragOver={dragOver} onUpload={() => fileInput.current?.click()} />
      ) : (
        <>
          <div
            onClick={() => fileInput.current?.click()}
            className={`cursor-pointer rounded-xl border border-dashed py-2.5 text-center text-xs transition ${
              dragOver ? "border-brand bg-brand/5 text-brand" : "border-slate-300 text-slate-400 hover:border-brand hover:text-brand dark:border-slate-700"
            }`}
          >
            Drop files here or click to upload
          </div>
          {visible.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">No attachments match your filters.</p>
          ) : (
            <ul className="space-y-2">
              {visible.map((a) => (
                <li key={a.id} className="relative rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/50">
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-lg ${CATEGORY_META[a.category].badge}`}>
                      <Icon name="file" size={17} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setDialog({ type: "preview", att: a })}
                          className="truncate text-left text-sm font-semibold text-slate-800 hover:text-brand hover:underline dark:text-slate-100 dark:hover:text-brand-light"
                          title={a.name}
                        >
                          {a.name}
                        </button>
                        <span className={`flex-none rounded px-1.5 py-0.5 text-[10px] font-medium ${CATEGORY_META[a.category].badge}`}>
                          {CATEGORY_META[a.category].label}
                        </span>
                        {a.version > 1 && <span className="flex-none rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">v{a.version}</span>}
                      </div>
                      {a.description && <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{a.description}</p>}
                      <p className="mt-1 text-[11px] text-slate-400">
                        {formatSize(a.size)} · {a.uploadedBy} · {fmtDate(a.uploadedAt)}
                      </p>
                    </div>
                    <div className="flex flex-none items-center gap-0.5">
                      <ActionIcon name="eye" label="View" onClick={() => setDialog({ type: "preview", att: a })} />
                      <ActionIcon name="download" label="Download" onClick={() => void doDownload(a.blobKey, a.name)} />
                      <div className="relative">
                        <ActionIcon name="dots" label="More" onClick={() => setMenuFor((m) => (m === a.id ? null : a.id))} />
                        {menuFor === a.id && (
                          <>
                            <span className="fixed inset-0 z-20" onClick={() => setMenuFor(null)} />
                            <div className="absolute right-0 top-8 z-30 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-soft dark:border-slate-700 dark:bg-slate-800">
                              {[
                                { icon: "pencil" as IconName, label: "Rename", fn: () => setDialog({ type: "rename", att: a }) },
                                { icon: "upload" as IconName, label: "Replace", fn: () => { replaceTarget.current = a; replaceInput.current?.click(); } },
                                { icon: "folder" as IconName, label: "Move", fn: () => setDialog({ type: "move", att: a }) },
                                { icon: "link" as IconName, label: "Copy Link", fn: () => void copyLink(a) },
                                { icon: "clock" as IconName, label: "Version History", fn: () => setDialog({ type: "history", att: a }) },
                              ].map((it) => (
                                <button
                                  key={it.label}
                                  onClick={() => { setMenuFor(null); it.fn(); }}
                                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                                >
                                  <Icon name={it.icon} size={14} /> {it.label}
                                </button>
                              ))}
                              <button
                                onClick={() => { setMenuFor(null); setDialog({ type: "delete", att: a }); }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                              >
                                <Icon name="trash" size={14} /> Delete
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* local toast */}
      {note && (
        <div className={`fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-soft ${note.tone === "ok" ? "bg-slate-900 dark:bg-slate-700" : "bg-red-600"}`}>
          {note.msg}
        </div>
      )}

      {/* dialogs (portaled) */}
      {dialog?.type === "createFolder" && (
        <NameDialog
          title="Create folder"
          placeholder="Folder name"
          presets={FOLDER_PRESETS.filter((p) => !folders.some((f) => f.name.toLowerCase() === p.toLowerCase()))}
          confirmLabel="Create"
          onCancel={() => setDialog(null)}
          onConfirm={async (name) => {
            await provider.createFolder(entityType, entityId, name);
            setDialog(null);
            await refresh();
          }}
        />
      )}
      {dialog?.type === "rename" && (
        <NameDialog
          title="Rename file"
          placeholder="File name"
          initial={dialog.att.name}
          confirmLabel="Save"
          onCancel={() => setDialog(null)}
          onConfirm={async (name) => {
            await provider.rename(dialog.att.id, name);
            setDialog(null);
            await refresh();
          }}
        />
      )}
      {dialog?.type === "move" && (
        <MoveDialog
          folders={folders}
          current={dialog.att.folderId}
          onCancel={() => setDialog(null)}
          onConfirm={async (folderId) => {
            await provider.move(dialog.att.id, folderId);
            setDialog(null);
            await refresh();
          }}
        />
      )}
      {dialog?.type === "delete" && (
        <ConfirmModal
          title="Delete attachment?"
          message={`“${dialog.att.name}” and its version history will be permanently removed from this browser.`}
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            await provider.remove(dialog.att.id);
            setDialog(null);
            await refresh();
          }}
        />
      )}
      {dialog?.type === "history" && (
        <HistoryModal att={dialog.att} onClose={() => setDialog(null)} onDownload={doDownload} />
      )}
      {dialog?.type === "preview" && <PreviewModal att={dialog.att} onClose={() => setDialog(null)} onDownload={doDownload} />}
    </div>
  );
}

// ===========================================================================
// Sub-components
// ===========================================================================

function FolderChip({ label, active, onClick, count, onDelete }: { label: string; active: boolean; onClick: () => void; count: number; onDelete?: () => void }) {
  return (
    <span className={`group inline-flex items-center gap-1 rounded-full py-1 pl-2.5 pr-1.5 text-xs font-medium ring-1 transition ${active ? "bg-brand/10 text-brand ring-brand/30 dark:text-brand-light" : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700"}`}>
      <button onClick={onClick} className="inline-flex items-center gap-1">
        <Icon name="folder" size={12} /> {label}
        <span className="text-[10px] opacity-70">{count}</span>
      </button>
      {onDelete && (
        <button onClick={onDelete} title="Delete folder" className="rounded-full p-0.5 opacity-0 transition group-hover:opacity-100 hover:text-red-600">
          <Icon name="close" size={11} />
        </button>
      )}
    </span>
  );
}

function EmptyState({ dragOver, onUpload }: { dragOver: boolean; onUpload: () => void }) {
  return (
    <div
      onClick={onUpload}
      className={`flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
        dragOver ? "border-brand bg-brand/5" : "border-slate-300 hover:border-brand dark:border-slate-700"
      }`}
    >
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
        <Icon name="folder" size={28} />
      </span>
      <p className="mt-3 text-base font-semibold text-slate-700 dark:text-slate-200">No Documents Yet</p>
      <p className="mt-1 max-w-xs text-sm text-slate-500 dark:text-slate-400">
        Upload supporting documents for this General Ledger account.
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-1.5">
        {["PDF", "Excel", "Word", "Images", "CSV", "ZIP"].map((t) => (
          <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {t}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">Maximum file size: {formatSize(MAX_FILE_BYTES)}</p>
      <button className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark">
        <Icon name="upload" size={15} /> Upload First File
      </button>
    </div>
  );
}

function ModalShell({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return createPortal(
    <div className="fixed inset-0 z-[65] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className={`relative z-10 flex max-h-[88vh] w-full ${wide ? "max-w-3xl" : "max-w-sm"} flex-col overflow-hidden rounded-2xl bg-white shadow-drawer animate-scale-in dark:bg-slate-900`}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function NameDialog({
  title,
  placeholder,
  initial = "",
  presets,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  placeholder: string;
  initial?: string;
  presets?: string[];
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const trimmed = value.trim();
  return (
    <ModalShell onClose={onCancel}>
      <div className="p-6">
        <h3 className="text-base font-bold text-slate-900 dark:text-white">{title}</h3>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && trimmed && onConfirm(trimmed)}
          placeholder={placeholder}
          className={`${inputClass} mt-3 w-full`}
        />
        {presets && presets.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button key={p} onClick={() => setValue(p)} className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-500 hover:border-brand hover:text-brand dark:border-slate-700 dark:text-slate-400">
                {p}
              </button>
            ))}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <TBtn onClick={onCancel}>Cancel</TBtn>
          <TBtn primary onClick={() => trimmed && onConfirm(trimmed)}>{confirmLabel}</TBtn>
        </div>
      </div>
    </ModalShell>
  );
}

function MoveDialog({ folders, current, onCancel, onConfirm }: { folders: AttachmentFolder[]; current: string | null; onCancel: () => void; onConfirm: (folderId: string | null) => void }) {
  const [sel, setSel] = useState<string | null>(current);
  return (
    <ModalShell onClose={onCancel}>
      <div className="p-6">
        <h3 className="text-base font-bold text-slate-900 dark:text-white">Move to folder</h3>
        <div className="mt-3 max-h-64 space-y-1 overflow-y-auto">
          {[{ id: null as string | null, name: "All Files (no folder)" }, ...folders].map((f) => (
            <button
              key={f.id ?? "none"}
              onClick={() => setSel(f.id)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${sel === f.id ? "bg-brand/10 text-brand dark:text-brand-light" : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"}`}
            >
              <Icon name="folder" size={15} /> {f.name}
              {sel === f.id && <Icon name="check" size={14} className="ml-auto" />}
            </button>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <TBtn onClick={onCancel}>Cancel</TBtn>
          <TBtn primary onClick={() => onConfirm(sel)}>Move</TBtn>
        </div>
      </div>
    </ModalShell>
  );
}

function ConfirmModal({ title, message, onCancel, onConfirm }: { title: string; message: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <ModalShell onClose={onCancel}>
      <div className="p-6">
        <div className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400">
          <Icon name="trash" size={20} />
        </div>
        <h3 className="text-base font-bold text-slate-900 dark:text-white">{title}</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <TBtn onClick={onCancel}>Cancel</TBtn>
          <button onClick={onConfirm} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-500/10">
            <Icon name="trash" size={15} /> Delete
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function HistoryModal({ att, onClose, onDownload }: { att: Attachment; onClose: () => void; onDownload: (blobKey: string, name: string) => void }) {
  const rows = [
    ...att.history.map((v) => ({ ...v, current: false })),
    { version: att.version, size: att.size, uploadedBy: att.modifiedBy, uploadedAt: att.modifiedAt, blobKey: att.blobKey, current: true },
  ].sort((a, b) => b.version - a.version);
  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
        <h3 className="text-base font-bold text-slate-900 dark:text-white">Version history</h3>
        <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><Icon name="close" /></button>
      </div>
      <div className="overflow-y-auto p-2">
        {rows.map((v) => (
          <div key={v.version} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-xs font-bold text-slate-500 dark:bg-slate-700 dark:text-slate-300">v{v.version}</span>
            <div className="min-w-0 flex-1 text-xs">
              <p className="font-medium text-slate-700 dark:text-slate-200">
                {v.current && <span className="mr-1 rounded bg-emerald-50 px-1 text-[10px] text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">current</span>}
                {formatSize(v.size)}
              </p>
              <p className="text-slate-400">{v.uploadedBy} · {fmtDate(v.uploadedAt)}</p>
            </div>
            <ActionIcon name="download" label="Download" onClick={() => onDownload(v.blobKey, att.name)} />
          </div>
        ))}
      </div>
    </ModalShell>
  );
}

function PreviewModal({ att, onClose, onDownload }: { att: Attachment; onClose: () => void; onDownload: (blobKey: string, name: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const kind = previewKind(att);

  useEffect(() => {
    let objUrl: string | null = null;
    let cancelled = false;
    void provider.getBlob(att.blobKey).then(async (blob) => {
      if (!blob || cancelled) return;
      if (kind === "text") setText((await blob.text()).slice(0, 100000));
      else {
        objUrl = URL.createObjectURL(blob);
        setUrl(objUrl);
      }
    });
    return () => {
      cancelled = true;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [att.blobKey, kind]);

  return (
    <ModalShell onClose={onClose} wide>
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold text-slate-900 dark:text-white">{att.name}</h3>
          <p className="text-xs text-slate-400">{CATEGORY_META[att.category].label} · {formatSize(att.size)} · v{att.version}</p>
        </div>
        <div className="flex flex-none items-center gap-1">
          <ActionIcon name="download" label="Download" onClick={() => onDownload(att.blobKey, att.name)} />
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><Icon name="close" /></button>
        </div>
      </div>
      <div className="flex-1 overflow-auto bg-slate-50 dark:bg-slate-950">
        {kind === "pdf" && url && <iframe src={url} title={att.name} className="h-[70vh] w-full" />}
        {kind === "image" && url && <div className="flex h-full items-center justify-center p-4"><img src={url} alt={att.name} className="max-h-[70vh] max-w-full rounded" /></div>}
        {kind === "text" && (
          <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap p-4 text-xs text-slate-700 dark:text-slate-300">{text ?? "Loading…"}</pre>
        )}
        {kind === "none" && (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"><Icon name="file" size={26} /></span>
            <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">Preview not available for {CATEGORY_META[att.category].label} files</p>
            <p className="mt-1 text-xs text-slate-400">Download the file to view it in its native application.</p>
            <button onClick={() => onDownload(att.blobKey, att.name)} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
              <Icon name="download" size={15} /> Download
            </button>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
