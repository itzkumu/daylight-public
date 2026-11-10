const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.resolve("lib/agent-bill-upload.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const docs = new Map();
const ref = key => ({
  key,
  doc(id) { return ref(`${key}/${id}`); },
  collection(name) { return ref(`${key}/${name}`); },
  async get() { return { exists: docs.has(key), data: () => docs.get(key), get: field => docs.get(key)?.[field] }; },
  async create(value) { assert.equal(docs.has(key), false); docs.set(key, value); },
  async update(value) { assert.equal(docs.has(key), true); docs.set(key, { ...docs.get(key), ...value }); },
});
const db = {
  collection(name) { return ref(name); },
  async runTransaction(fn) {
    return fn({
      get: target => target.get(),
      create: (target, value) => { assert.equal(docs.has(target.key), false); docs.set(target.key, value); },
      update: (target, value) => docs.set(target.key, { ...docs.get(target.key), ...value }),
    });
  },
};
let uploaded = false;
let largeOffset = 0;
let scans = 0;
const session = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=example";
const mocks = {
  "server-only": {},
  "./drive-server": {
    billFolder: async () => "daylight-folder",
    driveAccessToken: async () => "drive-token",
    driveRequest: async (_uid, url, init) => {
      assert.match(url, /uploadType=resumable/);
      assert.equal(JSON.parse(init.body).parents[0], "daylight-folder");
      return { headers: new Headers({ location: session }) };
    },
  },
  "./agent-bill-scan": {
    scanAgentBill: async (_uid, id, mimeType) => {
      assert.equal(id, "drive-file-12345");
      assert.equal(mimeType, "image/jpeg");
      scans++;
      return { merchant: "Market", date: "2026-10-19", total: 1250.5, currency: "LKR", category: "Food & drink", items: [], amountLkr: 1250.5, ocrText: "Market\nTOTAL 1250.50", reviewRequired: [] };
    },
  },
  "./social-server": { serverDb: () => db, seal: JSON.stringify, unseal: JSON.parse },
};
const moduleObject = { exports: {} };
const load = vm.runInNewContext(`(function(require,module,exports,fetch){${compiled}\n})`, { URL, Date, Number, String, JSON, Set, Error, RegExp, Buffer, console });
load(name => mocks[name] || require(name), moduleObject, moduleObject.exports, async (url, init) => {
  assert.equal(url, session);
  assert.equal(init.method, "PUT");
  assert.equal(init.headers.Authorization, "Bearer drive-token");
  if (init.headers["Content-Range"] === "bytes */5242880") return { ok: false, status: 308, headers: new Headers(largeOffset ? { range: `bytes=0-${largeOffset - 1}` } : {}) };
  if (init.headers["Content-Range"] === "bytes 0-4194303/5242880") {
    assert.equal(init.headers["Content-Length"], "4194304");
    largeOffset = 4194304;
    return { ok: false, status: 308, headers: new Headers({ range: "bytes=0-4194303" }) };
  }
  if (init.headers["Content-Range"] === "bytes 4194304-5242879/5242880") {
    assert.equal(init.headers["Content-Length"], "1048576");
    largeOffset = 5242880;
    return { ok: true, status: 200, json: async () => ({ id: "drive-file-large" }) };
  }
  if (init.headers["Content-Range"] === "bytes */165423") return uploaded
    ? { ok: true, status: 200, json: async () => ({ id: "drive-file-12345", webViewLink: "https://drive.google.com/open?id=drive-file-12345" }) }
    : { ok: false, status: 308, headers: new Headers() };
  assert.equal(init.headers["Content-Range"], "bytes 0-165422/165423");
  assert.equal(init.headers["Content-Length"], "165423");
  assert.equal(init.headers["Content-Type"], "image/jpeg");
  assert.equal(init.body.length, 165423);
  uploaded = true;
  return { ok: true, status: 200, json: async () => ({ id: "drive-file-12345", webViewLink: "https://drive.google.com/open?id=drive-file-12345" }) };
});

(async () => {
  const api = moduleObject.exports;
  const started = await api.beginAgentBillUpload("owner", { fileName: "receipt.jpg", mimeType: "image/jpeg", sizeBytes: 165423 }, "https://daylight.example.test");
  assert.match(started.uploadUrl, /^https:\/\/daylight\.example\.test\/api\/mcp\/bill-upload\//);
  assert.equal(started.uploadUrl.includes("www.googleapis.com"), false);
  assert.equal(started.contentRange, "bytes 0-165422/165423");
  const waiting = await api.scanAgentBillUpload("owner", { uploadId: started.uploadId });
  assert.equal(waiting.complete, false);
  assert.equal(waiting.nextOffset, 0);
  assert.equal("uploadUrl" in waiting, false);
  const token = new URL(started.uploadUrl).searchParams.get("token");
  const bytes = new Uint8Array(165423);
  await assert.rejects(api.uploadAgentBillBytes("owner", started.uploadId, "wrong", bytes, started.contentRange), /Invalid upload link/);
  await assert.rejects(api.uploadAgentBillBytes("owner", started.uploadId, token, bytes, "bytes 0-999/165423"), /exact bytes sent/);
  await assert.rejects(api.uploadAgentBillBytes("owner", started.uploadId, token, new Uint8Array(1), "bytes 0-0/165423"), /multiples of 256 KiB/);
  const transferred = await api.uploadAgentBillBytes("owner", started.uploadId, token, bytes, started.contentRange);
  assert.equal(transferred.uploaded, true);
  const repeatedTransfer = await api.uploadAgentBillBytes("owner", started.uploadId, token, bytes, started.contentRange);
  assert.equal(repeatedTransfer.uploaded, true);
  const scanned = await api.scanAgentBillUpload("owner", { uploadId: started.uploadId });
  assert.equal(scanned.saved, false);
  assert.equal(scanned.scan.merchant, "Market");
  assert.equal(docs.has(`users/owner/bills/${started.uploadId}`), false);
  const repeatedScan = await api.scanAgentBillUpload("owner", { uploadId: started.uploadId });
  assert.equal(repeatedScan.scan.total, 1250.5);
  assert.equal(scans, 1);
  const uploadKey = `users/owner/agentBillUploads/${started.uploadId}`;
  docs.set(uploadKey, { ...docs.get(uploadKey), scanVersion: 1, scan: { merchant: "Unreadable", date: "", total: 0 } });
  const rescanned = await api.scanAgentBillUpload("owner", { uploadId: started.uploadId });
  assert.equal(rescanned.scan.merchant, "Market");
  assert.equal(scans, 2);
  assert.equal(docs.get(uploadKey).scanVersion, 3);
  await assert.rejects(api.completeAgentBillUpload("owner", { uploadId: started.uploadId }), /review its draft/);
  const done = await api.completeAgentBillUpload("owner", { uploadId: started.uploadId, merchant: "Market", date: "2026-10-19", amountLkr: 1250.5, originalAmount: 1250.5, currency: "LKR", category: "Food & drink" });
  assert.equal(done.complete, true);
  assert.equal(done.bill.amount, 1250.5);
  assert.equal(docs.get(`users/owner/transactions/bill-${started.uploadId}`).amount, 125050);
  const retry = await api.completeAgentBillUpload("owner", { uploadId: started.uploadId });
  assert.equal(retry.bill.amount, 1250.5);
  docs.delete(`users/owner/bills/${started.uploadId}`);
  const removed = await api.completeAgentBillUpload("owner", { uploadId: started.uploadId });
  assert.equal(removed.billRemoved, true);
  assert.equal(docs.has(`users/owner/bills/${started.uploadId}`), false);
  const large = await api.beginAgentBillUpload("owner", { fileName: "large.pdf", mimeType: "application/pdf", sizeBytes: 5242880 }, "https://daylight.example.test");
  const largeToken = new URL(large.uploadUrl).searchParams.get("token");
  const firstChunk = await api.uploadAgentBillBytes("owner", large.uploadId, largeToken, new Uint8Array(4194304), "bytes 0-4194303/5242880");
  assert.equal(firstChunk.uploaded, false);
  assert.equal(firstChunk.nextOffset, 4194304);
  await assert.rejects(api.uploadAgentBillBytes("owner", large.uploadId, largeToken, new Uint8Array(1), "bytes 0-0/5242880"), /Resume from that byte/);
  const finalChunk = await api.uploadAgentBillBytes("owner", large.uploadId, largeToken, new Uint8Array(1048576), "bytes 4194304-5242879/5242880");
  assert.equal(finalChunk.uploaded, true);
  assert.equal(docs.get(`users/owner/agentBillUploads/${large.uploadId}`).driveFile.id, "drive-file-large");
  process.stdout.write("Bill flow passed: private Daylight upload, Drive transfer, OCR draft, review gate, linked expense, cached scan, safe retry.\n");
})().catch(error => { console.error(error); process.exitCode = 1; });
