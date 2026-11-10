const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync("lib/priority-order.ts", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleObject = { exports: {} };
vm.runInNewContext(compiled, { module: moduleObject, exports: moduleObject.exports });
const { orderedTasks, orderedProjects, moveBeforeOrAfter, moveOne } = moduleObject.exports;
const ids = items => Array.from(items, item => item.id);

assert.deepEqual(ids(orderedTasks([
  { id: "later", dueAt: "2026-11-12", createdAt: "2026-10-01" },
  { id: "urgent", dueAt: "2026-10-25", createdAt: "2026-10-02" },
])), ["urgent", "later"]);
assert.deepEqual(ids(orderedTasks([
  { id: "later", sortRank: 0, dueAt: "2026-11-12", createdAt: "2026-10-01" },
  { id: "urgent", sortRank: 1, dueAt: "2026-10-25", createdAt: "2026-10-02" },
])), ["later", "urgent"]);
assert.deepEqual(ids(orderedProjects([
  { id: "newer", updatedAt: "2026-10-20", sortRank: 1 },
  { id: "chosen", updatedAt: "2026-10-01", sortRank: 0 },
])), ["chosen", "newer"]);
assert.deepEqual(Array.from(moveBeforeOrAfter(["a", "b", "c"], "c", "a")), ["c", "a", "b"]);
assert.deepEqual(Array.from(moveBeforeOrAfter(["a", "b", "c"], "a", "c")), ["b", "c", "a"]);
assert.deepEqual(Array.from(moveOne(["a", "b", "c"], "b", -1)), ["b", "a", "c"]);
assert.deepEqual(Array.from(moveOne(["a", "b", "c"], "b", 1)), ["a", "c", "b"]);
process.stdout.write("Priority order passed: legacy dates, saved ranks, drag, and keyboard moves.\n");
