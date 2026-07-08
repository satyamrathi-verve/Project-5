/*
  DMS API — record folder endpoints.
    GET  /api/attachments/:module/:recordId          → list files + stats + history
    POST /api/attachments/:module/:recordId          → upload one file (multipart)
                                                        fields: file, [replaceId], [tags]
  Files are written to the application storage directory; only metadata JSON is
  persisted (never the database). Node runtime (uses fs); always dynamic.
*/

import { NextRequest, NextResponse } from "next/server";
import { MAX_FILE_BYTES, validateUpload } from "@/lib/attachments/config";
import { listRecord, saveUpload, validModule } from "@/lib/attachments/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function actor(req: NextRequest): string {
  return req.headers.get("x-user-name")?.trim() || "Unknown";
}
function canWrite(req: NextRequest): boolean {
  return req.headers.get("x-can-write") === "1";
}

export async function GET(_req: NextRequest, { params }: { params: { module: string; recordId: string } }) {
  const { module, recordId } = params;
  if (!validModule(module)) return NextResponse.json({ error: "Invalid module" }, { status: 400 });
  return NextResponse.json(await listRecord(module, recordId));
}

export async function POST(req: NextRequest, { params }: { params: { module: string; recordId: string } }) {
  const { module, recordId } = params;
  if (!validModule(module)) return NextResponse.json({ error: "Invalid module" }, { status: 400 });
  if (!canWrite(req)) return NextResponse.json({ error: "You do not have permission to upload." }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const check = validateUpload(file.name, file.size);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "File too large" }, { status: 413 });

  const replaceId = (form.get("replaceId") as string) || null;
  const tagsRaw = (form.get("tags") as string) || "";
  const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const buffer = Buffer.from(await file.arrayBuffer());

  const result = await saveUpload({ module, recordId, fileName: file.name, buffer, user: actor(req), replaceId, tags });
  return NextResponse.json(result, { status: 201 });
}
