/*
  Attachments — reusable document-management data layer.
  =====================================================
  UI is kept out of this file. The `AttachmentProvider` interface is the single
  seam: today the default is an IndexedDB provider (real files, in the browser,
  persisted across refreshes — per-browser until cloud storage exists). To go to
  Supabase Storage / S3 later, implement this same interface and swap `provider`
  below — NO change to AttachmentManager or any screen using it.

  Reusable across entities via (entityType, entityId): gl_account, customer,
  vendor, journal_entry, invoice, bill, payment, inventory_item, fixed_asset,
  employee, project…
*/

export type EntityType =
  | "gl_account"
  | "customer"
  | "vendor"
  | "journal_entry"
  | "invoice"
  | "bill"
  | "payment"
  | "inventory_item"
  | "fixed_asset"
  | "employee"
  | "project";

export type FileCategory = "pdf" | "excel" | "word" | "image" | "csv" | "zip" | "other";

export interface AttachmentVersion {
  version: number;
  size: number;
  uploadedBy: string;
  uploadedAt: string; // ISO
  blobKey: string;
}

export interface Attachment {
  id: string;
  entityType: EntityType;
  entityId: string;
  name: string;
  category: FileCategory;
  mime: string;
  size: number;
  folderId: string | null;
  description: string;
  version: number;
  uploadedBy: string;
  uploadedAt: string; // ISO
  modifiedBy: string;
  modifiedAt: string; // ISO
  history: AttachmentVersion[]; // previous versions (most recent last)
  blobKey: string; // current version blob key
}

