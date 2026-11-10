import { NextRequest, NextResponse } from "next/server";
import { activeConnection, configured, expectedMode, isSocialPlatform, providerJson, uidFromRequest, type SocialConnection } from "../../../../lib/social-server";

export const runtime = "nodejs";

type Item = { id: string; title: string; date: string; url?: string; views?: number; likes?: number; comments?: number; shares?: number };
type Metric = { label: string; value: number; note?: string };

function graphUrl(path: string, token: string, params: Record<string, string>, instagram = false) {
  const url = new URL(`https://${instagram ? "graph.instagram.com" : "graph.facebook.com"}/v26.0/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("access_token", token);
  return url.toString();
}

function total(values: Item[], field: "views" | "likes" | "comments" | "shares") {
  return values.reduce((sum, item) => sum + (item[field] || 0), 0);
}

async function instagram(connection: SocialConnection) {
  const profile = await providerJson<{ username?: string; name?: string; biography?: string; profile_picture_url?: string; followers_count?: number; follows_count?: number; media_count?: number }>(graphUrl("me", connection.token, { fields: "username,name,biography,profile_picture_url,followers_count,follows_count,media_count" }, true));
  const feed = await providerJson<{ data?: Array<{ id: string; caption?: string; timestamp?: string; permalink?: string; like_count?: number; comments_count?: number }> }>(graphUrl("me/media", connection.token, { fields: "id,caption,timestamp,permalink,like_count,comments_count", limit: "12" }, true));
  const items: Item[] = (feed.data || []).map(item => ({ id: item.id, title: item.caption?.trim().split("\n")[0].slice(0, 110) || "Instagram post", date: item.timestamp || "", url: item.permalink, likes: item.like_count || 0, comments: item.comments_count || 0 }));
  const metrics: Metric[] = [{ label: "Followers", value: profile.followers_count || 0 }, { label: "Following", value: profile.follows_count || 0 }, { label: "Posts", value: profile.media_count || 0 }, { label: "Likes on recent posts", value: total(items, "likes"), note: `Latest ${items.length} posts` }, { label: "Comments on recent posts", value: total(items, "comments"), note: `Latest ${items.length} posts` }];
  let insightNotice: string | undefined;
  try {
    const insights = await providerJson<{ data?: Array<{ name: string; total_value?: { value?: number }; values?: Array<{ value?: number }> }> }>(graphUrl("me/insights", connection.token, { metric: "reach", period: "day", metric_type: "total_value", timeframe: "last_30_days" }, true));
    const reach = insights.data?.find(item => item.name === "reach");
    const value = reach?.total_value?.value ?? reach?.values?.reduce((sum, item) => sum + (item.value || 0), 0);
    if (typeof value === "number") metrics.splice(1, 0, { label: "Reach", value, note: "Last 30 days · Meta estimate" });
  } catch { insightNotice = "Reach needs Instagram Insights access. Reconnect this account after the permission is approved in Meta."; }
  return { metrics, items, insightNotice, profile: { avatarUrl: profile.profile_picture_url, username: profile.username, bio: profile.biography, displayName: profile.name }, source: "Instagram Graph API", coverage: `Latest ${items.length} posts` };
}

async function facebook(connection: SocialConnection) {
  const profile = await providerJson<{ id?: string; name?: string; picture?: { data?: { url?: string } } }>(graphUrl("me", connection.token, { fields: "id,name,picture.width(240).height(240)" }));
  return { metrics: [] as Metric[], items: [] as Item[], profile: { avatarUrl: profile.picture?.data?.url, displayName: profile.name }, insightNotice: "Facebook's personal-profile connection does not provide follower, post, or Insights statistics. Daylight will not ask you to link a Page or invent those numbers.", source: "Facebook profile", coverage: "Profile only" };
}

async function tiktok(connection: SocialConnection) {
  const profile = await providerJson<{ data?: { user?: { display_name?: string; avatar_url?: string; follower_count?: number; following_count?: number; video_count?: number } } }>("https://open.tiktokapis.com/v2/user/info/?fields=display_name,avatar_url,follower_count,following_count,video_count", { headers: { Authorization: `Bearer ${connection.token}` } });
  const feed = await providerJson<{ data?: { videos?: Array<{ id: string; title?: string; video_description?: string; create_time?: number; share_url?: string; view_count?: number; like_count?: number; comment_count?: number; share_count?: number }> } }>("https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,create_time,share_url,view_count,like_count,comment_count,share_count", { method: "POST", headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ max_count: 20 }) });
  const items: Item[] = (feed.data?.videos || []).map(item => ({ id: item.id, title: item.title || item.video_description?.slice(0, 110) || "TikTok video", date: item.create_time ? new Date(item.create_time * 1000).toISOString() : "", url: item.share_url, views: item.view_count || 0, likes: item.like_count || 0, comments: item.comment_count || 0, shares: item.share_count || 0 }));
  return { metrics: [{ label: "Followers", value: profile.data?.user?.follower_count || 0, note: "Current profile total" }, { label: "Following", value: profile.data?.user?.following_count || 0, note: "Current profile total" }, { label: "Videos", value: profile.data?.user?.video_count || 0, note: "Current profile total" }, { label: "Video views", value: total(items, "views") }, { label: "Likes", value: total(items, "likes") }, { label: "Comments", value: total(items, "comments") }, { label: "Shares", value: total(items, "shares") }], items, profile: { avatarUrl: profile.data?.user?.avatar_url, displayName: profile.data?.user?.display_name }, source: "TikTok Display API", coverage: `Latest ${items.length} public videos`, insightNotice: "Recent video totals cover only the public videos listed here; account-wide reach is not available through this connection." };
}

export async function GET(request: NextRequest) {
  try {
    const platform = request.nextUrl.searchParams.get("platform");
    if (!isSocialPlatform(platform)) return NextResponse.json({ error: "Choose Instagram, Facebook, or TikTok." }, { status: 400 });
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON || !process.env.SOCIAL_TOKEN_ENCRYPTION_KEY || !process.env.DAYLIGHT_OWNER_UID) {
      return NextResponse.json({ status: "setup", platform }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const uid = await uidFromRequest(request);
    if (!configured(platform)) return NextResponse.json({ status: "setup", platform });
    const connection = await activeConnection(uid, platform);
    if (!connection) return NextResponse.json({ status: "disconnected", platform });
    if (connection.authMode !== expectedMode(platform)) return NextResponse.json({ status: "expired", platform, name: connection.name, legacy: true });
    if (connection.expiresAt && connection.expiresAt < Date.now()) return NextResponse.json({ status: "expired", platform, name: connection.name });
    const analytics = platform === "instagram" ? await instagram(connection) : platform === "facebook" ? await facebook(connection) : await tiktok(connection);
    return NextResponse.json({ status: "connected", platform, account: { name: connection.name, connectedAt: connection.connectedAt }, ...analytics }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (issue) {
    const message = issue instanceof Error ? issue.message : "Could not load analytics.";
    return NextResponse.json({ error: message }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
}
