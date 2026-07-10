/*
  Tiny CSV reader/writer shared by the import screens.
  Handles quoted fields, escaped quotes ("") and commas or newlines inside values,
  so a customer called "Acme, Inc." survives a round trip.
*/

/** Parse CSV text into rows of raw cell strings. Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1; // skip the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);

  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Quote a value only when it needs it. */
export function csvEscape(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build CSV text from a header row plus data rows. */
export function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return [headers, ...rows].map((r) => r.map((c) => csvEscape(String(c))).join(",")).join("\r\n");
}

/**
 * Loosely match a file's header to an expected field name, so "Customer Code",
 * "customer_code" and "CUSTOMERCODE" all line up.
 */
export function normaliseHeader(h: string): string {
  // Drop the trailing "*" the downloadable template uses to mark required columns,
  // so a file saved straight from that template still matches.
  return h.trim().toLowerCase().replace(/\*/g, "").replace(/[\s_-]+/g, "");
}
