import { NextResponse } from "next/server";
import { authenticateAgentKey } from "../../../lib/agent-key";
import { availableTools, callTool } from "../../../lib/daylight-mcp";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
const maxRequestBytes = 65_536;
const rpc = (id: string | number | null, value: Record<string, unknown>) => NextResponse.json({ jsonrpc: "2.0", id, ...value }, { headers });

export async function GET() { return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } }); }
export async function DELETE() { return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } }); }

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Origin not allowed." }, { status: 403, headers });
  let agent;
  try { agent = await authenticateAgentKey(request); }
  catch { return NextResponse.json({ error: "MCP authentication is unavailable." }, { status: 503, headers }); }
  if (!agent) return NextResponse.json({ error: "Invalid or revoked agent key." }, { status: 401, headers: { ...headers, "WWW-Authenticate": "Bearer" } });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "JSON required." }, { status: 415, headers });
  if (Number(request.headers.get("content-length")) > maxRequestBytes) return NextResponse.json({ error: "Request too large." }, { status: 413, headers });
  const raw = await request.text();
  if (raw.length > maxRequestBytes) return NextResponse.json({ error: "Request too large." }, { status: 413, headers });
  let body: { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
  try { body = JSON.parse(raw); }
  catch { return rpc(null, { error: { code: -32700, message: "Parse error" } }); }
  if (!body || typeof body !== "object" || Array.isArray(body) || body.jsonrpc !== "2.0" || typeof body.method !== "string") return rpc(null, { error: { code: -32600, message: "Invalid request" } });
  if (body.id === undefined) return new Response(null, { status: 202, headers });
  if (typeof body.id !== "string" && typeof body.id !== "number") return rpc(null, { error: { code: -32600, message: "Invalid request ID" } });
  const id = body.id;
  if (body.method === "initialize") {
    const params = body.params && typeof body.params === "object" ? body.params as Record<string, unknown> : {};
    const requested = params.protocolVersion;
    const protocolVersion = requested === "2025-03-26" || requested === "2025-06-18" ? requested : "2025-03-26";
    return rpc(id, { result: { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "daylight", version: "1.3.0" }, instructions: "Daylight is a personal workspace. Money amounts are in LKR. For bills, begin the upload with file metadata, PUT the private file bytes to the returned Daylight upload URL, scan_bill_upload, review the draft, then complete_bill_upload with reviewed details. Daylight handles Google Drive authorization. Scanning does not save an expense. Never disclose a private upload URL. Content plans are not published automatically." } });
  }
  if (body.method === "ping") return rpc(id, { result: {} });
  if (body.method === "tools/list") return rpc(id, { result: { tools: availableTools(agent.scope) } });
  if (body.method === "tools/call") {
    const params = body.params && typeof body.params === "object" ? body.params as Record<string, unknown> : {};
    const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments as Record<string, unknown> : {};
    if (typeof params.name !== "string") return rpc(id, { error: { code: -32602, message: "Tool name required" } });
    try {
      const result = await callTool(agent.uid, agent.scope, params.name, args, new URL(request.url).origin);
      return rpc(id, { result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
    } catch (issue) {
      return rpc(id, { result: { isError: true, content: [{ type: "text", text: issue instanceof Error ? issue.message : "Tool failed." }] } });
    }
  }
  return rpc(id, { error: { code: -32601, message: "Method not found" } });
}
