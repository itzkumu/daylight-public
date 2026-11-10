import "server-only";
import { seal, serverDb, unseal } from "./social-server";

type Tokens = { accessToken: string; refreshToken: string; expiresAt: number };
type SavedDrive = { email: string; connectedAt: string; encryptedCredentials: string };
const reference = (uid: string) => serverDb().doc(`users/${uid}/integrations/googleDrive`);

export const driveConfigured = () => Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.FIREBASE_SERVICE_ACCOUNT_JSON && process.env.SOCIAL_TOKEN_ENCRYPTION_KEY && process.env.DAYLIGHT_OWNER_UID);
export const driveRedirectUri = (origin: string) => `${origin}/api/drive/callback`;

export async function driveStatus(uid: string) {
  const saved = await reference(uid).get();
  if (!saved.exists) return { connected: false };
  const data = saved.data() as SavedDrive;
  try { await driveAccessToken(uid); }
  catch (issue) {
    if (issue instanceof DriveReconnectError) return { connected: false, needsReconnect: true, email: data.email };
    throw issue;
  }
  return { connected: true, email: data.email, connectedAt: data.connectedAt };
}

export async function saveDrive(uid: string, email: string, tokens: Tokens) {
  await reference(uid).set({ email, connectedAt: new Date().toISOString(), encryptedCredentials: seal(tokens) });
}

export async function disconnectDrive(uid: string) { await reference(uid).delete(); }

export class DriveReconnectError extends Error {}

export async function driveAccessToken(uid: string) {
  const ref = reference(uid);
  const saved = await ref.get();
  if (!saved.exists) throw new DriveReconnectError("Connect Google Drive from Money before saving bills.");
  let tokens: Tokens;
  try { tokens = unseal<Tokens>((saved.data() as SavedDrive).encryptedCredentials); }
  catch { throw new DriveReconnectError("Saved Google Drive access cannot be read. Reconnect Drive."); }
  if (tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", cache: "no-store", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!, refresh_token: tokens.refreshToken, grant_type: "refresh_token" }),
  });
  const result = await response.json() as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !result.access_token) {
    if (result.error === "invalid_grant") throw new DriveReconnectError("Google Drive access expired or was revoked. Reconnect Drive.");
    throw new Error("Google Drive could not refresh access right now. Try again shortly.");
  }
  const updated = { ...tokens, accessToken: result.access_token, expiresAt: Date.now() + (result.expires_in || 3600) * 1000 };
  await ref.update({ encryptedCredentials: seal(updated) });
  return updated.accessToken;
}

export async function driveRequest(uid: string, url: string, init?: RequestInit) {
  const token = await driveAccessToken(uid);
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  if (response.status === 401) throw new DriveReconnectError("Google Drive access needs renewal. Reconnect Drive.");
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(detail?.error?.message || `Google Drive request failed (${response.status}).`);
  }
  return response;
}

export async function billFolder(uid: string) {
  const query = new URLSearchParams({ q: "name = 'Daylight Bills' and mimeType = 'application/vnd.google-apps.folder' and trashed = false", fields: "files(id,name)", pageSize: "1" });
  const listing = await driveRequest(uid, `https://www.googleapis.com/drive/v3/files?${query}`);
  const found = await listing.json() as { files?: { id: string }[] };
  if (found.files?.[0]?.id) return found.files[0].id;
  const created = await driveRequest(uid, "https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Daylight Bills", mimeType: "application/vnd.google-apps.folder" }),
  });
  return ((await created.json()) as { id: string }).id;
}
