import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { collection, deleteDoc, deleteField, doc, getDoc, getFirestore, onSnapshot, query, runTransaction, setDoc, updateDoc, where, writeBatch, getDocs } from "firebase/firestore";
import { projectIncomeEntries, reconcileProjectPayments } from "./project-income";

export type Priority = "high" | "normal" | "low";
export type Task = { id: string; title: string; dueAt: string | null; notes: string; done: boolean; createdAt: string; priority?: Priority; sortRank?: number; calendarEventId?: string };
export type Transaction = { id: string; kind: string; amount: number; category: string; description: string; date: string; createdAt: string; billId?: string; projectId?: string };
export type Post = { id: string; platform: string; title: string; caption?: string; scheduledAt: string | null; status: string; createdAt: string };
export type Bill = { id: string; merchant: string; date: string; amount: number; originalAmount: number; currency: string; category: string; items: string[]; fileName: string; driveFileId: string; driveUrl: string; transactionId: string; createdAt: string };
export type ProjectStatus = "upcoming" | "ongoing" | "done";
export type ProjectFile = { name: string; url: string; driveFileId: string };
export type ProjectMilestone = { id: string; title: string; dueDate: string; done: boolean };
export type ProjectPayment = { id: string; date: string; amountLkr: number };
export type Project = { id: string; title: string; status: ProjectStatus; area: string; summary: string; goal: string; nextStep: string; startDate: string; targetDate: string; notes: string; link: string; referenceLinks?: string[]; clientName?: string; contactName?: string; contactEmail?: string; contactPhone?: string; currency?: string; budgetAmount?: number | null; paidAmount?: number; paidAmountLkr?: number; paymentEvents?: ProjectPayment[]; milestones?: ProjectMilestone[]; attachment?: ProjectFile | null; invoice?: ProjectFile | null; priority?: Priority; sortRank?: number; createdAt: string; updatedAt: string };
export type Data = { tasks: Task[]; transactions: Transaction[]; posts: Post[]; bills: Bill[]; projects: Project[] };

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function hasFirebaseConfig() {
  return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
}

export function getFirebase() {
  if (!hasFirebaseConfig()) return null;
  const app = getApps().length ? getApp() : initializeApp(config);
  return { app, auth: getAuth(app), db: getFirestore(app) };
}

export async function signIn() {
  const firebase = getFirebase();
  if (!firebase) throw new Error("Firebase has not been configured yet.");
  return signInWithPopup(firebase.auth, new GoogleAuthProvider());
}

export async function signOutUser() {
  const firebase = getFirebase();
  if (firebase) await signOut(firebase.auth);
}

