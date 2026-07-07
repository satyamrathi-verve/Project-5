/*
  Chart of Accounts seeder  —  node scripts/seed-coa.mjs
  =====================================================
  Replaces the contents of the shared `gl_accounts` table with the professional
  Chart of Accounts defined in lib/gl-coa.mjs (the single source of truth). Safe:

    1. reads Supabase URL + key from .env.local (never hard-coded)
    2. backs up the CURRENT rows to scripts/.coa-backup.json
    3. PROBES write + delete permission with a throwaway row BEFORE deleting anything
       (if the anon policy is read-only, it aborts having changed nothing)
    4. deletes existing rows, bulk-inserts the new chart, verifies the count

  Talks ONLY to the existing table through the REST API — never alters the schema
  and never touches app UI or business logic. Descriptions are documentation only
  (no column on gl_accounts) and are stripped before insert.

  To change the chart, edit lib/gl-coa.mjs and re-run this script.
*/

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildAccounts } from "../lib/gl-coa.mjs";

// ---------------------------------------------------------------------------
// Env + REST helpers
// ---------------------------------------------------------------------------
function readEnv() {
  const envPath = fileURLToPath(new URL("../.env.local", import.meta.url));
  const text = readFileSync(envPath, "utf8");
  const url = /NEXT_PUBLIC_SUPABASE_URL=(.+)/.exec(text)?.[1].trim();
  const key = /NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)/.exec(text)?.[1].trim();
  if (!url || !key) throw new Error("Could not read Supabase URL/key from .env.local");
  return { base: `${url.replace(/\/$/, "")}/rest/v1`, key };
}

function makeReq(base, key) {
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  return async (method, path, body, extraHeaders = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...headers, ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let json;
    try {
      json = txt ? JSON.parse(txt) : null;
    } catch {
      json = txt;
    }
    return { ok: res.ok, status: res.status, json };
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const accounts = buildAccounts();
  console.log(`Prepared ${accounts.length} accounts.`);

  const { base, key } = readEnv();
  const req = makeReq(base, key);

  // 1. Back up current rows
  const existing = await req("GET", "/gl_accounts?select=*&order=code.asc");
  if (!existing.ok) {
    console.error("Failed to read existing accounts:", existing.status, existing.json);
    process.exit(1);
  }
  const backupPath = fileURLToPath(new URL("./.coa-backup.json", import.meta.url));
  writeFileSync(backupPath, JSON.stringify(existing.json, null, 2));
  console.log(`Backed up ${existing.json.length} existing rows -> scripts/.coa-backup.json`);

  // 2. Probe write + delete permission with a throwaway row (changes nothing if it fails)
  const probe = [{ code: "9999", name: "__seed_probe__", type: "expense", parent_group: "__probe__" }];
  const probeIns = await req("POST", "/gl_accounts", probe, { Prefer: "return=minimal" });
  if (!probeIns.ok) {
    console.error("\nWRITE PERMISSION DENIED — the anon key cannot INSERT into gl_accounts.");
    console.error("Nothing was changed. Details:", probeIns.status, probeIns.json);
    process.exit(2);
  }
  const probeDel = await req("DELETE", "/gl_accounts?code=eq.9999", null, { Prefer: "return=minimal" });
  if (!probeDel.ok) {
    console.error("\nDELETE PERMISSION DENIED — cannot delete rows (a probe row 9999 may remain).");
    console.error("Nothing else was changed. Details:", probeDel.status, probeDel.json);
    process.exit(3);
  }
  console.log("Write + delete permission confirmed.");

  // 3. Delete existing, then bulk-insert the new chart
  const del = await req("DELETE", "/gl_accounts?id=not.is.null", null, { Prefer: "return=minimal" });
  if (!del.ok) {
    console.error("Delete-all failed:", del.status, del.json);
    process.exit(4);
  }
  const payload = accounts.map(({ description, ...dbRow }) => dbRow); // strip description (no column)
  const ins = await req("POST", "/gl_accounts", payload, { Prefer: "return=minimal" });
  if (!ins.ok) {
    console.error("\nINSERT FAILED after delete — attempting to restore backup...", ins.status, ins.json);
    const restore = await req("POST", "/gl_accounts", existing.json.map(({ id, ...r }) => r), {
      Prefer: "return=minimal",
    });
    console.error(restore.ok ? "Backup restored." : "Restore also failed — use scripts/.coa-backup.json.");
    process.exit(5);
  }

  // 4. Verify
  const check = await req("GET", "/gl_accounts?select=code,name,type,parent_group&order=code.asc");
  console.log(`\n✅ Seed complete — gl_accounts now has ${check.json.length} accounts.`);
  const byType = {};
  for (const a of check.json) byType[a.type] = (byType[a.type] ?? 0) + 1;
  console.log("By type:", byType);
}

main().catch((e) => {
  console.error("Seeder crashed:", e);
  process.exit(1);
});
