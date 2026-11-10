import { createHash, createSign } from "node:crypto";
import { NextResponse } from "next/server";
import { serverDb } from "../../../../../lib/social-server";

export const runtime = "nodejs";

function customToken(uid: string) {
  const account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "{}") as { client_email?: string; private_key?: string };
  if (!account.client_email || !account.private_key) throw new Error("Server Firebase credentials are not configured.");
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    iss: account.client_email, sub: account.client_email,
    aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    iat: now, exp: now + 3600, uid,
  })).toString("base64url");
  const body = `${header}.${claims}`;
  const signature = createSign("RSA-SHA256").update(body).sign(account.private_key, "base64url");
  return `${body}.${signature}`;
}

export async function POST(request: Request) {
  try {
    const { code, verifier } = await request.json() as { code?: string; verifier?: string };
    if (!code || !/^[A-Za-z0-9_-]{43}$/.test(code) || !verifier || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) throw new Error("Invalid sign-in response.");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const id = createHash("sha256").update(code).digest("hex");
    const reference = serverDb().doc(`mobileAuth/${id}`);
    const uid = await serverDb().runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      const data = snapshot.data();
      if (!data || data.challenge !== challenge || data.expiresAt < Date.now() || data.uid !== process.env.DAYLIGHT_OWNER_UID) throw new Error("This sign-in link expired. Try again.");
      transaction.delete(reference);
      return data.uid as string;
    });
    return NextResponse.json({ token: customToken(uid) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not sign in." }, { status: 400 });
  }
}
