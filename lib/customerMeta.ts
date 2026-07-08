/*
  Local-only extras for each customer that the shared backend has no column for
  (secondary contact details + Active/Inactive status). The golden rule is never
  to alter the backend, so — exactly like the sign-in gate keeps its session in
  localStorage — these live in the browser, keyed by the customer's database id.

  If those columns are ever added to Supabase, move these three fields onto the
  real `customers` row and delete this file.
*/

export type CustomerStatus = "active" | "inactive";

export interface CustomerMeta {
  secondaryPhone: string;
  secondaryEmail: string;
  status: CustomerStatus;
}

export const BLANK_META: CustomerMeta = {
  secondaryPhone: "",
  secondaryEmail: "",
  status: "active",
};

const KEY = "customer_meta_v1";

function readAll(): Record<string, CustomerMeta> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, CustomerMeta>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(all));
}

/** Every stored meta, merged over the defaults, keyed by customer id. */
export function loadMetas(): Record<string, CustomerMeta> {
  const raw = readAll();
  const out: Record<string, CustomerMeta> = {};
  for (const [id, meta] of Object.entries(raw)) {
    out[id] = { ...BLANK_META, ...meta };
  }
  return out;
}

export function getMeta(id: string): CustomerMeta {
  return { ...BLANK_META, ...readAll()[id] };
}

export function setMeta(id: string, meta: CustomerMeta) {
  const all = readAll();
  all[id] = meta;
  writeAll(all);
}

export function deleteMeta(id: string) {
  const all = readAll();
  delete all[id];
  writeAll(all);
}