export function subscribeData(userId: string, onData: (data: Data) => void, onError: (error: Error) => void) {
  const firebase = getFirebase();
  if (!firebase) throw new Error("Firebase has not been configured yet.");
  const data: Data = { tasks: [], transactions: [], posts: [], bills: [], projects: [] };
  const ready = new Set<string>();
  const repairing = new Set<string>();
  const collections = ["tasks", "transactions", "posts", "bills", "projects"] as const;
  const emitIfReady = () => {
    if (ready.size !== collections.length) return;
    const billsById = new Map(data.bills.map(bill => [bill.id, bill]));
    const transactions = data.transactions.filter(entry => !entry.billId || billsById.has(entry.billId));
    for (const bill of data.bills) {
      const transactionId = bill.transactionId || `bill-${bill.id}`;
      if (transactions.some(entry => entry.id === transactionId || entry.billId === bill.id)) continue;
      const entry: Transaction = { id: transactionId, kind: "expense", amount: bill.amount, category: bill.category, description: bill.merchant, date: bill.date, createdAt: bill.createdAt, billId: bill.id };
      transactions.push(entry);
      if (!repairing.has(bill.id)) {
        repairing.add(bill.id);
        const billRef = doc(firebase.db, "users", userId, "bills", bill.id);
        const transactionRef = doc(firebase.db, "users", userId, "transactions", transactionId);
        void runTransaction(firebase.db, async transaction => {
          const [currentBill, currentEntry] = await Promise.all([transaction.get(billRef), transaction.get(transactionRef)]);
          if (currentBill.exists() && !currentEntry.exists()) {
            transaction.set(transactionRef, entry);
            if (!currentBill.data().transactionId) transaction.update(billRef, { transactionId });
          }
        }).catch(issue => onError(issue instanceof Error ? issue : new Error("Could not restore this bill's expense."))).finally(() => repairing.delete(bill.id));
      }
    }
    for (const entry of data.transactions) {
      if (!entry.billId || billsById.has(entry.billId) || repairing.has(entry.billId)) continue;
      repairing.add(entry.billId);
      const billRef = doc(firebase.db, "users", userId, "bills", entry.billId);
      const transactionRef = doc(firebase.db, "users", userId, "transactions", entry.id);
      void runTransaction(firebase.db, async transaction => {
        const [currentBill, currentEntry] = await Promise.all([transaction.get(billRef), transaction.get(transactionRef)]);
        if (!currentBill.exists() && currentEntry.exists() && currentEntry.data().billId === entry.billId) transaction.delete(transactionRef);
      }).catch(issue => onError(issue instanceof Error ? issue : new Error("Could not remove an old bill expense."))).finally(() => repairing.delete(entry.billId!));
    }
    transactions.push(...projectIncomeEntries(data.projects));
    transactions.sort((a, b) => b.date.localeCompare(a.date));
    onData({ tasks: [...data.tasks], transactions, posts: [...data.posts], bills: [...data.bills], projects: [...data.projects] });
  };
  const unsubscribers = collections.map(name => onSnapshot(
    collection(firebase.db, "users", userId, name),
    snapshot => {
      if (name === "tasks") data.tasks = snapshot.docs.map(item => item.data() as Task).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (name === "transactions") data.transactions = snapshot.docs.map(item => item.data() as Transaction).sort((a, b) => b.date.localeCompare(a.date));
      if (name === "posts") data.posts = snapshot.docs.map(item => item.data() as Post).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (name === "bills") data.bills = snapshot.docs.map(item => item.data() as Bill).sort((a, b) => b.date.localeCompare(a.date));
      if (name === "projects") data.projects = snapshot.docs.map(item => item.data() as Project).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      ready.add(name);
      emitIfReady();
    },
    issue => {
      if (name === "bills" || name === "projects") { ready.add(name); emitIfReady(); onError(new Error(`${name === "bills" ? "Bills" : "Projects"} are unavailable. Publish the updated Firestore rules, then try again.`)); }
      else onError(issue);
    },
  ));
  return () => unsubscribers.forEach(unsubscribe => unsubscribe());
}

