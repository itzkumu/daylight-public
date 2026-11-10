import { NextRequest, NextResponse } from "next/server";
import { driveRedirectUri, saveDrive } from "../../../../lib/drive-server";
import { unseal } from "../../../../lib/social-server";

export const runtime = "nodejs";
type State = { uid: string; state: string; origin: string; expiresAt: number };

export async function GET(request: NextRequest) {
  const destination = new URL("/", request.url);
  destination.searchParams.set("view", "money");
  const finish = (success: boolean, message = "") => {
    destination.searchParams.set("drive", success ? "connected" : "error");
    if (!success) destination.searchParams.set("message", message.slice(0, 180));
    const response = NextResponse.redirect(destination);
    response.cookies.set("daylight_drive_oauth", "", { path: "/api/drive/callback", httpOnly: true, maxAge: 0 });
    return response;
  };
  try {
    const cookie = request.cookies.get("daylight_drive_oauth")?.value;
    if (!cookie) throw new Error("Drive connection expired. Try again.");
    const state = unseal<State>(cookie);
    if (state.origin !== destination.origin || state.expiresAt < Date.now() || state.state !== request.nextUrl.searchParams.get("state")) throw new Error("Drive connection did not match. Try again.");
    if (request.nextUrl.searchParams.has("error")) throw new Error("Google Drive permission was cancelled or declined.");
    const code = request.nextUrl.searchParams.get("code");
    if (!code) throw new Error("Google did not return a connection code.");
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", cache: "no-store", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!, redirect_uri: driveRedirectUri(destination.origin), grant_type: "authorization_code" }),
    });
    const token = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
    if (!response.ok || !token.access_token || !token.refresh_token || !token.scope?.split(" ").includes("https://www.googleapis.com/auth/drive.file")) throw new Error("Google did not grant lasting Drive access. Please reconnect.");
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` }, cache: "no-store" });
    const profile = await profileResponse.json() as { email?: string; email_verified?: boolean };
    if (!profileResponse.ok || !profile.email || !profile.email_verified) throw new Error("Could not verify the connected Google account.");
    await saveDrive(state.uid, profile.email, { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + (token.expires_in || 3600) * 1000 });
    return finish(true);
  } catch (issue) { return finish(false, issue instanceof Error ? issue.message : "Could not connect Google Drive."); }
}
