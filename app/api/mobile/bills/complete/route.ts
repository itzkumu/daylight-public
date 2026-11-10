import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { serverDb, uidFromRequest } from "../../../../../lib/social-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const uid = await uidFromRequest(request);
    const input = await request.json() as Record<string, unknown>;
    const uploadId = String(input.uploadId || "");
    if (!/^[0-9a-f-]{36}$/.test(uploadId)) throw new Error("Upload this bill again.");
    const merchant = String(input.merchant || "").trim().slice(0, 180);
    const date = String(input.date || "");
    const amount = Math.round(Number(input.amountLkr) * 100);
    if (!merchant || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(amount) || amount <= 0) throw new Error("Review the merchant, date, and LKR amount.");
    const category = String(input.category || "Other").slice(0, 60);
    const currency = String(input.currency || "LKR").toUpperCase().slice(0, 3);
    const billId = randomUUID(), transactionId = randomUUID(), createdAt = new Date().toISOString();
    const upload = serverDb().doc(`mobileBillUploads/${uploadId}`);
    await serverDb().runTransaction(async transaction => {
      const saved = await transaction.get(upload);
      const file = saved.data();
      if (!file || file.uid !== uid || file.expiresAt < Date.now()) throw new Error("This bill upload expired. Upload it again.");
      transaction.set(serverDb().doc(`users/${uid}/bills/${billId}`), { id: billId, merchant, date, amount, originalAmount: Number(input.originalAmount || 0), currency, category, items: [], fileName: file.fileName, driveFileId: file.driveFileId, driveUrl: file.driveUrl, transactionId, createdAt });
      transaction.set(serverDb().doc(`users/${uid}/transactions/${transactionId}`), { id: transactionId, kind: "expense", amount, category, description: merchant, date, createdAt, billId });
      transaction.delete(upload);
    });
    return NextResponse.json({ billId, transactionId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save this bill." }, { status: 400 });
  }
}
