import { NextResponse } from "next/server";
import { BillUploadHttpError, uploadAgentBillBytes } from "../../../../../lib/agent-bill-upload";

export const runtime = "nodejs";
export const maxDuration = 60;
const maxChunkBytes = 4 * 1024 * 1024;
const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Content-Range",
};

export async function OPTIONS() { return new Response(null, { status: 204, headers }); }
export async function PUT(request: Request, context: { params: Promise<{ uploadId: string }> }) {
  const uid = process.env.DAYLIGHT_OWNER_UID;
  if (!uid) return NextResponse.json({ error: "Bill uploads are unavailable." }, { status: 503, headers });
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxChunkBytes) return NextResponse.json({ error: "Send at most 4 MiB per PUT." }, { status: 413, headers });
  try {
    const { uploadId } = await context.params;
    const token = new URL(request.url).searchParams.get("token") || "";
    if (!/^[0-9a-f-]{36}$/.test(uploadId) || !/^[A-Za-z0-9_-]{43}$/.test(token)) return NextResponse.json({ error: "Invalid upload link." }, { status: 401, headers });
    const bytes = new Uint8Array(await request.arrayBuffer());
    const result = await uploadAgentBillBytes(uid, uploadId, token, bytes, request.headers.get("content-range"));
    return NextResponse.json(result, { headers });
  } catch (issue) {
    const status = issue instanceof BillUploadHttpError ? issue.status : 502;
    const message = issue instanceof Error ? issue.message : "Bill upload failed. Try again.";
    return NextResponse.json({ error: message }, { status, headers });
  }
}
