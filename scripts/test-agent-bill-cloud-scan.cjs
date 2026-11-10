const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, mocks) {
  const source = fs.readFileSync(path.resolve(file), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleObject = { exports: {} };
  const factory = vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { Buffer, Date, Math, Number, String, RegExp, console, Response, URL });
  factory(name => mocks[name] || require(name), moduleObject, moduleObject.exports);
  return moduleObject.exports;
}

const billText = load("lib/bill-text.ts", {});
const requests = [];
let failExport = false;
const scan = load("lib/agent-bill-scan.ts", {
  "server-only": {},
  "./bill-text": billText,
  "./drive-server": { driveRequest: async (_uid, url, init = {}) => {
    requests.push({ url, method: init.method || "GET" });
    if (url.includes("?alt=media")) return new Response(Buffer.from("image bytes"), { headers: { "content-length": "11" } });
    if (url.includes("uploadType=multipart")) {
      assert.equal(init.method, "POST");
      assert.match(String(init.headers["Content-Type"]), /^multipart\/related; boundary=/);
      assert.match(Buffer.from(init.body).toString(), /application\/vnd\.google-apps\.document/);
      assert.match(Buffer.from(init.body).toString(), /image\/jpeg/);
      return new Response(JSON.stringify({ id: "temporary-doc-id" }));
    }
    if (url.includes("/export?")) {
      if (failExport) throw new Error("export failed");
      return new Response("HEMAX COMPUTERS\nDate 15/10/2026\nPEN DRIVE 3,500.00\nTotal 3,500.00");
    }
    if (url.endsWith("/temporary-doc-id") && init.method === "DELETE") return new Response(null, { status: 204 });
    throw new Error(`Unexpected Drive request: ${url}`);
  } },
});

(async () => {
  const result = await scan.scanAgentBill("owner", "drive-file-12345", "image/jpeg");
  assert.equal(result.merchant, "HEMAX COMPUTERS");
  assert.equal(result.date, "2026-10-15");
  assert.equal(result.total, 3500);
  assert.equal(result.category, "Shopping");
  assert.equal(result.confidence, null);
  assert.deepEqual(requests.map(item => item.method), ["GET", "POST", "GET", "DELETE"]);
  requests.length = 0;
  failExport = true;
  await assert.rejects(scan.scanAgentBill("owner", "drive-file-12345", "image/jpeg"), /export failed/);
  assert.equal(requests.at(-1).method, "DELETE");
  process.stdout.write("Cloud bill scan passed: Drive OCR conversion, parsed draft, and temporary document cleanup.\n");
})().catch(error => { console.error(error); process.exitCode = 1; });
