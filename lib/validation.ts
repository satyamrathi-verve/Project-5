/*
  Shared field rules, so a record typed into a form and the same record arriving
  via CSV are held to identical standards. Screens should import these rather
  than re-declaring their own copies.

    GSTIN → 15 chars: 2-digit state code, 5 letters, 4 digits, 1 letter, 1 alnum, 'Z', 1 alnum
    PAN   → 10 chars: 5 letters, 4 digits, 1 letter
*/

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Null when valid (or blank — these are optional fields), else the reason. */
export function gstinError(raw: string): string | null {
  const v = raw.trim().toUpperCase();
  if (!v) return null;
  if (v.length !== 15) return "GSTIN must be exactly 15 characters.";
  if (!GSTIN_RE.test(v)) return "GSTIN format is invalid (e.g. 27AABCS1111A1Z1).";
  return null;
}

export function panError(raw: string): string | null {
  const v = raw.trim().toUpperCase();
  if (!v) return null;
  if (v.length !== 10) return "PAN must be exactly 10 characters.";
  if (!PAN_RE.test(v)) return "PAN format is invalid (e.g. AABCS1111A).";
  return null;
}

export function emailError(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  return EMAIL_RE.test(v) ? null : "Enter a valid email address.";
}

export function dateError(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (!DATE_RE.test(v) || Number.isNaN(Date.parse(v))) return "Use the date format YYYY-MM-DD.";
  return null;
}

export function numberError(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  return Number.isFinite(Number(v)) ? null : "Must be a number.";
}
