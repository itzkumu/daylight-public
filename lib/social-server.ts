import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { verifyFirebaseIdToken } from "./firebase-token";

export type SocialPlatform = "instagram" | "facebook" | "tiktok";
export type SocialConnection = { platform: SocialPlatform; accountId: string; name: string; connectedAt: string; token: string; refreshToken?: string; expiresAt?: number; refreshExpiresAt?: number; authMode?: "instagram_direct" | "facebook_profile" | "tiktok"; pageId?: string };
export const socialPlatforms: SocialPlatform[] = ["instagram", "facebook", "tiktok"];
export const isSocialPlatform = (value: unknown): value is SocialPlatform => socialPlatforms.includes(value as SocialPlatform);

function admin() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Server Firebase credentials are not configured.");
  if (!getApps().length) initializeApp({ credential: cert(JSON.parse(raw)) });
  return { db: getFirestore() };
}

export function serverDb() { return admin().db; }

export async function uidFromRequest(request: Request) {
  const match = /^Bearer (.+)$/.exec(request.headers.get("authorization") || "");
  if (!match) throw new Error("Sign in to connect an account.");
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "{}") as { project_id?: string };
  if (!serviceAccount.project_id) throw new Error("Server Firebase credentials are not configured.");
  const uid = await verifyFirebaseIdToken(match[1], serviceAccount.project_id);
  if (!process.env.DAYLIGHT_OWNER_UID || uid !== process.env.DAYLIGHT_OWNER_UID) throw new Error("This personal dashboard only allows its owner to connect accounts.");
  return uid;
}

function key() {
  const value = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY;
  const decoded = value ? Buffer.from(value, "base64") : Buffer.alloc(0);
  if (decoded.length !== 32) throw new Error("Social token encryption is not configured.");
  return decoded;
}

export function seal(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString("base64url")).join(".");
}

export function unseal<T>(value: string): T {
  const [iv, tag, encrypted] = value.split(".").map(part => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")) as T;
}

const ref = (uid: string, platform: SocialPlatform) => admin().db.doc(`users/${uid}/socialConnections/${platform}`);
export async function saveConnection(uid: string, connection: SocialConnection) {
  const { token, refreshToken, ...publicFields } = connection;
  const fields = Object.fromEntries(Object.entries(publicFields).filter(([, value]) => value !== undefined));
  await ref(uid, connection.platform).set({ ...fields, encryptedCredentials: seal({ token, refreshToken }) });
}
export async function getConnection(uid: string, platform: SocialPlatform): Promise<SocialConnection | null> {
  const snapshot = await ref(uid, platform).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data()!;
  const credentials = unseal<{ token: string; refreshToken?: string }>(data.encryptedCredentials);
  return { platform, accountId: data.accountId, name: data.name, connectedAt: data.connectedAt, expiresAt: data.expiresAt, refreshExpiresAt: data.refreshExpiresAt, authMode: data.authMode, pageId: data.pageId, ...credentials };
}
export async function deleteConnection(uid: string, platform: SocialPlatform) { await ref(uid, platform).delete(); }

export async function activeConnection(uid: string, platform: SocialPlatform) {
  const connection = await getConnection(uid, platform);
  const refreshWindow = platform === "instagram" ? 7 * 86_400_000 : 60_000;
  if (!connection || !connection.expiresAt || connection.expiresAt > Date.now() + refreshWindow) return connection;
  if (platform === "instagram" && connection.authMode === "instagram_direct" && connection.expiresAt > Date.now()) {
    try {
      const url = new URL("https://graph.instagram.com/refresh_access_token");
      url.searchParams.set("grant_type", "ig_refresh_token");
      url.searchParams.set("access_token", connection.token);
      const fresh = await providerJson<{ access_token: string; expires_in: number }>(url.toString());
      if (!fresh.access_token || !fresh.expires_in) return connection;
      const updated = { ...connection, token: fresh.access_token, expiresAt: Date.now() + fresh.expires_in * 1000 };
      await saveConnection(uid, updated);
      return updated;
    } catch { return connection; }
  }
  if (platform !== "tiktok" || !connection.refreshToken || (connection.refreshExpiresAt && connection.refreshExpiresAt < Date.now())) return connection;
  try {
    const body = new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY!, client_secret: process.env.TIKTOK_CLIENT_SECRET!, grant_type: "refresh_token", refresh_token: connection.refreshToken });
    const fresh = await providerJson<{ access_token: string; refresh_token?: string; expires_in: number; refresh_expires_in?: number }>("https://open.tiktokapis.com/v2/oauth/token/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    if (!fresh.access_token || !Number.isFinite(fresh.expires_in) || fresh.expires_in <= 0) return connection;
    const updated = { ...connection, token: fresh.access_token, refreshToken: fresh.refresh_token || connection.refreshToken, expiresAt: Date.now() + fresh.expires_in * 1000, refreshExpiresAt: fresh.refresh_expires_in ? Date.now() + fresh.refresh_expires_in * 1000 : connection.refreshExpiresAt };
    await saveConnection(uid, updated);
    return updated;
  } catch { return connection; }
}

export function origin(request: Request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}
export function redirectUri(request: Request, platform: SocialPlatform) { return `${origin(request)}/api/social/callback/${platform}`; }
export function configured(platform: SocialPlatform) {
  const env = process.env;
  return Boolean(env.DAYLIGHT_OWNER_UID && env.FIREBASE_SERVICE_ACCOUNT_JSON && env.SOCIAL_TOKEN_ENCRYPTION_KEY &&
    (platform === "tiktok" ? env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET : platform === "instagram" ? env.INSTAGRAM_APP_ID && env.INSTAGRAM_APP_SECRET : env.META_APP_ID && env.META_APP_SECRET));
}
export function expectedMode(platform: SocialPlatform) { return platform === "instagram" ? "instagram_direct" : platform === "facebook" ? "facebook_profile" : "tiktok"; }
export async function providerJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const data = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string }; error_description?: string };
  if (!response.ok || (data.error && data.error.code && data.error.code !== "ok")) throw new Error(data.error?.message || data.error_description || `Account provider returned ${response.status}.`);
  return data as T;
}
