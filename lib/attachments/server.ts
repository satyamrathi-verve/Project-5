/*
  Document Management System — server-side filesystem store.
  ==========================================================
  The ONLY place that touches the disk. Physical files are written under
      <project>/storage/attachments/<module>/<recordId>/
  and per-record metadata (versions, tags, audit history) is persisted as a
  `_manifest.json` in that same folder. Nothing is ever written to the database.

  Import this ONLY from server code (route handlers). It uses node:fs.
*/

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { contentTypeFor, extOf, isKnownModule } from "./config";
import { ATTACHMENTS_DEMO, seedDemoForCode } from "./demo";
import type {
  AttachmentListResponse,
  AttachmentMeta,
  FolderStats,
  HistoryAction,
  HistoryEntry,
  RecordManifest,
} from "./types";

const STORAGE_ROOT = path.join(process.cwd(), "storage", "attachments");
const MANIFEST = "_manifest.json";
const HISTORY_CAP = 500;

/** Keep only filesystem-safe characters; never allow path traversal. */
function safeSegment(s: string): string {
  return (
    s
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^\.+/, "")
      .slice(0, 120) || "record"
  );
}

function recordDir(module: string, recordId: string): string {
  return path.join(STORAGE_ROOT, safeSegment(module), safeSegment(recordId));
}

function displayPath(module: string, recordId: string): string {
  return `/storage/attachments/${safeSegment(module)}/${safeSegment(recordId)}`;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function emptyManifest(module: string, recordId: string): RecordManifest {
  return { module, recordId, files: [], history: [] };
}

async function readManifest(module: string, recordId: string): Promise<RecordManifest> {
  const file = path.join(recordDir(module, recordId), MANIFEST);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as RecordManifest;
    parsed.files ??= [];
    parsed.history ??= [];
    return parsed;
  } catch {
    return emptyManifest(module, recordId);
  }
}

async function writeManifest(module: string, recordId: string, m: RecordManifest): Promise<void> {
  const dir = recordDir(module, recordId);
  await ensureDir(dir);
  await fs.writeFile(path.join(dir, MANIFEST), JSON.stringify(m, null, 2), "utf8");
}

function nowISO(): string {
  return new Date().toISOString();
}

function pushHistory(m: RecordManifest, action: HistoryAction, file: string, user: string, detail?: string): void {
  const entry: HistoryEntry = { id: `h_${randomUUID().slice(0, 8)}`, action, file, user, at: nowISO(), detail };
  m.history.unshift(entry);
  if (m.history.length > HISTORY_CAP) m.history.length = HISTORY_CAP;
}

function computeStats(m: RecordManifest): FolderStats {
  let totalBytes = 0;
  let last: string | null = null;
  const uploaders = new Set<string>();
  for (const f of m.files) {
    totalBytes += f.size;
    uploaders.add(f.uploadedBy);
    const t = f.modifiedAt || f.uploadedAt;
    if (!last || t > last) last = t;
  }
  return { count: m.files.length, totalBytes, lastUpdated: last, uploaders: [...uploaders] };
}

function toResponse(m: RecordManifest): AttachmentListResponse {
  return {
    module: m.module,
    recordId: m.recordId,
    storagePath: displayPath(m.module, m.recordId),
    files: m.files,
    history: m.history,
    stats: computeStats(m),
  };
}

function storedNameFor(id: string, version: number, ext: string): string {
  return `${id}__v${version}${ext ? "." + ext : ""}`;
}

// ── public API ────────────────────────────────────────────────────────────────

export function validModule(module: string): boolean {
  // Known modules are preferred, but any sanitized module string is accepted so
  // future modules work with zero config. Reject only path-hostile input.
  return isKnownModule(module) || /^[A-Za-z0-9._-]+$/.test(module);
}

async function manifestExists(module: string, recordId: string): Promise<boolean> {
  try {
    await fs.access(path.join(recordDir(module, recordId), MANIFEST));
    return true;
  } catch {
    return false;
  }
}

/**
 * Lazily seed realistic demo supporting documents the first time a GL account is
 * opened (only when it has no manifest yet — real uploads always win). Writes
 * real files + a manifest into the normal storage folder, so the rest of the DMS
 * treats them like any other attachments. Controlled by ATTACHMENTS_DEMO.
 */
async function maybeSeedDemo(module: string, recordId: string): Promise<void> {
  if (!ATTACHMENTS_DEMO || module !== "gl") return;
  if (await manifestExists(module, recordId)) return;
  const seed = await seedDemoForCode(recordId);
  if (!seed) return;
  const dir = recordDir(module, recordId);
  await ensureDir(dir);
  await Promise.all(seed.files.map((f) => fs.writeFile(path.join(dir, f.storedName), f.buffer)));
  await writeManifest(module, recordId, seed.manifest);
}

export async function listRecord(module: string, recordId: string): Promise<AttachmentListResponse> {
  await maybeSeedDemo(module, recordId);
  return toResponse(await readManifest(module, recordId));
}

export interface SaveArgs {
  module: string;
  recordId: string;
  fileName: string;
  buffer: Buffer;
  user: string;
  replaceId?: string | null;
  tags?: string[];
}

