import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { billFolder, driveRequest } from "../../../../lib/drive-server";
import { scanAgentBill } from "../../../../lib/agent-bill-scan";
import { serverDb, uidFromRequest } from "../../../../lib/social-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const uid = await uidFromRequest(request);
    const type = request.headers.get("content-type") || "";
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(type)) return NextResponse.json({ error: "Choose a JPG, PNG, WebP, or PDF bill." }, { status: 400 });
    const bytes = Buffer.from(await request.arrayBuffer());
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) return NextResponse.json({ error: "Bills must be smaller than 5 MB." }, { status: 400 });
    const name = (request.headers.get("x-file-name") || "Bill").slice(0, 200).replace(/[\r\n]/g, "");
    const boundary = `daylight-mobile-${randomUUID()}`;
    const metadata = JSON.stringify({ name, mimeType: type, parents: [await billFolder(uid)] });
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const uploaded = await driveRequest(uid, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: new Uint8Array(body) });
    const file = await uploaded.json() as { id?: string; webViewLink?: string };
    if (!file.id) throw new Error("Google Drive did not return a bill file.");
    const uploadId = randomUUID();
    await serverDb().doc(`mobileBillUploads/${uploadId}`).set({ uid, driveFileId: file.id, driveUrl: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`, fileName: name, mimeType: type, expiresAt: Date.now() + 3_600_000 });
    try {
      return NextResponse.json({ uploadId, scan: await scanAgentBill(uid, file.id, type) }, { headers: { "Cache-Control": "no-store" } });
    } catch (scanError) {
      return NextResponse.json({ uploadId, scan: null, scanError: scanError instanceof Error ? scanError.message : "Could not read this bill. Enter its details manually." }, { headers: { "Cache-Control": "no-store" } });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not upload this bill." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const uid = await uidFromRequest(request);
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid bill.");
    const db = serverDb();
    const billRef = db.doc(`users/${uid}/bills/${id}`);
    const bill = await billRef.get();
    if (!bill.exists) throw new Error("Bill no longer exists.");
    const linked = await db.collection(`users/${uid}/transactions`).where("billId", "==", id).get();
    const batch = db.batch(); batch.delete(billRef);
    linked.docs.forEach(item => batch.delete(item.ref));
    const primaryId = bill.data()?.transactionId as string | undefined;
    if (primaryId && !linked.docs.some(item => item.id === primaryId)) batch.delete(db.doc(`users/${uid}/transactions/${primaryId}`));
    await batch.commit();
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not delete bill." }, { status: 400 });
  }
}
