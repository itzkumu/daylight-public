import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { activeConnection, configured, deleteConnection, expectedMode, isSocialPlatform, origin, redirectUri, seal, socialPlatforms, uidFromRequest } from "../../../lib/social-server";

export const runtime = "nodejs";

function failure(issue: unknown) {
  return NextResponse.json({ error: issue instanceof Error ? issue.message : "Could not connect the account." }, { status: 400 });
}

export async function GET(request: NextRequest) {
  try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON || !process.env.SOCIAL_TOKEN_ENCRYPTION_KEY || !process.env.DAYLIGHT_OWNER_UID) {
      return NextResponse.json({ accounts: socialPlatforms.map(platform => ({ platform, configured: false, connected: false })) });
    }
    const uid = await uidFromRequest(request);
    const accounts = await Promise.all(socialPlatforms.map(async platform => {
      if (!configured(platform)) return { platform, configured: false, connected: false };
      const connection = await activeConnection(uid, platform);
      const legacy = Boolean(connection && connection.authMode !== expectedMode(platform));
      const needsReconnect = Boolean(connection?.expiresAt && connection.expiresAt < Date.now()) || legacy;
      return { platform, configured: true, connected: Boolean(connection) && !needsReconnect, needsReconnect, legacy, accountId: legacy ? undefined : connection?.accountId, name: legacy ? undefined : connection?.name, connectedAt: connection?.connectedAt };
    }));
    return NextResponse.json({ accounts });
  } catch (issue) { return failure(issue); }
}

export async function POST(request: NextRequest) {
  try {
    const { platform } = await request.json() as { platform?: unknown };
    if (!isSocialPlatform(platform)) throw new Error("Choose Instagram, TikTok, or Facebook.");
    if (!configured(platform)) throw new Error(`${platform} needs developer app credentials before it can connect. See the Social accounts setup in README.`);
    const uid = await uidFromRequest(request);
    const state = randomBytes(24).toString("base64url");
    const uri = redirectUri(request, platform);
    const url = platform === "tiktok" ? new URL("https://www.tiktok.com/v2/auth/authorize/") : platform === "instagram" ? new URL("https://www.instagram.com/oauth/authorize") : new URL("https://www.facebook.com/v26.0/dialog/oauth");
    if (platform === "tiktok") {
      url.searchParams.set("client_key", process.env.TIKTOK_CLIENT_KEY!);
      url.searchParams.set("scope", "user.info.basic,user.info.stats,video.list");
    } else if (platform === "instagram") {
      url.searchParams.set("client_id", process.env.INSTAGRAM_APP_ID!);
      url.searchParams.set("scope", "instagram_business_basic,instagram_business_manage_insights");
      url.searchParams.set("enable_fb_login", "0");
    } else {
      url.searchParams.set("client_id", process.env.META_APP_ID!);
      url.searchParams.set("scope", "public_profile");
    }
    url.searchParams.set("redirect_uri", uri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    const response = NextResponse.json({ url: url.toString() });
    response.cookies.set("daylight_social_oauth", seal({ uid, platform, state, origin: origin(request), expiresAt: Date.now() + 10 * 60_000 }), {
      httpOnly: true, secure: new URL(request.url).protocol === "https:", sameSite: "lax", path: "/api/social/callback", maxAge: 600,
    });
    return response;
  } catch (issue) { return failure(issue); }
}

export async function DELETE(request: NextRequest) {
  try {
    const uid = await uidFromRequest(request);
    const platform = new URL(request.url).searchParams.get("platform");
    if (!isSocialPlatform(platform)) throw new Error("Choose an account to disconnect.");
    await deleteConnection(uid, platform);
    return NextResponse.json({ ok: true });
  } catch (issue) { return failure(issue); }
}
