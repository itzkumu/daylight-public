import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { serverDb, uidFromRequest } from "../../../../lib/social-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const uid = await uidFromRequest(request);
    const { challenge } = await request.json() as { challenge?: string };
    if (!challenge || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return NextResponse.json({ error: "Invalid sign-in challenge." }, { status: 400 });
    const code = randomBytes(32).toString("base64url");
    const id = createHash("sha256").update(code).digest("hex");
    await serverDb().doc(`mobileAuth/${id}`).set({ uid, challenge, expiresAt: Date.now() + 300_000 });
    return NextResponse.json({ code }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not connect Android." }, { status: 401 });
  }
}
