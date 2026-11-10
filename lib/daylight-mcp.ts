import "server-only";
import { randomUUID } from "node:crypto";
import { removeTaskEvent, syncTask } from "./calendar-server";
import { serverDb } from "./social-server";
import type { AgentScope } from "./agent-key";
import { beginAgentBillUpload, completeAgentBillUpload, scanAgentBillUpload } from "./agent-bill-upload";
import { projectIncomeEntries } from "./project-income";
import type { Project } from "./firebase-data";

type Arguments = Record<string, unknown>;
type Tool = { name: string; description: string; inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false }; annotations?: { readOnlyHint: boolean } };
const text = { type: "string" };
const limit = { type: "integer", minimum: 1, maximum: 100, description: "Maximum number of recent entries (default 30)." };
const billDetails = {
  merchant: text,
  date: { type: "string", description: "Reviewed expense date in YYYY-MM-DD format." },
  amountLkr: { type: "number", exclusiveMinimum: 0, description: "Reviewed amount actually paid in LKR." },
  originalAmount: { type: "number", minimum: 0, description: "Total printed on the bill in its original currency, or 0 if unknown." },
  currency: { type: "string", description: "Three-letter currency code; defaults to LKR." },
  category: { type: "string", enum: ["Food & drink", "Transport", "Shopping", "Bills", "Subscriptions", "Health", "Other"] },
  items: { type: "array", items: text, maxItems: 50 },
};
const readTools: Tool[] = [
  { name: "list_tasks", description: "List Daylight tasks, including completion, due date, and notes.", inputSchema: { type: "object", properties: { limit }, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "list_transactions", description: "List Daylight income and expense entries, including project payments. Project income is managed through its project. Amounts are returned in LKR, not cents.", inputSchema: { type: "object", properties: { limit }, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "list_posts", description: "List Daylight content ideas and publishing plans. These are plans; this tool does not publish posts.", inputSchema: { type: "object", properties: { limit }, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "list_bills", description: "List saved bill details and Google Drive file links.", inputSchema: { type: "object", properties: { limit }, additionalProperties: false }, annotations: { readOnlyHint: true } },
];
const writeTools: Tool[] = [
  { name: "create_task", description: "Create a Daylight task. A dated task is also sent to connected Google Calendar when possible.", inputSchema: { type: "object", properties: { title: text, notes: text, dueAt: { type: "string", description: "ISO 8601 date and time with timezone, or omit for no due date." } }, required: ["title"], additionalProperties: false }, annotations: { readOnlyHint: false } },
  { name: "set_task_done", description: "Mark a Daylight task complete or incomplete.", inputSchema: { type: "object", properties: { id: text, done: { type: "boolean" } }, required: ["id", "done"], additionalProperties: false }, annotations: { readOnlyHint: false } },
  { name: "delete_task", description: "Delete a Daylight task and its linked Google Calendar event when one exists.", inputSchema: { type: "object", properties: { id: text }, required: ["id"], additionalProperties: false }, annotations: { readOnlyHint: false } },
  { name: "add_transaction", description: "Add a Daylight income or expense in LKR.", inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["income", "expense"] }, amount: { type: "number", exclusiveMinimum: 0, description: "LKR amount, for example 1250.50." }, category: text, description: text, date: { type: "string", description: "Date in YYYY-MM-DD format." } }, required: ["kind", "amount", "date"], additionalProperties: false }, annotations: { readOnlyHint: false } },
  { name: "update_transaction", description: "Edit a manual income or expense. A bill-linked expense stays an expense and its bill display details update too.", inputSchema: { type: "object", properties: { id: text, kind: { type: "string", enum: ["income", "expense"] }, amount: { type: "number", exclusiveMinimum: 0, description: "LKR amount." }, category: text, description: text, date: { type: "string", description: "YYYY-MM-DD." } }, required: ["id", "kind", "amount", "category", "description", "date"], additionalProperties: false }, annotations: { readOnlyHint: false } },
  { name: "delete_transaction", description: "Remove a manual money entry. For a bill-linked expense use remove_bill instead.", inputSchema: { type: "object", properties: { id: text }, required: ["id"], additionalProperties: false }, annotations: { readOnlyHint: false } },
  { name: "begin_bill_upload", description: "Start uploading a bill without needing its merchant, date, or amount. Provide the real file name, MIME type, and byte size (up to 5 MB). PUT raw file bytes to the returned private Daylight upload URL, not directly to Google Drive. Daylight adds Drive authorization. For files up to 4 MiB, send one PUT with Content-Type and the returned Content-Range. For larger files, send chunks up to 4 MiB in multiples of 256 KiB except the final chunk. Do not show or log the upload URL. Then call scan_bill_upload.", inputSchema: { type: "object", properties: { fileName: text, mimeType: { type: "string", enum: ["image/jpeg", "image/png", "image/webp", "application/pdf"] }, sizeBytes: { type: "integer", minimum: 1, maximum: 5242880 } }, required: ["fileName", "mimeType", "sizeBytes"], additionalProperties: false }, annotations: { readOnlyHint: false } },
  { name: "scan_bill_upload", description: "After uploading the file bytes, scan the private Google Drive bill using Google's cloud OCR. Returns a draft merchant, date, total, currency, category, extracted text, and missing fields. This does not save a bill or expense. Review the details with the user; for a non-LKR bill get the amount actually paid in LKR. The temporary cloud scan document is removed after reading.", inputSchema: { type: "object", properties: { uploadId: text }, required: ["uploadId"], additionalProperties: false }, annotations: { readOnlyHint: false } },
  { name: "complete_bill_upload", description: "Save the uploaded bill and linked expense after reviewing the scan. Provide merchant, date, and amount actually paid in LKR. If the upload is incomplete, returns nextOffset so the file can be resumed. Calling again after success is safe. This action does not run OCR.", inputSchema: { type: "object", properties: { uploadId: text, ...billDetails }, required: ["uploadId", "merchant", "date", "amountLkr"], additionalProperties: false }, annotations: { readOnlyHint: false } },
  { name: "remove_bill", description: "Remove a bill and its linked expense from Daylight. The original file stays in Google Drive, matching the Daylight bill screen.", inputSchema: { type: "object", properties: { id: text }, required: ["id"], additionalProperties: false }, annotations: { readOnlyHint: false } },
  { name: "create_post_plan", description: "Save a content idea in Daylight. This does not publish to a social platform.", inputSchema: { type: "object", properties: { title: text, platform: { type: "string", enum: ["Instagram", "TikTok", "Facebook"] }, caption: text, scheduledAt: { type: "string", description: "ISO 8601 date and time with timezone, or omit." } }, required: ["title", "platform"], additionalProperties: false }, annotations: { readOnlyHint: false } },
  { name: "update_post_plan", description: "Edit a Daylight content plan. This does not publish to a social platform.", inputSchema: { type: "object", properties: { id: text, title: text, platform: { type: "string", enum: ["Instagram", "TikTok", "Facebook"] }, caption: text, scheduledAt: { type: "string", description: "ISO 8601 date and time with timezone, or omit." } }, required: ["id", "title", "platform"], additionalProperties: false }, annotations: { readOnlyHint: false } },
  { name: "set_post_published", description: "Mark a Daylight content plan as published or undo that mark. This does not publish to a social platform.", inputSchema: { type: "object", properties: { id: text, published: { type: "boolean" } }, required: ["id", "published"], additionalProperties: false }, annotations: { readOnlyHint: false } },
  { name: "delete_post_plan", description: "Delete a Daylight content plan. This does not remove a post from a social platform.", inputSchema: { type: "object", properties: { id: text }, required: ["id"], additionalProperties: false }, annotations: { readOnlyHint: false } },
];

