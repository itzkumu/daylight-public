import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { disconnectDrive, driveConfigured, driveRedirectUri, driveStatus } from "../../../lib/drive-server";
import { origin, seal, uidFromRequest } from "../../../lib/social-server";

export const runtime = "nodejs";
const failure = (issue: unknown) => NextResponse.json({ error: issue instanceof Error ? issue.message : "Google Drive request failed." }, { status: 400, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: NextRequest) {
  try {
    if (!driveConfigured()) return NextResponse.json({ configured: false, connected: false });
    const uid = await uidFromRequest(request);
    return NextResponse.json({ configured: true, ...await driveStatus(uid) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (issue) { return failure(issue); }
}

export async function POST(request: NextRequest) {
  try {
    if (!driveConfigured()) throw new Error("Google Drive needs the Google OAuth server settings in Vercel.");
    const uid = await uidFromRequest(request);
    const state = randomBytes(24).toString("base64url");
    const base = origin(request);
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", process.env.GOOGLE_OAUTH_CLIENT_ID!);
    url.searchParams.set("redirect_uri", driveRedirectUri(base));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email https://www.googleapis.com/auth/drive.file");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent select_account");
    url.searchParams.set("state", state);
    const response = NextResponse.json({ url: url.toString() });
    response.cookies.set("daylight_drive_oauth", seal({ uid, state, origin: base, expiresAt: Date.now() + 600_000 }), {
      httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/api/drive/callback", maxAge: 600,
    });
    return response;
  } catch (issue) { return failure(issue); }
}

export async function DELETE(request: NextRequest) {
  try { await disconnectDrive(await uidFromRequest(request)); return NextResponse.json({ ok: true }); }
  catch (issue) { return failure(issue); }
}
