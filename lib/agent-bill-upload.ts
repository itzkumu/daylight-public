import "server-only";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { billFolder, driveAccessToken, driveRequest } from "./drive-server";
import { scanAgentBill } from "./agent-bill-scan";
import { seal, serverDb, unseal } from "./social-server";

type Arguments = Record<string, unknown>;
type BillDetails = {
  merchant: string; date: string; amount: number; originalAmount: number;
  currency: string; category: string; items: string[]; fileName: string; mimeType: string;
};
type UploadRecord = {
  fileName?: string; mimeType?: string; details?: BillDetails; sizeBytes: number; createdAt: string;
  sealedUrl: string; uploadTokenHash?: string; driveFile?: DriveFile; scan?: Awaited<ReturnType<typeof scanAgentBill>>; scanVersion?: number; completedAt?: string;
};
type DriveFile = { id?: string; webViewLink?: string };
const maxBytes = 5 * 1024 * 1024;
const maxProxyChunkBytes = 4 * 1024 * 1024;
const driveChunkBytes = 256 * 1024;
const mimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const categories = new Set(["Food & drink", "Transport", "Shopping", "Bills", "Subscriptions", "Health", "Other"]);
const uploads = (uid: string) => serverDb().collection("users").doc(uid).collection("agentBillUploads");
const bills = (uid: string) => serverDb().collection("users").doc(uid).collection("bills");
const transactions = (uid: string) => serverDb().collection("users").doc(uid).collection("transactions");

function required(value: unknown, label: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`${label} must be 1–${max} characters.`);
  return value.trim();
}
function date(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T12:00:00Z`)) || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error("Use a valid YYYY-MM-DD date.");
  return value;
}
function lkrCents(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Enter a valid LKR amount.");
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100000000000) throw new Error("Enter a valid LKR amount.");
  return cents;
}
function details(args: Arguments, fileName: string, mimeType: string): BillDetails {
  const originalAmount = args.originalAmount == null ? 0 : args.originalAmount;
  if (typeof originalAmount !== "number" || !Number.isFinite(originalAmount) || originalAmount < 0 || originalAmount > 1000000000) throw new Error("Enter a valid amount shown on the bill.");
  const currency = args.currency == null ? "LKR" : required(args.currency, "Currency", 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Use a three-letter currency code.");
  const category = args.category == null ? "Other" : String(args.category);
  if (!categories.has(category)) throw new Error("Choose a Daylight bill category.");
  if (args.items != null && (!Array.isArray(args.items) || args.items.length > 50 || args.items.some(item => typeof item !== "string" || item.length > 120))) throw new Error("Items must be a list of up to 50 names.");
  return {
    merchant: required(args.merchant, "Store or biller", 180), date: date(args.date), amount: lkrCents(args.amountLkr),
    originalAmount, currency, category, items: (args.items as string[] | undefined || []).map(item => item.trim()).filter(Boolean),
    fileName, mimeType,
  };
}
function checkedUploadId(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/.test(value)) throw new Error("Invalid bill upload ID.");
  return value;
}
function sessionUrl(record: UploadRecord) {
  const url = unseal<{ url: string }>(record.sealedUrl).url;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "www.googleapis.com" || !parsed.pathname.startsWith("/upload/drive/v3/files")) throw new Error("Invalid Google Drive upload session.");
  return url;
}
async function uploadRequest(uid: string, record: UploadRecord, init: RequestInit) {
  return fetch(sessionUrl(record), { ...init, cache: "no-store", redirect: "manual", headers: { Authorization: `Bearer ${await driveAccessToken(uid)}`, ...init.headers } });
}
async function savedBill(uid: string, uploadId: string, record: UploadRecord, file: DriveFile) {
  if (!file.id) throw new Error("Google Drive did not return the uploaded file ID.");
  const billId = uploadId;
  const transactionId = `bill-${billId}`;
  const data = record.details;
  if (!data) throw new Error("Review the scanned bill details before saving it.");
  const bill = {
    id: billId, merchant: data.merchant, date: data.date, amount: data.amount,
    originalAmount: data.originalAmount, currency: data.currency, category: data.category, items: data.items,
    fileName: data.fileName, driveFileId: file.id, driveUrl: file.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`,
    transactionId, createdAt: record.createdAt,
  };
  const transaction = { id: transactionId, kind: "expense", amount: data.amount, category: data.category, description: data.merchant, date: data.date, createdAt: record.createdAt, billId };
  const saved = await serverDb().runTransaction(async transactionBatch => {
    const billReference = bills(uid).doc(billId);
    const uploadReference = uploads(uid).doc(uploadId);
    const existing = await transactionBatch.get(billReference);
    const upload = await transactionBatch.get(uploadReference);
    if (existing.exists) return existing.data()!;
    if (upload.get("completedAt")) return null;
    transactionBatch.create(billReference, bill);
    transactionBatch.create(transactions(uid).doc(transactionId), transaction);
    transactionBatch.update(uploadReference, { completedAt: new Date().toISOString() });
    return bill;
  });
  return saved ? { complete: true, bill: { ...saved, amount: typeof saved.amount === "number" ? saved.amount / 100 : saved.amount } } : { complete: true, billRemoved: true };
}

