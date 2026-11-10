import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { billFolder, driveRequest } from "../../../../lib/drive-server";
import { uidFromRequest } from "../../../../lib/social-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const uid = await uidFromRequest(request);
    const type = request.headers.get("content-type") || "";
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(type)) throw new Error("Choose a JPG, PNG, WebP, or PDF invoice.");
    const bytes = Buffer.from(await request.arrayBuffer());
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error("Choose an invoice smaller than 5 MB.");
    const name = (request.headers.get("x-file-name") || "Project invoice").slice(0, 200).replace(/[\r\n]/g, "");
    const boundary = `daylight-project-${randomUUID()}`;
    const metadata = JSON.stringify({ name, mimeType: type, parents: [await billFolder(uid)] });
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const result = await driveRequest(uid, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: new Uint8Array(body) });
    const file = await result.json() as { id?: string; webViewLink?: string };
    if (!file.id) throw new Error("Google Drive did not return an invoice file.");
    return NextResponse.json({ name, driveFileId: file.id, url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view` });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not upload invoice." }, { status: 400 });
  }
}
