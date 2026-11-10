const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const docs = new Map();
const firestore = {
  doc: (_db, ...parts) => parts.join("/"),
  setDoc: async (key, value) => { docs.set(key, structuredClone(value)); },
  getDoc: async key => ({ exists: () => docs.has(key), data: () => docs.get(key) }),
  deleteDoc: async key => { docs.delete(key); },
  updateDoc: async (key, value) => { docs.set(key, { ...docs.get(key), ...value }); },
  writeBatch: () => {
    const updates = [];
    return { update: (key, value) => updates.push([key, value]), commit: async () => updates.forEach(([key, value]) => docs.set(key, { ...docs.get(key), ...value })) };
  },
  getFirestore: () => ({}),
};
const source = fs.readFileSync("lib/firebase-data.ts", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleObject = { exports: {} };
const context = {
  module: moduleObject, exports: moduleObject.exports, crypto: { randomUUID: () => "project-1" },
  process: { env: { NEXT_PUBLIC_FIREBASE_API_KEY: "test", NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "test", NEXT_PUBLIC_FIREBASE_PROJECT_ID: "test", NEXT_PUBLIC_FIREBASE_APP_ID: "test" } },
  require: name => name === "firebase/firestore" ? firestore : name === "firebase/app" ? { getApps: () => [], initializeApp: () => ({}) } : name === "firebase/auth" ? { getAuth: () => ({ currentUser: { uid: "owner" } }) } : require(name),
};
vm.runInNewContext(compiled, context);
const { changeData, setItemPriority, reorderItems } = moduleObject.exports;

(async () => {
  const key = "users/owner/projects/project-1";
  const invoice = { name: "invoice.pdf", url: "https://drive.google.com/file/d/invoice/view", driveFileId: "invoice" };
  const created = await changeData("owner", "POST", { collection: "projects", title: "Studio launch", status: "upcoming", goal: "Publish the site", startDate: "2026-11-01", targetDate: "2026-12-01", clientName: "Acme", contactName: "Alex", contactEmail: "alex@example.com", currency: "LKR", budgetAmount: 120000, paidAmount: 40000, referenceLinks: ["https://example.com/brief", "https://example.com/design"], milestones: [{ id: "review", title: "Design review", dueDate: "2026-11-15", done: false }], invoice });
  assert.equal(created.row.title, "Studio launch");
  assert.equal(docs.get(key).status, "upcoming");
  assert.equal(docs.get(key).budgetAmount - docs.get(key).paidAmount, 80000);
  assert.equal(docs.get(key).clientName, "Acme");
  assert.equal(docs.get(key).invoice.driveFileId, "invoice");
  assert.equal(docs.get(key).referenceLinks.length, 2);
  assert.equal(docs.get(key).milestones[0].title, "Design review");
  assert.equal(docs.get(key).priority, "normal");
  await setItemPriority("owner", "projects", "project-1", "high");
  assert.equal(docs.get(key).priority, "high");
  await reorderItems("owner", "projects", ["project-1"]);
  assert.equal(docs.get(key).sortRank, 0);
  await assert.rejects(setItemPriority("stranger", "projects", "project-1", "low"), /Sign in/);
  const originalCreatedAt = docs.get(key).createdAt;
  await changeData("owner", "PATCH", { collection: "projects", id: "project-1", ...docs.get(key), status: "ongoing", nextStep: "Review the home page" });
  assert.equal(docs.get(key).status, "ongoing");
  assert.equal(docs.get(key).createdAt, originalCreatedAt);
  assert.equal(docs.get(key).nextStep, "Review the home page");
  assert.equal(docs.get(key).invoice.driveFileId, "invoice");
  await assert.rejects(changeData("owner", "POST", { collection: "projects", title: "", status: "upcoming" }), /name/);
  await assert.rejects(changeData("owner", "POST", { collection: "projects", title: "Bad link", status: "upcoming", link: "javascript:alert(1)" }), /http or https/);
  await assert.rejects(changeData("owner", "POST", { collection: "projects", title: "Bad dates", status: "upcoming", startDate: "2026-12-01", targetDate: "2026-11-01" }), /deadline/);
  await assert.rejects(changeData("owner", "POST", { collection: "projects", title: "Bad amount", status: "upcoming", budgetAmount: -1 }), /budget/);
  await assert.rejects(changeData("owner", "POST", { collection: "projects", title: "Bad invoice", status: "upcoming", invoice: { name: "x", url: "https://elsewhere.com/x", driveFileId: "x" } }), /invoice/);
  await changeData("owner", "DELETE", { collection: "projects", id: "project-1" });
  assert.equal(docs.has(key), false);
  process.stdout.write("Project data passed: create, edit, validation, and remove.\n");
})().catch(issue => { console.error(issue); process.exitCode = 1; });
