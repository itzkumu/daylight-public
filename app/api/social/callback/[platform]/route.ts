import { NextRequest, NextResponse } from "next/server";
import { isSocialPlatform, providerJson, redirectUri, saveConnection, unseal, type SocialConnection, type SocialPlatform } from "../../../../../lib/social-server";

export const runtime = "nodejs";

type State = { uid: string; platform: SocialPlatform; state: string; origin: string; expiresAt: number };
type MetaToken = { access_token: string; expires_in?: number };

async function facebookConnection(request: NextRequest, code: string): Promise<SocialConnection> {
  const uri = redirectUri(request, "facebook");
  const tokenUrl = new URL("https://graph.facebook.com/v26.0/oauth/access_token");
  tokenUrl.searchParams.set("client_id", process.env.META_APP_ID!);
  tokenUrl.searchParams.set("client_secret", process.env.META_APP_SECRET!);
  tokenUrl.searchParams.set("redirect_uri", uri);
  tokenUrl.searchParams.set("code", code);
  const short = await providerJson<MetaToken>(tokenUrl.toString());
  const longUrl = new URL("https://graph.facebook.com/v26.0/oauth/access_token");
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", process.env.META_APP_ID!);
  longUrl.searchParams.set("client_secret", process.env.META_APP_SECRET!);
  longUrl.searchParams.set("fb_exchange_token", short.access_token);
  const long = await providerJson<MetaToken>(longUrl.toString());
  const profileUrl = new URL("https://graph.facebook.com/v26.0/me");
  profileUrl.searchParams.set("fields", "id,name");
  profileUrl.searchParams.set("access_token", long.access_token);
  const profile = await providerJson<{ id?: string; name?: string }>(profileUrl.toString());
  if (!profile.id) throw new Error("Facebook did not return your profile.");
  return { platform: "facebook", authMode: "facebook_profile", accountId: profile.id, name: profile.name || "Facebook profile", token: long.access_token, connectedAt: new Date().toISOString(), expiresAt: Date.now() + (long.expires_in || 5_184_000) * 1000 };
}

async function instagramConnection(request: NextRequest, code: string): Promise<SocialConnection> {
  const uri = redirectUri(request, "instagram");
  const short = await providerJson<{ access_token: string; user_id?: number }>("https://api.instagram.com/oauth/access_token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.INSTAGRAM_APP_ID!, client_secret: process.env.INSTAGRAM_APP_SECRET!, grant_type: "authorization_code", redirect_uri: uri, code }),
  });
  if (!short.access_token) throw new Error("Instagram did not return account access.");
  const longUrl = new URL("https://graph.instagram.com/access_token");
  longUrl.searchParams.set("grant_type", "ig_exchange_token");
  longUrl.searchParams.set("client_secret", process.env.INSTAGRAM_APP_SECRET!);
  longUrl.searchParams.set("access_token", short.access_token);
  const long = await providerJson<MetaToken>(longUrl.toString());
  const profileUrl = new URL("https://graph.instagram.com/v26.0/me");
  profileUrl.searchParams.set("fields", "user_id,username,name");
  profileUrl.searchParams.set("access_token", long.access_token);
  const profile = await providerJson<{ user_id?: string; username?: string; name?: string }>(profileUrl.toString());
  const accountId = profile.user_id || (short.user_id ? String(short.user_id) : "");
  if (!accountId) throw new Error("Instagram did not return your account ID.");
  return { platform: "instagram", authMode: "instagram_direct", accountId, name: profile.username ? `@${profile.username}` : profile.name || "Instagram account", token: long.access_token, connectedAt: new Date().toISOString(), expiresAt: Date.now() + (long.expires_in || 5_184_000) * 1000 };
}

async function tiktokConnection(request: NextRequest, code: string): Promise<SocialConnection> {
  const body = new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY!, client_secret: process.env.TIKTOK_CLIENT_SECRET!, code, grant_type: "authorization_code", redirect_uri: redirectUri(request, "tiktok") });
  const token = await providerJson<{ access_token: string; refresh_token: string; expires_in: number; refresh_expires_in?: number; open_id: string }>("https://open.tiktokapis.com/v2/oauth/token/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const profile = await providerJson<{ data?: { user?: { display_name?: string; open_id?: string } } }>("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name", { headers: { Authorization: `Bearer ${token.access_token}` } });
  return { platform: "tiktok", authMode: "tiktok", accountId: token.open_id, name: profile.data?.user?.display_name || "TikTok account", token: token.access_token, refreshToken: token.refresh_token, connectedAt: new Date().toISOString(), expiresAt: Date.now() + token.expires_in * 1000, refreshExpiresAt: token.refresh_expires_in ? Date.now() + token.refresh_expires_in * 1000 : undefined };
}

export async function GET(request: NextRequest, context: { params: Promise<{ platform: string }> }) {
  const { platform } = await context.params;
  const base = new URL("/", request.url);
  const finish = (message: string, success: boolean) => {
    base.searchParams.set("view", "analytics");
    base.searchParams.set("social", success ? "connected" : "error");
    base.searchParams.set("platform", platform);
    if (!success) base.searchParams.set("message", message.slice(0, 180));
    const response = NextResponse.redirect(base);
    response.cookies.set("daylight_social_oauth", "", { path: "/api/social/callback", httpOnly: true, maxAge: 0 });
    return response;
  };
  try {
    if (!isSocialPlatform(platform)) throw new Error("Unknown account provider.");
    const cookie = request.cookies.get("daylight_social_oauth")?.value;
    if (!cookie) throw new Error("Connection session expired. Try again.");
    const state = unseal<State>(cookie);
    if (state.platform !== platform || state.expiresAt < Date.now() || state.origin !== base.origin || state.state !== request.nextUrl.searchParams.get("state")) throw new Error("Connection session did not match. Try again.");
    if (request.nextUrl.searchParams.has("error")) throw new Error("Account authorization was cancelled or declined.");
    const code = request.nextUrl.searchParams.get("code");
    if (!code) throw new Error("The account provider did not return an authorization code.");
    const connection = platform === "tiktok" ? await tiktokConnection(request, code) : platform === "instagram" ? await instagramConnection(request, code) : await facebookConnection(request, code);
    await saveConnection(state.uid, connection);
    return finish("", true);
  } catch (issue) { return finish(issue instanceof Error ? issue.message : "Could not connect the account.", false); }
}
