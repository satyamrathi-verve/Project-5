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
  // record lifecycle
  | "created"
  | "updated" // a single field change (field/oldValue/newValue set)
  | "status_changed"
  | "deleted"
  | "restored"
  | "relationship_changed"
  | "viewed"
  // notes
  | "note_added"
  | "note_updated"
  | "note_deleted"
  // attachments (sourced from the DMS audit history)
  | "attachment_uploaded"
  | "attachment_downloaded"
  | "attachment_deleted"
  | "attachment_replaced"
  | "attachment_renamed"
  | "attachment_tagged"
  | "attachment_restored"
  // system
  | "imported"
  | "exported"
  | "printed"
  | "version";

export type ActivityCategory = "modification" | "notes" | "attachments" | "system";

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
