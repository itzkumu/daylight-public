import { NextResponse } from "next/server";
import { createAgentKey, listAgentKeys, revokeAgentKey, updateAgentKeyScope } from "../../../lib/agent-key";
import { uidFromRequest } from "../../../lib/social-server";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const uid = await uidFromRequest(request);
    return NextResponse.json({ keys: await listAgentKeys(uid) }, { headers });
  } catch {
    return NextResponse.json({ error: "Could not load agent keys." }, { status: 401, headers });
  }
}

export async function POST(request: Request) {
  try {
    const uid = await uidFromRequest(request);
    const body = await request.json() as { name?: unknown; scope?: unknown };
    if (body.scope !== "read" && body.scope !== "write") return NextResponse.json({ error: "Choose read-only or read and write access." }, { status: 400, headers });
    const result = await createAgentKey(uid, typeof body.name === "string" ? body.name : "Hermes Agent", body.scope);
    return NextResponse.json(result, { status: 201, headers });
  } catch {
    return NextResponse.json({ error: "Could not create agent key." }, { status: 400, headers });
  }
}

export async function DELETE(request: Request) {
  try {
    const uid = await uidFromRequest(request);
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Invalid key." }, { status: 400, headers });
    await revokeAgentKey(uid, id);
    return NextResponse.json({ ok: true }, { headers });
  } catch {
    return NextResponse.json({ error: "Could not revoke agent key." }, { status: 400, headers });
  }
}

export async function PATCH(request: Request) {
  try {
    const uid = await uidFromRequest(request);
    const body = await request.json() as { id?: unknown; scope?: unknown };
    if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/.test(body.id)) return NextResponse.json({ error: "Invalid key." }, { status: 400, headers });
    if (body.scope !== "read" && body.scope !== "write") return NextResponse.json({ error: "Choose read-only or read and write access." }, { status: 400, headers });
    return NextResponse.json({ summary: await updateAgentKeyScope(uid, body.id, body.scope) }, { headers });
  } catch (issue) {
    return NextResponse.json({ error: issue instanceof Error && issue.message === "Agent key not found." ? issue.message : "Could not change agent access." }, { status: 400, headers });
  }
}
