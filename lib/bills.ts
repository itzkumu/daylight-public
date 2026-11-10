import { getAI, getGenerativeModel, GoogleAIBackend, Schema } from "firebase/ai";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { collection, doc, getDocs, query, where, writeBatch } from "firebase/firestore";
import { getFirebase, type Bill, type Transaction } from "./firebase-data";
import { connectionResponse } from "./connection-response";

export type ScannedBill = {
  merchant: string;
  date: string;
  total: number;
  currency: string;
  category: string;
  items: string[];
};

export type BillReview = ScannedBill & { amountLkr: number };

const categories = ["Food & drink", "Transport", "Shopping", "Bills", "Subscriptions", "Health", "Other"];
let appCheckStarted = false;

function supportedFile(file: File) {
  if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type)) {
    throw new Error("Choose a JPG, PNG, WebP, or PDF bill.");
  }
  if (file.size > 5 * 1024 * 1024) throw new Error("Choose a file smaller than 5 MB.");
}

function base64File(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") return reject(new Error("Could not read this bill."));
      resolve(result.split(",")[1]);
    };
    reader.onerror = () => reject(new Error("Could not read this bill."));
    reader.readAsDataURL(file);
  });
}

export async function scanBillWithAI(file: File): Promise<ScannedBill> {
  supportedFile(file);
  const firebase = getFirebase();
  if (!firebase) throw new Error("Connect Firebase before scanning bills.");
  const siteKey = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY;
  if (!siteKey) throw new Error("Bill scanning needs the Firebase App Check site key in Vercel settings.");
  if (!appCheckStarted) {
    initializeAppCheck(firebase.app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
    appCheckStarted = true;
  }
  const ai = getAI(firebase.app, { backend: new GoogleAIBackend() });
  const model = getGenerativeModel(ai, {
    model: "gemini-3.8-flash",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: Schema.object({
        properties: {
          merchant: Schema.string(),
          date: Schema.string(),
          total: Schema.number(),
          currency: Schema.string(),
          category: Schema.string(),
          items: Schema.array({ items: Schema.string() }),
        },
      }),
    },
  });
  const result = await model.generateContent([
    `Read this receipt or bill. Return the merchant, bill date as YYYY-MM-DD, final amount paid as a number, ISO currency code, category, and purchased item names. Choose the category from: ${categories.join(", ")}. If a field is unclear, use an empty string or zero; do not guess. Use the final total including tax.`,
    { inlineData: { data: await base64File(file), mimeType: file.type } },
  ]);
  const parsed = JSON.parse(result.response.text()) as Partial<ScannedBill>;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return {
    merchant: String(parsed.merchant ?? "").trim().slice(0, 180),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.date ?? "")) ? String(parsed.date) : today,
    total: Number.isFinite(Number(parsed.total)) ? Math.max(0, Number(parsed.total)) : 0,
    currency: String(parsed.currency ?? "LKR").trim().toUpperCase().slice(0, 3) || "LKR",
    category: categories.includes(String(parsed.category)) ? String(parsed.category) : "Other",
    items: Array.isArray(parsed.items) ? parsed.items.map(item => String(item).trim().slice(0, 120)).filter(Boolean).slice(0, 50) : [],
  };
}

async function authenticatedDriveRequest(userId: string, path: string, method = "GET") {
  const firebase = getFirebase();
  if (!firebase) throw new Error("Connect Firebase before saving bills.");
  const currentUser = firebase.auth.currentUser;
  if (!currentUser || currentUser.uid !== userId) throw new Error("Sign in again before saving bills.");
  return fetch(path, { method, headers: { Authorization: `Bearer ${await currentUser.getIdToken()}` }, cache: "no-store" });
}

export type DriveConnection = { configured: boolean; connected: boolean; needsReconnect?: boolean; email?: string };
export async function getDriveConnection(userId: string) {
  return connectionResponse<DriveConnection>(await authenticatedDriveRequest(userId, "/api/drive"), "Could not check Google Drive");
}
export async function connectDrive(userId: string) {
  const data = await connectionResponse<{ url?: string }>(await authenticatedDriveRequest(userId, "/api/drive", "POST"), "Could not start Google Drive connection");
  if (!data.url) throw new Error("Google did not return a Drive authorization page.");
  window.location.assign(data.url);
}
export async function disconnectDrive(userId: string) {
  await connectionResponse(await authenticatedDriveRequest(userId, "/api/drive", "DELETE"), "Could not disconnect Google Drive");
}
async function driveSession(userId: string) {
  return connectionResponse<{ token: string; folderId: string }>(await authenticatedDriveRequest(userId, "/api/drive/session"), "Could not access Google Drive");
}

async function driveFetch(url: string, token: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(detail?.error?.message || `Google Drive request failed (${response.status}).`);
  }
  return response;
}

async function uploadBill(file: File, token: string, folderId: string) {
  const boundary = `daylight-${crypto.randomUUID()}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify({ name: file.name, mimeType: file.type, parents: [folderId] }),
    `\r\n--${boundary}\r\nContent-Type: ${file.type}\r\n\r\n`,
    file,
    `\r\n--${boundary}--`,
  ]);
  const response = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", token, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  return (await response.json()) as { id: string; webViewLink?: string };
}

export async function saveBill(userId: string, file: File, review: BillReview) {
  supportedFile(file);
  const firebase = getFirebase();
  if (!firebase) throw new Error("Connect Firebase before saving bills.");
  const merchant = review.merchant.trim().slice(0, 180);
  if (!merchant) throw new Error("Enter the store or biller name.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(review.date)) throw new Error("Choose a valid date.");
  const amount = Math.round(review.amountLkr * 100);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000000) throw new Error("Enter the amount paid in LKR.");
  const { token, folderId } = await driveSession(userId);
  const uploaded = await uploadBill(file, token, folderId);
  const billId = crypto.randomUUID();
  const transactionId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const bill: Bill = {
    id: billId, merchant, date: review.date, amount,
    originalAmount: Number.isFinite(review.total) ? Math.max(0, review.total) : 0,
    currency: review.currency.trim().toUpperCase().slice(0, 3) || "LKR",
    category: categories.includes(review.category) ? review.category : "Other",
    items: review.items.map(item => item.trim().slice(0, 120)).filter(Boolean).slice(0, 50),
    fileName: file.name.slice(0, 240), driveFileId: uploaded.id,
    driveUrl: uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
    transactionId, createdAt,
  };
  const transaction: Transaction = {
    id: transactionId, kind: "expense", amount, category: bill.category,
    description: merchant, date: bill.date, createdAt, billId,
  };
  try {
    const batch = writeBatch(firebase.db);
    batch.set(doc(firebase.db, "users", userId, "bills", billId), bill);
    batch.set(doc(firebase.db, "users", userId, "transactions", transactionId), transaction);
    await batch.commit();
    return bill;
  } catch (error) {
    await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(uploaded.id)}`, token, { method: "DELETE" }).catch(() => {});
    throw error;
  }
}

export async function removeBillFromDashboard(userId: string, bill: Bill) {
  const firebase = getFirebase();
  if (!firebase) throw new Error("Connect Firebase before changing bills.");
  const linked = await getDocs(query(collection(firebase.db, "users", userId, "transactions"), where("billId", "==", bill.id)));
  const batch = writeBatch(firebase.db);
  batch.delete(doc(firebase.db, "users", userId, "bills", bill.id));
  batch.delete(doc(firebase.db, "users", userId, "transactions", bill.transactionId || `bill-${bill.id}`));
  linked.docs.forEach(entry => batch.delete(entry.ref));
  await batch.commit();
}