export async function beginAgentBillUpload(uid: string, args: Arguments, origin: string) {
  const sizeBytes = args.sizeBytes;
  if (!Number.isInteger(sizeBytes) || Number(sizeBytes) <= 0 || Number(sizeBytes) > maxBytes) throw new Error("Bill file must be 1 byte to 5 MB.");
  const fileName = required(args.fileName, "File name", 240).replace(/[\\/\x00-\x1f]/g, "_");
  const mimeType = String(args.mimeType);
  if (!mimeTypes.has(mimeType)) throw new Error("Choose a JPG, PNG, WebP, or PDF bill.");
  const hasDetails = args.merchant != null || args.date != null || args.amountLkr != null;
  const reviewed = hasDetails ? details(args, fileName, mimeType) : undefined;
  const folderId = await billFolder(uid);
  const response = await driveRequest(uid, "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink", {
    method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mimeType, "X-Upload-Content-Length": String(sizeBytes) },
    body: JSON.stringify({ name: fileName, mimeType, parents: [folderId] }),
  });
  const url = response.headers.get("location");
  if (!url) throw new Error("Google Drive did not start the upload.");
  const id = randomUUID();
  const uploadToken = randomBytes(32).toString("base64url");
  const record: UploadRecord = { fileName, mimeType, ...(reviewed ? { details: reviewed } : {}), sizeBytes: Number(sizeBytes), createdAt: new Date().toISOString(), sealedUrl: seal({ url }), uploadTokenHash: createHash("sha256").update(uploadToken).digest("hex") };
  sessionUrl(record);
  await uploads(uid).doc(id).create(record);
  const uploadUrl = new URL(`/api/mcp/bill-upload/${id}?token=${uploadToken}`, origin).toString();
  return {
    uploadId: id, uploadUrl, method: "PUT", mimeType,
    sizeBytes: record.sizeBytes, contentRange: `bytes 0-${record.sizeBytes - 1}/${record.sizeBytes}`,
    nextStep: "PUT the raw file bytes to this private Daylight uploadUrl. Send one PUT for files up to 4 MiB, with Content-Type and the provided Content-Range; Daylight adds Google Drive authorization. For larger files, use chunks no larger than 4 MiB and multiples of 256 KiB except the final chunk. Keep uploadUrl private. Then call scan_bill_upload with uploadId, review its draft with the user, and call complete_bill_upload with the reviewed details.",
  };
}

