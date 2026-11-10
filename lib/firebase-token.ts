import "server-only";
import { verify } from "node:crypto";

const CERT_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
let cachedCerts: { values: Record<string, string>; expiresAt: number } | undefined;

function invalidToken(): never {
  throw new Error("Your sign-in has expired. Sign in again and retry.");
}

function decodePart(value: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 16_384) invalidToken();
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) invalidToken();
    return parsed as Record<string, unknown>;
  } catch { return invalidToken(); }
}

async function publicCerts(): Promise<Record<string, string>> {
  if (cachedCerts && cachedCerts.expiresAt > Date.now()) return cachedCerts.values;
  const response = await fetch(CERT_URL, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not verify your sign-in right now. Try again shortly.");
  const values = await response.json() as Record<string, string>;
  if (!values || typeof values !== "object" || Array.isArray(values)) invalidToken();
  const maxAge = Number(/(?:^|,)\s*max-age=(\d+)/i.exec(response.headers.get("cache-control") || "")?.[1] || 300);
  cachedCerts = { values, expiresAt: Date.now() + Math.min(maxAge, 86_400) * 1000 };
  return values;
}

export async function verifyFirebaseIdToken(token: string, projectId: string): Promise<string> {
  const parts = token.split(".");
  if (parts.length !== 3 || !projectId || token.length > 32_768) invalidToken();
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodePart(encodedHeader);
  const payload = decodePart(encodedPayload);
  if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) invalidToken();
  if (!/^[A-Za-z0-9_-]+$/.test(encodedSignature)) invalidToken();
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}` ||
    typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 128 ||
    typeof payload.exp !== "number" || payload.exp <= now ||
    typeof payload.iat !== "number" || payload.iat > now ||
    typeof payload.auth_time !== "number" || payload.auth_time > now) invalidToken();
  const certificate = (await publicCerts())[header.kid];
  if (typeof certificate !== "string" || !verify("RSA-SHA256", Buffer.from(`${encodedHeader}.${encodedPayload}`), certificate, Buffer.from(encodedSignature, "base64url"))) invalidToken();
  return payload.sub;
}
