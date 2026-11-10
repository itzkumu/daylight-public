const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const requests = [];
const fakeUser = { uid: "owner", getIdToken: async () => "firebase-token" };
const source = fs.readFileSync("lib/project-attachments.ts", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleObject = { exports: {} };
const context = {
  module: moduleObject, exports: moduleObject.exports, File, Blob, Headers, Response, URLSearchParams,
  crypto: { randomUUID: () => "test-boundary" },
  require: name => name === "./firebase-data" ? { getFirebase: () => ({ auth: { currentUser: fakeUser } }) } : require(name),
  fetch: async (url, init = {}) => {
    requests.push({ url, init });
    if (url === "/api/drive/session") return new Response(JSON.stringify({ token: "drive-token" }));
    if (url.includes("/drive/v3/files?") && (!init.method || init.method === "GET")) return new Response(JSON.stringify({ files: [] }));
    if (url.endsWith("/drive/v3/files?fields=id")) return new Response(JSON.stringify({ id: "project-folder" }));
    if (url.includes("uploadType=multipart")) {
      const body = await init.body.text();
      assert.match(body, /Daylight project notes/);
      assert.match(body, /project-folder/);
      return new Response(JSON.stringify({ id: "drive-file", webViewLink: "https://drive.google.com/file/d/drive-file/view" }));
    }
    throw new Error(`Unexpected request: ${url}`);
  },
};
vm.runInNewContext(compiled, context);
const { uploadProjectAttachment } = moduleObject.exports;

(async () => {
  const file = new File(["Project notes"], "Daylight project notes.txt", { type: "text/plain" });
  const result = await uploadProjectAttachment("owner", file);
  assert.equal(result.driveFileId, "drive-file");
  assert.equal(requests.length, 4);
  assert.equal(requests[0].init.headers.Authorization, "Bearer firebase-token");
  assert.equal(requests[3].init.headers.get("Authorization"), "Bearer drive-token");
  await assert.rejects(uploadProjectAttachment("owner", new File([new Uint8Array(10 * 1024 * 1024 + 1)], "huge.bin")), /smaller than 10 MB/);
  process.stdout.write("Project attachment passed: Drive folder, upload, and size limit.\n");
})().catch(issue => { console.error(issue); process.exitCode = 1; });
