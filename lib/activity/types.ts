/*
  Activity Center — shared types.
  ===============================
  One normalized event shape for EVERY kind of record activity across the ERP:
  creation/modification, field changes, status changes, notes, attachment
  upload/download/delete, import/export, print, relationship changes and version
  info. The reusable <ActivityCenter/> renders these; every module logs into the
  same store, so the timeline is consistent everywhere.
*/

export type ActivityAction =
  // ── Record Changes — changes to the master record itself ──
  | "created"
  | "updated" // a single field change (field/oldValue/newValue set)
  | "status_changed"
  | "deleted"
  | "restored"
  | "relationship_changed"
  // ── System Events — automatic application events ──
  | "imported"
  | "exported"
  | "printed"
  | "numbered" // auto numbering
  | "validated" // background validation
  | "recalculated" // balance recalculation
  | "synchronized" // synchronization
  | "migrated" // data migration
  | "version";

/**
 * Exactly two visible categories (plus "All"): the record's own changes, and
 * automatic system events. Attachments and Notes are deliberately NOT here —
 * they have dedicated tabs, so the Activity Center never duplicates them.
 */
export type ActivityCategory = "record" | "system";

export interface ActivityEvent {
  id: string;
  module: string;
  recordId: string;
  at: string; // ISO date-time
  user: string; // captured automatically from the signed-in session
  context: string; // record label / sub-area the event happened in
  action: ActivityAction;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  reason?: string | null;
  /** Where the event came from (local change log vs the DMS attachment history). */
  source?: "local" | "attachments";
}

/** The input callers pass to logActivity — id/at/user/source are filled in for them. */
export type ActivityInput = Omit<ActivityEvent, "id" | "at" | "user" | "source"> & { user?: string; at?: string };
