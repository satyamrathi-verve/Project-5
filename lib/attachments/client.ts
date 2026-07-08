/*
  Document Management System — client API wrapper.
  ================================================
  Thin browser-side client over the DMS route handlers. Uploads use XHR so the UI
  gets real progress events, cancellation (AbortSignal) and retry. Every request
  carries the current signed-in user (front-end auth gate) + a write-capability
  flag, which the server enforces for upload/rename/replace/delete.
*/

import { getSession } from "@/lib/auth";
import type { AttachmentListResponse } from "./types";

/** Users listed here are read-only (view + download only). Empty by default. */
const VIEWER_USERS: string[] = [];

export function currentUserName(): string {
  return getSession()?.name ?? "Guest";
}

/** Whether the signed-in user may upload / rename / replace / delete. */
export function userCanWrite(): boolean {
  const s = getSession();
  if (!s) return false;
  return !VIEWER_USERS.includes(s.username);
}

function authHeaders(): Record<string, string> {
  return { "x-user-name": currentUserName(), "x-can-write": userCanWrite() ? "1" : "0" };
}

const base = (module: string, recordId: string) =>
  `/api/attachments/${encodeURIComponent(module)}/${encodeURIComponent(recordId)}`;

export async function listAttachments(module: string, recordId: string): Promise<AttachmentListResponse> {
  const res = await fetch(base(module, recordId), { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to load attachments");
  return res.json();
}

export interface UploadOptions {
  replaceId?: string | null;
  tags?: string[];
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
}

/** Upload one file with progress + cancellation. Resolves to the fresh listing. */
export function uploadAttachment(
  module: string,
  recordId: string,
  file: File,
  opts: UploadOptions = {},
): Promise<AttachmentListResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", base(module, recordId));
    const headers = authHeaders();
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && opts.onProgress) opts.onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Bad server response"));
        }
      } else {
        let msg = "Upload failed";
        try {
          msg = JSON.parse(xhr.responseText).error ?? msg;
        } catch {
          /* ignore */
        }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(Object.assign(new Error("Upload cancelled"), { name: "AbortError" }));

    if (opts.signal) {
      if (opts.signal.aborted) {
        xhr.abort();
        return;
      }
      opts.signal.addEventListener("abort", () => xhr.abort());
    }

    const form = new FormData();
    form.append("file", file);
    if (opts.replaceId) form.append("replaceId", opts.replaceId);
    if (opts.tags?.length) form.append("tags", opts.tags.join(","));
    xhr.send(form);
  });
}

/** URL for previewing (inline) or downloading a file / a specific version. */
export function fileUrl(
  module: string,
  recordId: string,
  fileId: string,
  opts: { version?: number; download?: boolean } = {},
): string {
  const qs = new URLSearchParams();
  if (opts.version) qs.set("v", String(opts.version));
  if (opts.download) qs.set("download", "1");
  const q = qs.toString();
  return `${base(module, recordId)}/${encodeURIComponent(fileId)}${q ? `?${q}` : ""}`;
}

async function patch(module: string, recordId: string, fileId: string, body: unknown): Promise<AttachmentListResponse> {
  const res = await fetch(`${base(module, recordId)}/${encodeURIComponent(fileId)}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Request failed");
  return res.json();
}

export function renameAttachment(module: string, recordId: string, fileId: string, name: string) {
  return patch(module, recordId, fileId, { action: "rename", name });
}
export function setAttachmentTags(module: string, recordId: string, fileId: string, tags: string[]) {
  return patch(module, recordId, fileId, { action: "tags", tags });
}
export function restoreAttachmentVersion(module: string, recordId: string, fileId: string, version: number) {
  return patch(module, recordId, fileId, { action: "restore", version });
}

export async function deleteAttachment(module: string, recordId: string, fileId: string): Promise<AttachmentListResponse> {
  const res = await fetch(`${base(module, recordId)}/${encodeURIComponent(fileId)}`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Delete failed");
  return res.json();
}

/** Download a file as a blob (sends the user so the audit trail is accurate). */
export async function downloadAttachment(
  module: string,
  recordId: string,
  fileId: string,
  name: string,
  version?: number,
): Promise<void> {
  const res = await fetch(fileUrl(module, recordId, fileId, { version, download: true }), { headers: authHeaders() });
  if (!res.ok) throw new Error("Download failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Absolute link to the file (for Copy Link). */
export function absoluteFileUrl(module: string, recordId: string, fileId: string): string {
  return typeof window !== "undefined" ? window.location.origin + fileUrl(module, recordId, fileId) : fileUrl(module, recordId, fileId);
}