async function uploadedFile(uid: string, uploadId: string, record: UploadRecord) {
  if (record.driveFile?.id) return { complete: true as const, file: record.driveFile };
  if (Date.now() - Date.parse(record.createdAt) > 24 * 60 * 60 * 1000) throw new Error("Bill upload expired. Start a new upload.");
  const status = await uploadRequest(uid, record, { method: "PUT", headers: { "Content-Range": `bytes */${record.sizeBytes}` } });
  if (status.ok) {
    const file = await status.json() as DriveFile;
    if (!file.id) throw new Error("Google Drive did not return the uploaded file ID.");
    await uploads(uid).doc(uploadId).update({ driveFile: file });
    return { complete: true as const, file };
  }
  if (status.status !== 308) throw new Error(`Google Drive upload status failed (${status.status}). Start a new upload if the session expired.`);
  const range = status.headers.get("range");
  const nextOffset = range ? Number(/^bytes=0-(\d+)$/.exec(range)?.[1]) + 1 : 0;
  if (!Number.isSafeInteger(nextOffset) || nextOffset < 0 || nextOffset > record.sizeBytes) throw new Error("Google Drive returned invalid upload progress.");
  return { complete: false as const, nextOffset, sizeBytes: record.sizeBytes, mimeType: record.mimeType || record.details?.mimeType, nextStep: "Continue PUTting bytes to the private Daylight uploadUrl from begin_bill_upload, starting at nextOffset. Do not use a Google Drive URL." };
}

export class BillUploadHttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function uploadAgentBillBytes(uid: string, uploadIdValue: string, token: string, bytes: Uint8Array, contentRange: string | null) {
  const uploadId = checkedUploadId(uploadIdValue);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new BillUploadHttpError(401, "Invalid upload link. Start a new bill upload.");
  const snapshot = await uploads(uid).doc(uploadId).get();
  if (!snapshot.exists) throw new BillUploadHttpError(401, "Invalid upload link. Start a new bill upload.");
  const record = snapshot.data() as UploadRecord;
  const expected = Buffer.from(record.uploadTokenHash || "", "hex");
  const actual = createHash("sha256").update(token).digest();
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new BillUploadHttpError(401, "Invalid upload link. Start a new bill upload.");
  if (record.completedAt) throw new BillUploadHttpError(410, "This bill has already been saved.");
  if (Date.now() - Date.parse(record.createdAt) > 24 * 60 * 60 * 1000) throw new BillUploadHttpError(410, "Bill upload expired. Start a new upload.");
  if (!bytes.length || bytes.length > maxProxyChunkBytes) throw new BillUploadHttpError(413, "Send 1 byte to 4 MiB per PUT. Use 256 KiB chunks for larger files.");

  const parsed = contentRange && /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
  if (contentRange && !parsed) throw new BillUploadHttpError(400, "Invalid Content-Range. Use bytes START-END/TOTAL.");
  let start = parsed ? Number(parsed[1]) : 0;
  let end = parsed ? Number(parsed[2]) : bytes.length - 1;
  const total = parsed ? Number(parsed[3]) : record.sizeBytes;
  if (total !== record.sizeBytes || end < start || end >= total || end - start + 1 !== bytes.length || (!parsed && bytes.length !== total)) {
    throw new BillUploadHttpError(400, `Upload range must match ${record.sizeBytes} total bytes and the exact bytes sent.`);
  }