export async function saveUpload(args: SaveArgs): Promise<AttachmentListResponse> {
  const { module, recordId, fileName, buffer, user } = args;
  const dir = recordDir(module, recordId);
  await ensureDir(dir);
  const m = await readManifest(module, recordId);
  const ext = extOf(fileName);
  const contentType = contentTypeFor(ext);

  // Replace an existing file → new version of that logical file.
  let target: AttachmentMeta | undefined = args.replaceId
    ? m.files.find((f) => f.id === args.replaceId)
    : m.files.find((f) => f.name.toLowerCase() === fileName.toLowerCase());

  if (target) {
    const nextVersion = Math.max(...target.versions.map((v) => v.version)) + 1;
    const storedName = storedNameFor(target.id, nextVersion, ext);
    await fs.writeFile(path.join(dir, storedName), buffer);
    target.versions.push({ version: nextVersion, size: buffer.length, storedName, contentType, uploadedBy: user, uploadedAt: nowISO() });
    target.version = nextVersion;
    target.size = buffer.length;
    target.contentType = contentType;
    target.ext = ext;
    target.modifiedBy = user;
    target.modifiedAt = nowISO();
    pushHistory(m, args.replaceId ? "replaced" : "uploaded", target.name, user, `v${nextVersion}`);
  } else {
    const id = `att_${randomUUID().slice(0, 12)}`;
    const storedName = storedNameFor(id, 1, ext);
    await fs.writeFile(path.join(dir, storedName), buffer);
    const meta: AttachmentMeta = {
      id,
      name: fileName,
      ext,
      contentType,
      size: buffer.length,
      tags: args.tags ?? [],
      version: 1,
      versions: [{ version: 1, size: buffer.length, storedName, contentType, uploadedBy: user, uploadedAt: nowISO() }],
      uploadedBy: user,
      uploadedAt: nowISO(),
      modifiedBy: user,
      modifiedAt: nowISO(),
    };
    m.files.push(meta);
    pushHistory(m, "uploaded", fileName, user, "v1");
  }

  await writeManifest(module, recordId, m);
  return toResponse(m);
}

export async function renameFile(module: string, recordId: string, fileId: string, newName: string, user: string): Promise<AttachmentListResponse> {
  const m = await readManifest(module, recordId);
  const f = m.files.find((x) => x.id === fileId);
  if (f) {
    const old = f.name;
    // preserve the original extension so preview/content-type stays correct
    const keepExt = f.ext ? `.${f.ext}` : "";
    const base = newName.replace(/\.[^.]+$/, "");
    f.name = base + keepExt;
    f.modifiedBy = user;
    f.modifiedAt = nowISO();
    pushHistory(m, "renamed", f.name, user, `from “${old}”`);
    await writeManifest(module, recordId, m);
  }
  return toResponse(m);
}

export async function setTags(module: string, recordId: string, fileId: string, tags: string[], user: string): Promise<AttachmentListResponse> {
  const m = await readManifest(module, recordId);
  const f = m.files.find((x) => x.id === fileId);
  if (f) {
    f.tags = [...new Set(tags.map((t) => t.trim()).filter(Boolean))].slice(0, 12);
    f.modifiedBy = user;
    f.modifiedAt = nowISO();
    pushHistory(m, "tagged", f.name, user, f.tags.join(", "));
    await writeManifest(module, recordId, m);
  }
  return toResponse(m);
}

export async function restoreVersion(module: string, recordId: string, fileId: string, version: number, user: string): Promise<AttachmentListResponse> {
  const m = await readManifest(module, recordId);
  const f = m.files.find((x) => x.id === fileId);
  const v = f?.versions.find((x) => x.version === version);
  if (f && v) {
    f.version = version;
    f.size = v.size;
    f.contentType = v.contentType;
    f.modifiedBy = user;
    f.modifiedAt = nowISO();
    pushHistory(m, "restored", f.name, user, `to v${version}`);
    await writeManifest(module, recordId, m);
  }
  return toResponse(m);
}

export async function deleteFile(module: string, recordId: string, fileId: string, user: string): Promise<AttachmentListResponse> {
  const m = await readManifest(module, recordId);
  const idx = m.files.findIndex((x) => x.id === fileId);
  if (idx >= 0) {
    const f = m.files[idx];
    const dir = recordDir(module, recordId);
    await Promise.all(
      f.versions.map((v) => fs.rm(path.join(dir, v.storedName), { force: true }).catch(() => {})),
    );
    m.files.splice(idx, 1);
    pushHistory(m, "deleted", f.name, user);
    await writeManifest(module, recordId, m);
  }
  return toResponse(m);
}

export interface FilePayload {
  buffer: Buffer;
  contentType: string;
  name: string;
}

/** Read a file (a specific version, or the current one) for preview/download. */
export async function readFilePayload(
  module: string,
  recordId: string,
  fileId: string,
  version?: number,
): Promise<FilePayload | null> {
  const m = await readManifest(module, recordId);
  const f = m.files.find((x) => x.id === fileId);
  if (!f) return null;
  const v = f.versions.find((x) => x.version === (version ?? f.version)) ?? f.versions[f.versions.length - 1];
  if (!v) return null;
  try {
    const buffer = await fs.readFile(path.join(recordDir(module, recordId), v.storedName));
    return { buffer, contentType: v.contentType || f.contentType, name: f.name };
  } catch {
    return null;
  }
}

/** Record a download in the audit trail (called on explicit downloads). */
export async function recordDownload(module: string, recordId: string, fileId: string, user: string): Promise<void> {
  const m = await readManifest(module, recordId);
  const f = m.files.find((x) => x.id === fileId);
  if (f) {
    pushHistory(m, "downloaded", f.name, user);
    await writeManifest(module, recordId, m);
  }
}
