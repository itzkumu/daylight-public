import "server-only";
import { randomUUID } from "node:crypto";
import { parseBillText } from "./bill-text";
import { driveRequest } from "./drive-server";

const maxBytes = 5 * 1024 * 1024;

async function cloudText(uid: string, bytes: Buffer, mimeType: string) {
  // Google Drive converts a temporary upload into a Doc and reads it in the cloud.
  // The original bill file is never changed.
  const source = mimeType === "image/webp"
    ? { bytes: await (await import("sharp")).default(bytes).png().toBuffer(), mimeType: "image/png" }
    : { bytes, mimeType };
  const boundary = `daylight-ocr-${randomUUID()}`;
  const metadata = JSON.stringify({ name: "Daylight temporary bill scan", mimeType: "application/vnd.google-apps.document" });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${source.mimeType}\r\n\r\n`),
    source.bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const created = await driveRequest(uid, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&ocrLanguage=en", {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: new Uint8Array(body),
  });
  const { id } = await created.json() as { id?: string };
  if (!id) throw new Error("Google Drive did not return a cloud scan document ID.");
  try {
    const exported = await driveRequest(uid, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/export?mimeType=text%2Fplain`);
    return (await exported.text()).slice(0, 20_000);
  } finally {
    await driveRequest(uid, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
}

export async function scanAgentBill(uid: string, driveFileId: string, mimeType: string) {
  if (!/^[A-Za-z0-9_-]{10,}$/.test(driveFileId)) throw new Error("Invalid Google Drive bill file.");
  const response = await driveRequest(uid, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?alt=media`);
  if (Number(response.headers.get("content-length")) > maxBytes) throw new Error("The uploaded bill exceeds 5 MB.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maxBytes) throw new Error("The uploaded bill must be 1 byte to 5 MB.");
  const text = await cloudText(uid, bytes, mimeType);
  if (!text.trim()) throw new Error("Google's cloud reader found no text. Try a clearer bill image or provide the details manually.");
  const parsed = parseBillText(text, { dateFallback: "" });
  const reviewRequired = [
    ...(!parsed.merchant ? ["merchant"] : []),
    ...(!parsed.date ? ["date"] : []),
    ...(!parsed.total ? ["total"] : []),
    ...(parsed.currency !== "LKR" ? ["amountLkr"] : []),
  ];
  return {
    ...parsed,
    amountLkr: parsed.currency === "LKR" && parsed.total > 0 ? parsed.total : null,
    confidence: null,
    reviewRequired,
    ocrText: text.slice(0, 6000),
  };
}