  const progress = await uploadedFile(uid, uploadId, record);
  if (progress.complete) return { uploaded: true, nextStep: "Call scan_bill_upload with this uploadId." };
  if (start === 0 && bytes.length === total && progress.nextOffset > 0) {
    bytes = bytes.subarray(progress.nextOffset);
    start = progress.nextOffset;
    end = total - 1;
  }
  if (start !== progress.nextOffset) throw new BillUploadHttpError(409, `Upload is at byte ${progress.nextOffset}. Resume from that byte, or retry the full file.`);
  if (end + 1 < total && (bytes.length % driveChunkBytes !== 0 || start % driveChunkBytes !== 0)) {
    throw new BillUploadHttpError(400, "Nonfinal chunks must be multiples of 256 KiB.");
  }
  const response = await uploadRequest(uid, record, {
    method: "PUT",
    headers: { "Content-Type": record.mimeType || "application/octet-stream", "Content-Length": String(bytes.length), "Content-Range": `bytes ${start}-${end}/${total}` },
    body: new Uint8Array(bytes),
  });
  if (response.ok) {
    const file = await response.json() as DriveFile;
    if (!file.id) throw new Error("Google Drive did not return the uploaded file ID.");
    await uploads(uid).doc(uploadId).update({ driveFile: file });
    return { uploaded: true, nextStep: "Call scan_bill_upload with this uploadId." };
  }
  if (response.status === 308) {
    const range = response.headers.get("range");
    const nextOffset = range ? Number(/^bytes=0-(\d+)$/.exec(range)?.[1]) + 1 : 0;
    if (!Number.isSafeInteger(nextOffset) || nextOffset < 0 || nextOffset > total) throw new Error("Google Drive returned invalid upload progress.");
    return { uploaded: false, nextOffset, sizeBytes: total, nextStep: "PUT the next chunk to the same private Daylight uploadUrl." };
  }
  const message = (await response.json().catch(() => null) as { error?: { message?: string } } | null)?.error?.message;
  throw new BillUploadHttpError(502, `Google Drive rejected the upload (${response.status}). ${message ? message.slice(0, 240) : "Check the file bytes and try again."}`);
}

export async function scanAgentBillUpload(uid: string, args: Arguments) {
  const uploadId = checkedUploadId(args.uploadId);
  const snapshot = await uploads(uid).doc(uploadId).get();
  if (!snapshot.exists) throw new Error("Bill upload not found. Start a new upload.");
  const record = snapshot.data() as UploadRecord;
  if (record.completedAt) throw new Error("This bill was already saved or removed.");
  const uploaded = await uploadedFile(uid, uploadId, record);
  if (!uploaded.complete) return uploaded;
  if (!uploaded.file.id) throw new Error("Google Drive did not return the uploaded file ID.");
  const scanVersion = 3;
  const scan = record.scan && record.scanVersion === scanVersion
    ? record.scan
    : await scanAgentBill(uid, uploaded.file.id, record.mimeType || record.details?.mimeType || "");
  if (record.scanVersion !== scanVersion) await uploads(uid).doc(uploadId).update({ scan, scanVersion });
  return { uploaded: true, saved: false, scan, nextStep: "Review the merchant, date, currency, and final amount with the user. For non-LKR bills, obtain the amount actually paid in LKR. Then call complete_bill_upload with uploadId and reviewed details. The scan alone does not save an expense." };
}

export async function completeAgentBillUpload(uid: string, args: Arguments) {
  const uploadId = checkedUploadId(args.uploadId);
  const saved = await bills(uid).doc(uploadId).get();
  if (saved.exists) {
    const bill = saved.data()!;
    return { complete: true, bill: { ...bill, amount: typeof bill.amount === "number" ? bill.amount / 100 : bill.amount } };
  }
  const snapshot = await uploads(uid).doc(uploadId).get();
  if (!snapshot.exists) throw new Error("Bill upload not found. Start a new upload.");
  const record = snapshot.data() as UploadRecord;
  if (record.completedAt) return { complete: true, billRemoved: true };
  const reviewed = args.merchant != null || args.date != null || args.amountLkr != null
    ? details(args, record.fileName || record.details?.fileName || "", record.mimeType || record.details?.mimeType || "")
    : record.details;
  if (!reviewed) throw new Error("Call scan_bill_upload, review its draft, then provide merchant, date, and amountLkr to save this bill.");
  const uploaded = await uploadedFile(uid, uploadId, record);
  if (!uploaded.complete) return uploaded;
  return savedBill(uid, uploadId, { ...record, details: reviewed }, uploaded.file);
}
