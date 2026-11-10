import "server-only";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { serverDb } from "./social-server";

export type AgentScope = "read" | "write";
export type AgentKeySummary = { id: string; name: string; scope: AgentScope; createdAt: string };
type AgentKeyRecord = AgentKeySummary & { hash: string };

const keys = (uid: string) => serverDb().collection("users").doc(uid).collection("agentKeys");

export async function listAgentKeys(uid: string): Promise<AgentKeySummary[]> {
  const snapshot = await keys(uid).get();
  return snapshot.docs.map(doc => {
    const { id, name, scope, createdAt } = doc.data() as AgentKeyRecord;
    return { id, name, scope, createdAt };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createAgentKey(uid: string, name: string, scope: AgentScope) {
  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const token = `dl_${id}_${secret}`;
  const record: AgentKeyRecord = {
    id, name: name.trim().slice(0, 80) || "Hermes Agent", scope,
    createdAt: new Date().toISOString(), hash: createHash("sha256").update(secret).digest("hex"),
  };
  await keys(uid).doc(id).create(record);
  return { key: token, summary: { id, name: record.name, scope, createdAt: record.createdAt } };
}

export async function revokeAgentKey(uid: string, id: string) {
  await keys(uid).doc(id).delete();
}

export async function updateAgentKeyScope(uid: string, id: string, scope: AgentScope) {
  const reference = keys(uid).doc(id);
  const saved = await reference.get();
  if (!saved.exists) throw new Error("Agent key not found.");
  await reference.update({ scope });
  const { name, createdAt } = saved.data() as AgentKeyRecord;
  return { id, name, scope, createdAt } satisfies AgentKeySummary;
}

export async function authenticateAgentKey(request: Request): Promise<{ uid: string; scope: AgentScope } | null> {
  const ownerUid = process.env.DAYLIGHT_OWNER_UID;
  if (!ownerUid) return null;
  const match = /^Bearer dl_([0-9a-f-]{36})_([A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") || "");
  if (!match) return null;
  const snapshot = await keys(ownerUid).doc(match[1]).get();
  if (!snapshot.exists) return null;
  const record = snapshot.data() as AgentKeyRecord;
  const expected = Buffer.from(record.hash, "hex");
  const actual = createHash("sha256").update(match[2]).digest();
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return { uid: ownerUid, scope: record.scope };
}
