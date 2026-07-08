/*
  Document Management System — shared types (client + server).
  ============================================================
  These describe the METADATA the DMS stores on disk (in a per-record
  `_manifest.json`) alongside the physical files. No binary ever lives in the
  database; only these records — Record ID, Module, File Name, Storage Path,
  Uploaded By, Uploaded Date, Version, File Size, Content Type — are persisted,
  as JSON in the application storage directory.
*/

/** One stored version of a file (versioning never overwrites). */
export interface AttachmentVersion {
  version: number;
  size: number;
  storedName: string; // physical file name on disk (server-generated, safe)
  contentType: string;
  uploadedBy: string;
  uploadedAt: string; // ISO
}

/** A logical attachment (its display name + the chain of versions). */
export interface AttachmentMeta {
  id: string;
  name: string; // display file name incl. extension
  ext: string;
  contentType: string;
  size: number; // size of the current version
  /** Short human description of the document (optional). */
  description?: string | null;
  tags: string[];
  version: number; // current version pointer
  versions: AttachmentVersion[];
  uploadedBy: string; // original uploader
  uploadedAt: string; // first upload ISO
  modifiedBy: string;
  modifiedAt: string;
}

export type HistoryAction = "uploaded" | "replaced" | "renamed" | "deleted" | "downloaded" | "tagged" | "restored";

/** One audit-trail entry for the record's document folder. */
export interface HistoryEntry {
  id: string;
  action: HistoryAction;
  file: string;
  user: string;
  at: string; // ISO
  detail?: string;
}

/** Folder-level statistics shown above the grid. */
export interface FolderStats {
  count: number;
  totalBytes: number;
  lastUpdated: string | null; // ISO
  uploaders: string[];
}

/** The full on-disk manifest for one record folder. */
export interface RecordManifest {
  module: string;
  recordId: string;
  files: AttachmentMeta[];
  history: HistoryEntry[];
}

/** What the list endpoint returns to the UI. */
export interface AttachmentListResponse {
  module: string;
  recordId: string;
  storagePath: string; // display path e.g. /storage/attachments/gl/1000
  files: AttachmentMeta[];
  history: HistoryEntry[];
  stats: FolderStats;
}
