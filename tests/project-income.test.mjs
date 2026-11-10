import assert from "node:assert/strict";
import test from "node:test";
import { projectCurrencyTotals, projectIncomeEntries, projectPayments, reconcileProjectPayments } from "../lib/project-income.ts";

const project = { id: "p1", title: "Client site", currency: "LKR", budgetAmount: 100000, paidAmount: 40000, createdAt: "2026-09-02T10:00:00.000Z", updatedAt: "2026-09-02T10:00:00.000Z" };

test("existing paid projects become one dated income entry", () => {
  const [entry] = projectIncomeEntries([project]);
  assert.equal(entry.amount, 4000000);
  assert.equal(entry.date, "2026-09-02");
  assert.equal(entry.projectId, "p1");
});

test("new payments count in their own months and Done adds only the unpaid balance", () => {
  const first = { ...project, paymentEvents: reconcileProjectPayments(null, 4000000, "2026-09-02") };
  const second = { ...first, paidAmount: 70000, paymentEvents: reconcileProjectPayments(first, 7000000, "2026-10-05") };
  const done = { ...second, paidAmount: 100000, status: "done", paymentEvents: reconcileProjectPayments(second, 10000000, "2026-11-01") };
  const entries = projectIncomeEntries([done]);
  assert.deepEqual(entries.map(entry => [entry.date, entry.amount]), [["2026-09-02", 4000000], ["2026-10-05", 3000000], ["2026-11-01", 3000000]]);
  assert.equal(entries.reduce((sum, entry) => sum + entry.amount, 0), 10000000);
});

test("reducing a paid total removes newest payments first", () => {
  const prior = { ...project, paidAmount: 70000, paymentEvents: [{ id: "old", date: "2026-09-02", amountLkr: 4000000 }, { id: "new", date: "2026-10-05", amountLkr: 3000000 }] };
  assert.deepEqual(reconcileProjectPayments(prior, 2000000, "2026-10-06"), [{ id: "old", date: "2026-09-02", amountLkr: 2000000 }]);
});

test("foreign projects use the entered LKR received total", () => {
  const foreign = { ...project, currency: "USD", paidAmountLkr: 125000 };
  assert.equal(projectPayments(foreign)[0].amountLkr, 12500000);
});

test("project budgets and payments stay separate by currency", () => {
  const totals = projectCurrencyTotals([
    project,
    { ...project, id: "p2", currency: "USD", budgetAmount: 60, paidAmount: 50, paidAmountLkr: 15000 },
    { ...project, id: "p3", currency: "EUR", budgetAmount: 80, paidAmount: 20 },
  ]);
  assert.deepEqual(totals, [
    { currency: "LKR", budget: 10000000, paid: 4000000, due: 6000000, count: 1 },
    { currency: "EUR", budget: 8000, paid: 2000, due: 6000, count: 1 },
    { currency: "USD", budget: 6000, paid: 5000, due: 1000, count: 1 },
  ]);
  assert.equal(projectIncomeEntries([project, { ...project, id: "p2", currency: "USD", budgetAmount: 60, paidAmount: 50, paidAmountLkr: 15000 }]).reduce((sum, entry) => sum + entry.amount, 0), 5500000);
});