export function availableTools(scope: AgentScope) { return scope === "write" ? [...readTools, ...writeTools] : readTools; }
const userCollection = (uid: string, name: string) => serverDb().collection("users").doc(uid).collection(name);
const take = (value: unknown) => Number.isInteger(value) ? Math.max(1, Math.min(100, Number(value))) : 30;
const requiredString = (value: unknown, label: string, max: number) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`${label} must be 1–${max} characters.`);
  return value.trim();
};
const optionalDateTime = (value: unknown) => {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || Number.isNaN(Date.parse(value))) throw new Error("Use an ISO date and time with timezone.");
  return new Date(value).toISOString();
};
const day = (value: unknown) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Use a valid YYYY-MM-DD date.");
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("Use a valid YYYY-MM-DD date.");
  return value;
};
const amountCents = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Enter a valid LKR amount.");
  const amount = Math.round(value * 100);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100000000000) throw new Error("Enter a valid LKR amount.");
  return amount;
};

export async function callTool(uid: string, scope: AgentScope, name: string, args: Arguments, origin: string) {
  if (!availableTools(scope).some(tool => tool.name === name)) throw new Error("Tool is unavailable for this key.");
  if (name.startsWith("list_")) {
    if (name === "list_transactions") {
      const [saved, projects, bills] = await Promise.all([
        userCollection(uid, "transactions").orderBy("date", "desc").limit(take(args.limit)).get(),
        userCollection(uid, "projects").get(),
        userCollection(uid, "bills").get(),
      ]);
      const billIds = new Set(bills.docs.map(doc => doc.id));
      const entries = [...saved.docs.map(doc => doc.data()).filter(row => !row.billId || billIds.has(String(row.billId))), ...projectIncomeEntries(projects.docs.map(doc => doc.data() as Project))]
        .sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, take(args.limit))
        .map(row => ({ ...row, amount: typeof row.amount === "number" ? row.amount / 100 : row.amount }));
      return { entries };
    }
    const collection = name === "list_tasks" ? "tasks" : name === "list_transactions" ? "transactions" : name === "list_posts" ? "posts" : "bills";
    const sortField = collection === "transactions" || collection === "bills" ? "date" : "createdAt";
    const snapshot = await userCollection(uid, collection).orderBy(sortField, "desc").limit(take(args.limit)).get();
    const entries = snapshot.docs.map(doc => {
      const row = doc.data();
      if (collection === "transactions" || collection === "bills") return { ...row, amount: typeof row.amount === "number" ? row.amount / 100 : row.amount };
      return row;
    });
    return { entries };
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  if (name === "create_task") {
    const title = requiredString(args.title, "Title", 180);
    const dueAt = optionalDateTime(args.dueAt);
    const notes = typeof args.notes === "string" ? args.notes.slice(0, 1000) : "";
    const task = { id, title, dueAt, notes, done: false, createdAt: now };
    await userCollection(uid, "tasks").doc(id).create(task);
    let calendar = "No due date";
    if (dueAt) {
      try { await syncTask(uid, id); calendar = "Synced to Google Calendar"; }
      catch { calendar = "Saved in Daylight; Google Calendar sync is unavailable"; }
    }
    return { task, calendar };
  }
  if (name === "set_task_done") {
    const taskId = requiredString(args.id, "Task ID", 80);
    if (typeof args.done !== "boolean") throw new Error("done must be true or false.");
    const ref = userCollection(uid, "tasks").doc(taskId);
    if (!(await ref.get()).exists) throw new Error("Task not found.");
    await ref.update({ done: args.done });
    return { id: taskId, done: args.done };
  }
  if (name === "delete_task") {
    const taskId = requiredString(args.id, "Task ID", 80);
    const reference = userCollection(uid, "tasks").doc(taskId);
    if (!(await reference.get()).exists) throw new Error("Task not found.");
    await removeTaskEvent(uid, taskId);
    await reference.delete();
    return { id: taskId, deleted: true };
  }
  if (name === "add_transaction") {
    if (args.kind !== "income" && args.kind !== "expense") throw new Error("Choose income or expense.");
    const amount = amountCents(args.amount);
    const entry = { id, kind: args.kind, amount, category: typeof args.category === "string" ? args.category.trim().slice(0, 60) || "Other" : "Other", description: typeof args.description === "string" ? args.description.trim().slice(0, 180) : "", date: day(args.date), createdAt: now };
    await userCollection(uid, "transactions").doc(id).create(entry);
    return { ...entry, amount: amount / 100 };
  }
  if (name === "update_transaction") {
    const entryId = requiredString(args.id, "Entry ID", 80);
    if (args.kind !== "income" && args.kind !== "expense") throw new Error("Choose income or expense.");
    const amount = amountCents(args.amount);
    const date = day(args.date);
    const category = requiredString(args.category, "Category", 60);
    const description = typeof args.description === "string" ? args.description.trim().slice(0, 180) : "";
    const reference = userCollection(uid, "transactions").doc(entryId);
    const saved = await reference.get();
    if (!saved.exists) throw new Error("Money entry not found.");
    const billId = saved.get("billId") as string | undefined;
    if (billId && args.kind !== "expense") throw new Error("A bill-linked entry must stay an expense.");
    const batch = serverDb().batch();
    batch.update(reference, { kind: args.kind, amount, category, description, date });
    if (billId) {
      const billReference = userCollection(uid, "bills").doc(billId);
      if (!(await billReference.get()).exists) throw new Error("Linked bill not found.");
      batch.update(billReference, { amount, category, date, merchant: description || "Purchase" });
    }
    await batch.commit();
    return { id: entryId, kind: args.kind, amount: amount / 100, category, description, date, billId: billId || null };
  }
  if (name === "delete_transaction") {
    const entryId = requiredString(args.id, "Entry ID", 80);
    const reference = userCollection(uid, "transactions").doc(entryId);
    const saved = await reference.get();
    if (!saved.exists) throw new Error("Money entry not found.");
    if (saved.get("billId")) throw new Error("Use remove_bill for a bill-linked expense.");
    await reference.delete();
    return { id: entryId, deleted: true };
  }
  if (name === "begin_bill_upload") return beginAgentBillUpload(uid, args, origin);
  if (name === "scan_bill_upload") return scanAgentBillUpload(uid, args);
  if (name === "complete_bill_upload") return completeAgentBillUpload(uid, args);
  if (name === "remove_bill") {
    const billId = requiredString(args.id, "Bill ID", 80);
    const reference = userCollection(uid, "bills").doc(billId);
    const saved = await reference.get();
    if (!saved.exists) throw new Error("Bill not found.");
    const transactionId = saved.get("transactionId") as string | undefined || `bill-${billId}`;
    const linked = await userCollection(uid, "transactions").where("billId", "==", billId).get();
    const batch = serverDb().batch();
    batch.delete(reference);
    batch.delete(userCollection(uid, "transactions").doc(transactionId));
    linked.docs.forEach(entry => batch.delete(entry.ref));
    await batch.commit();
    return { id: billId, deleted: true, originalFile: "Still in Google Drive" };
  }
  if (name === "create_post_plan") {
    const title = requiredString(args.title, "Title", 180);
    if (!["Instagram", "TikTok", "Facebook"].includes(String(args.platform))) throw new Error("Choose Instagram, TikTok, or Facebook.");
    const scheduledAt = optionalDateTime(args.scheduledAt);
    const post = { id, title, platform: args.platform, caption: typeof args.caption === "string" ? args.caption.trim().slice(0, 2200) : "", scheduledAt, status: scheduledAt ? "scheduled" : "idea", createdAt: now };
    await userCollection(uid, "posts").doc(id).create(post);
    return post;
  }
  if (name === "update_post_plan") {
    const postId = requiredString(args.id, "Post ID", 80);
    const title = requiredString(args.title, "Title", 180);
    if (!["Instagram", "TikTok", "Facebook"].includes(String(args.platform))) throw new Error("Choose Instagram, TikTok, or Facebook.");
    const scheduledAt = optionalDateTime(args.scheduledAt);
    const update = { title, platform: args.platform, caption: typeof args.caption === "string" ? args.caption.trim().slice(0, 2200) : "", scheduledAt, status: scheduledAt ? "scheduled" : "idea" };
    const reference = userCollection(uid, "posts").doc(postId);
    if (!(await reference.get()).exists) throw new Error("Post plan not found.");
    await reference.update(update);
    return { id: postId, ...update };
  }
  if (name === "set_post_published") {
    const postId = requiredString(args.id, "Post ID", 80);
    if (typeof args.published !== "boolean") throw new Error("published must be true or false.");
    const reference = userCollection(uid, "posts").doc(postId);
    const saved = await reference.get();
    if (!saved.exists) throw new Error("Post plan not found.");
    const status = args.published ? "published" : saved.get("scheduledAt") ? "scheduled" : "idea";
    await reference.update({ status });
    return { id: postId, status };
  }
  if (name === "delete_post_plan") {
    const postId = requiredString(args.id, "Post ID", 80);
    const reference = userCollection(uid, "posts").doc(postId);
    if (!(await reference.get()).exists) throw new Error("Post plan not found.");
    await reference.delete();
    return { id: postId, deleted: true };
  }
  throw new Error("Unknown tool.");
}