function projectFields(body: Record<string, unknown>) {
  const title = String(body.title ?? "").trim().slice(0, 180);
  if (!title) throw new Error("Give your project a name.");
  const status = body.status as ProjectStatus;
  if (status !== "upcoming" && status !== "ongoing" && status !== "done") throw new Error("Choose a project stage.");
  const date = (value: unknown) => {
    const text = String(value ?? "").trim();
    const parsed = text ? new Date(`${text}T12:00:00`) : null;
    if (text && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text)) throw new Error("Choose a valid project date.");
    return text;
  };
  const startDate = date(body.startDate);
  const targetDate = date(body.targetDate);
  if (startDate && targetDate && targetDate < startDate) throw new Error("The project deadline must be on or after the start date.");
  const rawLinks = Array.isArray(body.referenceLinks) ? body.referenceLinks : [body.link];
  const referenceLinks = rawLinks.map(value => String(value ?? "").trim()).filter(Boolean);
  if (referenceLinks.length > 10 || referenceLinks.some(link => link.length > 1000 || !/^https?:\/\//i.test(link))) throw new Error("Add up to 10 full http or https reference links.");
  const file = (value: unknown, label: string): ProjectFile | null => {
    if (!value) return null;
    if (typeof value !== "object") throw new Error(`The ${label} is invalid.`);
    const raw = value as Record<string, unknown>;
    const result = { name: String(raw.name ?? "").slice(0, 240), url: String(raw.url ?? ""), driveFileId: String(raw.driveFileId ?? "") };
    if (!result.name || !/^https:\/\/drive\.google\.com\//.test(result.url) || !result.driveFileId) throw new Error(`The ${label} is invalid.`);
    return result;
  };
  const amount = (value: unknown, label: string, optional = false) => {
    if (optional && (value === null || value === undefined || value === "")) return null;
    const number = Number(value ?? 0);
    if (!Number.isFinite(number) || number < 0 || number > 1_000_000_000 || Math.abs(number * 100 - Math.round(number * 100)) > 0.000001) throw new Error(`Enter a valid ${label} with no more than two decimal places.`);
    return Math.round(number * 100) / 100;
  };
  const budgetAmount = amount(body.budgetAmount, "project budget", true);
  let paidAmount = amount(body.paidAmount, "amount paid") ?? 0;
  const currency = String(body.currency || "LKR").toUpperCase();
  if (!["LKR", "USD", "EUR", "GBP", "AUD", "CAD", "INR"].includes(currency)) throw new Error("Choose a project currency.");
  if (status === "done" && budgetAmount != null) paidAmount = Math.max(paidAmount, budgetAmount);
  const paidAmountLkr = currency === "LKR" ? paidAmount : amount(body.paidAmountLkr, "amount received in LKR") ?? 0;
  if (currency !== "LKR" && paidAmount > 0 && paidAmountLkr <= 0) throw new Error("Enter the LKR value of the amount paid so far, not the full project price.");
  const contactEmail = String(body.contactEmail ?? "").trim().slice(0, 254);
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new Error("Enter a valid client email address.");
  const rawMilestones = body.milestones ?? [];
  if (!Array.isArray(rawMilestones) || rawMilestones.length > 20) throw new Error("Add up to 20 milestones.");
  const milestones = rawMilestones.map((value, index) => {
    if (!value || typeof value !== "object") throw new Error("Check the project milestones.");
    const item = value as Record<string, unknown>;
    const milestoneTitle = String(item.title ?? "").trim().slice(0, 180);
    if (!milestoneTitle) throw new Error("Give each milestone a title.");
    return { id: String(item.id || `milestone-${index}`).slice(0, 80), title: milestoneTitle, dueDate: date(item.dueDate), done: item.done === true };
  });
  return {
    title, status, area: String(body.area ?? "").trim().slice(0, 80),
    summary: String(body.summary ?? "").trim().slice(0, 500),
    goal: String(body.goal ?? "").trim().slice(0, 500),
    nextStep: String(body.nextStep ?? "").trim().slice(0, 300),
    startDate, targetDate,
    notes: String(body.notes ?? "").trim().slice(0, 4000),
    link: referenceLinks[0] || "", referenceLinks,
    clientName: String(body.clientName ?? "").trim().slice(0, 180),
    contactName: String(body.contactName ?? "").trim().slice(0, 180),
    contactEmail, contactPhone: String(body.contactPhone ?? "").trim().slice(0, 80),
    currency, budgetAmount, paidAmount, paidAmountLkr, milestones,
    priority: validPriority(body.priority),
    attachment: file(body.attachment, "project attachment"),
    invoice: file(body.invoice, "invoice"),
  };
}

function validPriority(value: unknown): Priority {
  if (value === undefined || value === null || value === "") return "normal";
  if (value !== "high" && value !== "normal" && value !== "low") throw new Error("Choose a valid priority.");
  return value;
}

export async function changeData(userId: string, method: string, body: Record<string, unknown>): Promise<{ row?: Task | Transaction | Post | Project }> {
  const firebase = getFirebase();
  if (!firebase) throw new Error("Firebase has not been configured yet.");
  const id = typeof body.id === "string" ? body.id : crypto.randomUUID();
  const now = new Date().toISOString();
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const paymentDate = typeof body.paymentDate === "string" && body.paymentDate ? body.paymentDate : today;
  if (body.collection === "projects" && (method === "POST" || method === "PATCH") && (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) || Number.isNaN(Date.parse(`${paymentDate}T12:00:00Z`)) || new Date(`${paymentDate}T12:00:00Z`).toISOString().slice(0, 10) !== paymentDate)) throw new Error("Choose a valid payment date.");
  let row: Task | Transaction | Post | Project | undefined;
  const ref = (name: "tasks" | "transactions" | "posts" | "projects") => doc(firebase.db, "users", userId, name, id);
  const transactionAmount = () => {
    const value = Number(body.amount);
    const cents = Math.round(value * 100);
    if (!Number.isFinite(value) || !Number.isSafeInteger(cents) || cents <= 0 || cents > 100000000000 || Math.abs(value * 100 - cents) > 0.000001) throw new Error("Enter a positive LKR amount with no more than two decimal places.");
    return cents;
  };
  const transactionDate = () => {
    const date = String(body.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("Choose a valid expense date.");
    return date;
  };
  const projectForExpense = async (kind: string) => {
    const projectId = String(body.projectId ?? "").trim();
    if (!projectId) return "";
    if (kind !== "expense") throw new Error("Only expenses can be linked to a project here. Project income is tracked from payments in the project.");
    if (projectId.length > 180 || !(await getDoc(doc(firebase.db, "users", userId, "projects", projectId))).exists()) throw new Error("Choose an existing project for this expense.");
    return projectId;
  };

  if (method === "POST" && body.collection === "tasks") {
    const title = String(body.title ?? "").trim();
    if (!title || title.length > 180) throw new Error("Enter a task title under 180 characters.");
    row = { id, title, dueAt: typeof body.dueAt === "string" && body.dueAt ? body.dueAt : null, notes: String(body.notes ?? "").slice(0, 1000), done: false, priority: validPriority(body.priority), sortRank: -Date.now(), createdAt: now };
    await setDoc(ref("tasks"), row);
  } else if (method === "POST" && body.collection === "transactions") {
    const amount = transactionAmount();
    const date = transactionDate();
    const kind = body.kind === "income" ? "income" : "expense";
    const projectId = await projectForExpense(kind);
    row = { id, kind, amount, category: String(body.category ?? "Other").trim().slice(0, 60) || "Other", description: String(body.description ?? "").slice(0, 180), date, createdAt: now, ...(projectId ? { projectId } : {}) };
    await setDoc(ref("transactions"), row);
  } else if (method === "POST" && body.collection === "posts") {
    const title = String(body.title ?? "").trim();
    if (!title || title.length > 180) throw new Error("Enter a post idea.");
    const platform = String(body.platform ?? "Instagram");
    if (!["Instagram", "TikTok", "Facebook"].includes(platform)) throw new Error("Choose a platform.");
    const scheduledAt = typeof body.scheduledAt === "string" && body.scheduledAt ? body.scheduledAt : null;
    row = { id, platform, title, caption: String(body.caption ?? "").trim().slice(0, 2200), scheduledAt, status: scheduledAt ? "scheduled" : "idea", createdAt: now };
    await setDoc(ref("posts"), row);
  } else if (method === "POST" && body.collection === "projects") {
    const fields = projectFields(body);
    row = { id, ...fields, paymentEvents: reconcileProjectPayments(null, Math.round(fields.paidAmountLkr * 100), paymentDate), sortRank: -Date.now(), createdAt: now, updatedAt: now };
    await setDoc(ref("projects"), row);
  } else if (method === "PATCH" && body.collection === "tasks") {
    const changes: Record<string, unknown> = {};
    if ("done" in body) changes.done = body.done === true;
    if ("priority" in body) changes.priority = validPriority(body.priority);
    if (!Object.keys(changes).length) throw new Error("Nothing to update on this task.");
    await updateDoc(ref("tasks"), changes);
  } else if (method === "PATCH" && body.collection === "transactions") {
    const transactionRef = ref("transactions");
    const existing = await getDoc(transactionRef);
    if (!existing.exists()) throw new Error("This entry no longer exists. Refresh and try again.");
    const amount = transactionAmount();
    const date = transactionDate();
    const kind = body.kind === "income" ? "income" : "expense";
    const projectId = "projectId" in body ? await projectForExpense(kind) : (existing.data() as Transaction).projectId || "";
    if (kind !== "expense" && projectId) throw new Error("Project costs must stay expenses.");
    const category = String(body.category ?? "Other").trim().slice(0, 60) || "Other";
    const description = String(body.description ?? "").trim().slice(0, 180);
    const linkedBillId = (existing.data() as Transaction).billId;
    if (linkedBillId && kind !== "expense") throw new Error("A bill-linked entry must stay an expense.");
    const batch = writeBatch(firebase.db);
    batch.update(transactionRef, { kind, amount, category, description, date, projectId: projectId || deleteField() });
    if (linkedBillId) {
      batch.update(doc(firebase.db, "users", userId, "bills", linkedBillId), { amount, category, date, merchant: description || "Purchase" });
    }
    await batch.commit();
  } else if (method === "PATCH" && body.collection === "posts") {
    if (body.status === "published") await updateDoc(ref("posts"), { status: "published" });
    else {
      const title = String(body.title ?? "").trim();
      const platform = String(body.platform ?? "");
      if (!title || title.length > 180 || !["Instagram", "TikTok", "Facebook"].includes(platform)) throw new Error("Enter a title and platform.");
      const scheduledAt = typeof body.scheduledAt === "string" && body.scheduledAt ? body.scheduledAt : null;
      await updateDoc(ref("posts"), { title, caption: String(body.caption ?? "").trim().slice(0, 2200), platform, scheduledAt, status: scheduledAt ? "scheduled" : "idea" });
    }
  } else if (method === "PATCH" && body.collection === "projects") {
    const projectRef = ref("projects");
    await runTransaction(firebase.db, async transaction => {
      const existing = await transaction.get(projectRef);
      if (!existing.exists()) throw new Error("This project no longer exists. Refresh and try again.");
      const previous = existing.data() as Project;
      const fields = projectFields(body.stageOnly === true ? { ...previous, status: body.status } : body);
      if (body.stageOnly !== true && typeof body.expectedPaidAmountLkr === "number" && Math.round(body.expectedPaidAmountLkr * 100) !== Math.round((previous.paidAmountLkr ?? (previous.currency === "LKR" || !previous.currency ? previous.paidAmount || 0 : 0)) * 100)) throw new Error("This project's payments changed on another device. Reopen it before saving.");
      row = { ...previous, ...fields, paymentEvents: reconcileProjectPayments(previous, Math.round(fields.paidAmountLkr * 100), paymentDate), updatedAt: now };
      transaction.set(projectRef, row);
    });
  } else if (method === "DELETE" && body.collection === "transactions") {
    const transactionRef = ref("transactions");
    const saved = await getDoc(transactionRef);
    const billId = saved.exists() ? (saved.data() as Transaction).billId : typeof body.billId === "string" ? body.billId : undefined;
    if (billId) {
      const billRef = doc(firebase.db, "users", userId, "bills", billId);
      const matches = await getDocs(query(collection(firebase.db, "users", userId, "transactions"), where("billId", "==", billId)));
      const batch = writeBatch(firebase.db);
      batch.delete(billRef);
      matches.docs.forEach(match => batch.delete(match.ref));
      batch.delete(transactionRef);
      await batch.commit();
    } else await deleteDoc(transactionRef);
  } else if (method === "DELETE" && body.collection === "projects") {
    const linked = await getDocs(query(collection(firebase.db, "users", userId, "transactions"), where("projectId", "==", id)));
    for (let offset = 0; offset < linked.docs.length; offset += 400) {
      const batch = writeBatch(firebase.db);
      linked.docs.slice(offset, offset + 400).forEach(item => batch.update(item.ref, { projectId: deleteField() }));
      await batch.commit();
    }
    await deleteDoc(ref("projects"));
  } else if (method === "DELETE" && (body.collection === "tasks" || body.collection === "posts")) {
    await deleteDoc(ref(body.collection));
  } else {
    throw new Error("Unknown entry type.");
  }
  return { row };
}

export async function setItemPriority(userId: string, name: "tasks" | "projects", id: string, priority: Priority) {
  const firebase = getFirebase();
  if (!firebase || firebase.auth.currentUser?.uid !== userId) throw new Error("Sign in to update priority.");
  await updateDoc(doc(firebase.db, "users", userId, name, id), { priority: validPriority(priority) });
}

export async function reorderItems(userId: string, name: "tasks" | "projects", orderedIds: string[]) {
  const firebase = getFirebase();
  if (!firebase || firebase.auth.currentUser?.uid !== userId) throw new Error("Sign in to reorder items.");
  if (!orderedIds.length || orderedIds.length > 400 || new Set(orderedIds).size !== orderedIds.length || orderedIds.some(id => !id || id.length > 180)) throw new Error("Could not save that order. Refresh and try again.");
  const batch = writeBatch(firebase.db);
  orderedIds.forEach((id, sortRank) => batch.update(doc(firebase.db, "users", userId, name, id), { sortRank }));
  await batch.commit();
}