export interface AttachmentFolder {
  id: string;
  entityType: EntityType;
  entityId: string;
  name: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Config (central — never hard-coded at call sites)
// ---------------------------------------------------------------------------

/** Acting user. Sourced from auth once it exists; single config point for now. */
export const CURRENT_USER = "Shrikar Moolya";

export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
export const ALLOWED_EXT = ["pdf", "doc", "docx", "xls", "xlsx", "csv", "png", "jpg", "jpeg", "zip"] as const;

export const CATEGORY_META: Record<FileCategory, { label: string; badge: string }> = {
  pdf: { label: "PDF", badge: "bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/25" },
  excel: { label: "Excel", badge: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/25" },
  word: { label: "Word", badge: "bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/25" },
  image: { label: "Image", badge: "bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/25" },
  csv: { label: "CSV", badge: "bg-teal-50 text-teal-700 ring-1 ring-teal-200 dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-500/25" },
  zip: { label: "ZIP", badge: "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/25" },
  other: { label: "Other", badge: "bg-slate-100 text-slate-600 ring-1 ring-slate-300 dark:bg-slate-700/50 dark:text-slate-300 dark:ring-slate-600" },
};

/** Type filters offered in the toolbar. */
export const CATEGORY_FILTERS: { key: FileCategory | "all"; label: string }[] = [
  { key: "all", label: "All Files" },
  { key: "pdf", label: "PDFs" },
  { key: "excel", label: "Excel" },
  { key: "image", label: "Images" },
  { key: "word", label: "Word" },
  { key: "other", label: "Other" },
];

/** Suggested folders offered when creating one. */
export const FOLDER_PRESETS = ["Invoices", "Contracts", "Tax Documents", "Audit", "Other"];

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

export function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

export function categoryOf(name: string): FileCategory {
  const ext = extOf(name);
  if (ext === "pdf") return "pdf";
  if (ext === "xls" || ext === "xlsx") return "excel";
  if (ext === "doc" || ext === "docx") return "word";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "image";
  if (ext === "csv") return "csv";
  if (ext === "zip") return "zip";
  return "other";
}

export function formatSize(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const n = bytes / Math.pow(1024, i);
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

export function validateFile(file: File): { ok: boolean; error?: string } {
  const ext = extOf(file.name);
  if (!(ALLOWED_EXT as readonly string[]).includes(ext)) {
    return { ok: false, error: `“${file.name}” — unsupported type (.${ext || "?"}).` };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: `“${file.name}” — exceeds ${formatSize(MAX_FILE_BYTES)}.` };
  }
  return { ok: true };
}

/** Preview support: what the app can render inline vs. download-only. */
export function previewKind(a: Attachment): "pdf" | "image" | "text" | "none" {
  if (a.category === "pdf") return "pdf";
  if (a.category === "image") return "image";
  if (a.category === "csv" || a.mime.startsWith("text/")) return "text";
  return "none";
}

// ---------------------------------------------------------------------------
// Provider interface (the swappable seam)
// ---------------------------------------------------------------------------

export interface UploadParams {
  entityType: EntityType;
  entityId: string;
  file: File;
  folderId: string | null;
  description: string;
  uploadedBy: string;
}
export interface UploadOptions {
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
}

export interface AttachmentProvider {
  list(entityType: EntityType, entityId: string): Promise<Attachment[]>;
  listFolders(entityType: EntityType, entityId: string): Promise<AttachmentFolder[]>;
  upload(params: UploadParams, opts?: UploadOptions): Promise<Attachment>;
  replace(id: string, file: File, modifiedBy: string, opts?: UploadOptions): Promise<Attachment>;
  rename(id: string, name: string): Promise<void>;
  setDescription(id: string, description: string): Promise<void>;
  move(id: string, folderId: string | null): Promise<void>;
  remove(id: string): Promise<void>;
  createFolder(entityType: EntityType, entityId: string, name: string): Promise<AttachmentFolder>;
  removeFolder(id: string): Promise<void>;
  getBlob(blobKey: string): Promise<Blob | null>;
  /** Stable reference for "Copy link" (a signed URL once cloud storage exists). */
  refFor(a: Attachment): string;
}

// ---------------------------------------------------------------------------
// IndexedDB provider (default — real files, per-browser)
// ---------------------------------------------------------------------------

const DB_NAME = "erp_attachments";
const STORE = { files: "files", folders: "folders", blobs: "blobs" } as const;

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is not available in this environment."));
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE.files)) d.createObjectStore(STORE.files, { keyPath: "id" });
        if (!d.objectStoreNames.contains(STORE.folders)) d.createObjectStore(STORE.folders, { keyPath: "id" });
        if (!d.objectStoreNames.contains(STORE.blobs)) d.createObjectStore(STORE.blobs, { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function reqP<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function getAll<T>(store: string): Promise<T[]> {
  const d = await openDb();
  return reqP(d.transaction(store).objectStore(store).getAll() as IDBRequest<T[]>);
}
async function getOne<T>(store: string, key: string): Promise<T | undefined> {
  const d = await openDb();
  return reqP(d.transaction(store).objectStore(store).get(key) as IDBRequest<T | undefined>);
}
async function putRow(store: string, value: unknown): Promise<void> {
  const d = await openDb();
  const tx = d.transaction(store, "readwrite");
  tx.objectStore(store).put(value);
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function delRow(store: string, key: string): Promise<void> {
  const d = await openDb();
  const tx = d.transaction(store, "readwrite");
  tx.objectStore(store).delete(key);
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${performance.now()}`;
}
function nowIso(): string {
  return new Date().toISOString();
}

/** Read a File to a Blob with progress + cancel (real progress bar / cancel). */
function readWithProgress(file: File, opts?: UploadOptions): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (e) => {
      if (e.lengthComputable) opts?.onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.onload = () => {
      opts?.onProgress?.(100);
      resolve(new Blob([reader.result as ArrayBuffer], { type: file.type || "application/octet-stream" }));
    };
    if (opts?.signal) {
      opts.signal.addEventListener("abort", () => {
        reader.abort();
        reject(new DOMException("Upload cancelled", "AbortError"));
      });
    }
    reader.readAsArrayBuffer(file);
  });
}

export const indexedDbProvider: AttachmentProvider = {
  async list(entityType, entityId) {
    const all = await getAll<Attachment>(STORE.files);
    return all
      .filter((a) => a.entityType === entityType && a.entityId === entityId)
      .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  },
  async listFolders(entityType, entityId) {
    const all = await getAll<AttachmentFolder>(STORE.folders);
    return all
      .filter((f) => f.entityType === entityType && f.entityId === entityId)
      .sort((a, b) => a.name.localeCompare(b.name));
  },
  async upload(params, opts) {
    const blob = await readWithProgress(params.file, opts);
    const id = uid();
    const blobKey = `${id}__v1`;
    await putRow(STORE.blobs, { key: blobKey, blob });
    const ts = nowIso();
    const att: Attachment = {
      id,
      entityType: params.entityType,
      entityId: params.entityId,
      name: params.file.name,
      category: categoryOf(params.file.name),
      mime: params.file.type || "",
      size: params.file.size,
      folderId: params.folderId,
      description: params.description,
      version: 1,
      uploadedBy: params.uploadedBy,
      uploadedAt: ts,
      modifiedBy: params.uploadedBy,
      modifiedAt: ts,
      history: [],
      blobKey,
    };
    await putRow(STORE.files, att);
    return att;
  },
  async replace(id, file, modifiedBy, opts) {
    const att = await getOne<Attachment>(STORE.files, id);
    if (!att) throw new Error("Attachment not found");
    const blob = await readWithProgress(file, opts);
    const newVersion = att.version + 1;
    const newKey = `${id}__v${newVersion}`;
    await putRow(STORE.blobs, { key: newKey, blob });
    const ts = nowIso();
    att.history.push({
      version: att.version,
      size: att.size,
      uploadedBy: att.modifiedBy,
      uploadedAt: att.modifiedAt,
      blobKey: att.blobKey,
    });
    att.version = newVersion;
    att.name = file.name;
    att.category = categoryOf(file.name);
    att.mime = file.type || "";
    att.size = file.size;
    att.modifiedBy = modifiedBy;
    att.modifiedAt = ts;
    att.blobKey = newKey;
    await putRow(STORE.files, att);
    return att;
  },
  async rename(id, name) {
    const att = await getOne<Attachment>(STORE.files, id);
    if (!att) return;
    att.name = name;
    att.category = categoryOf(name);
    att.modifiedAt = nowIso();
    await putRow(STORE.files, att);
  },
  async setDescription(id, description) {
    const att = await getOne<Attachment>(STORE.files, id);
    if (!att) return;
    att.description = description;
    att.modifiedAt = nowIso();
    await putRow(STORE.files, att);
  },
  async move(id, folderId) {
    const att = await getOne<Attachment>(STORE.files, id);
    if (!att) return;
    att.folderId = folderId;
    att.modifiedAt = nowIso();
    await putRow(STORE.files, att);
  },
  async remove(id) {
    const att = await getOne<Attachment>(STORE.files, id);
    if (att) {
      await delRow(STORE.blobs, att.blobKey);
      for (const v of att.history) await delRow(STORE.blobs, v.blobKey);
    }
    await delRow(STORE.files, id);
  },
  async createFolder(entityType, entityId, name) {
    const folder: AttachmentFolder = { id: uid(), entityType, entityId, name, createdAt: nowIso() };
    await putRow(STORE.folders, folder);
    return folder;
  },
  async removeFolder(id) {
    // Move any files in this folder back to "All" (folderId=null), then delete it.
    const all = await getAll<Attachment>(STORE.files);
    for (const a of all.filter((x) => x.folderId === id)) {
      a.folderId = null;
      await putRow(STORE.files, a);
    }
    await delRow(STORE.folders, id);
  },
  async getBlob(blobKey) {
    const row = await getOne<{ key: string; blob: Blob }>(STORE.blobs, blobKey);
    return row?.blob ?? null;
  },
  refFor(a) {
    return `attachment://${a.entityType}/${a.entityId}/${a.id}`;
  },
};

/**
 * The active provider. Swap this line for a Supabase Storage / S3 implementation
 * of AttachmentProvider to go live in the cloud — no UI changes required.
 */
export const provider: AttachmentProvider = indexedDbProvider;
