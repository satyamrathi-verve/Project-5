/*
  DMS API — single file endpoints.
    GET    /api/attachments/:module/:recordId/:fileId?v=&download=1  → stream (preview/download)
    PATCH  /api/attachments/:module/:recordId/:fileId               → rename | tags | restore
    DELETE /api/attachments/:module/:recordId/:fileId               → delete (all versions)
  Node runtime (uses fs); always dynamic.
*/

import { NextRequest, NextResponse } from "next/server";
import {
  deleteFile,
  readFilePayload,
  recordDownload,
  renameFile,
  restoreVersion,
  setTags,
  validModule,
} from "@/lib/attachments/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function actor(req: NextRequest): string {
  return req.headers.get("x-user-name")?.trim() || "Unknown";
}
function canWrite(req: NextRequest): boolean {
  return req.headers.get("x-can-write") === "1";
}

type Params = { params: { module: string; recordId: string; fileId: string } };

export async function GET(req: NextRequest, { params }: Params) {
  const { module, recordId, fileId } = params;
  if (!validModule(module)) return NextResponse.json({ error: "Invalid module" }, { status: 400 });

  const url = new URL(req.url);
  const version = url.searchParams.get("v") ? Number(url.searchParams.get("v")) : undefined;
  const download = url.searchParams.get("download") === "1";

  const payload = await readFilePayload(module, recordId, fileId, version);
  if (!payload) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (download) await recordDownload(module, recordId, fileId, actor(req));

  const disposition = download ? "attachment" : "inline";
  return new NextResponse(payload.buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": payload.contentType,
      "Content-Disposition": `${disposition}; filename="${encodeURIComponent(payload.name)}"`,
      "Content-Length": String(payload.buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { module, recordId, fileId } = params;
  if (!validModule(module)) return NextResponse.json({ error: "Invalid module" }, { status: 400 });
  if (!canWrite(req)) return NextResponse.json({ error: "You do not have permission to modify files." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { action?: string; name?: string; tags?: string[]; version?: number };
  const user = actor(req);

  switch (body.action) {
    case "rename":
      if (!body.name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
      return NextResponse.json(await renameFile(module, recordId, fileId, body.name.trim(), user));
    case "tags":
      return NextResponse.json(await setTags(module, recordId, fileId, body.tags ?? [], user));
    case "restore":
      if (!body.version) return NextResponse.json({ error: "Version required" }, { status: 400 });
      return NextResponse.json(await restoreVersion(module, recordId, fileId, body.version, user));
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { module, recordId, fileId } = params;
  if (!validModule(module)) return NextResponse.json({ error: "Invalid module" }, { status: 400 });
  if (!canWrite(req)) return NextResponse.json({ error: "You do not have permission to delete files." }, { status: 403 });
  return NextResponse.json(await deleteFile(module, recordId, fileId, actor(req)));
}
