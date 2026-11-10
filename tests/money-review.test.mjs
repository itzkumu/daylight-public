import assert from "node:assert/strict";
import test from "node:test";
import { moneyGroup, reviewMoneyMonth } from "../lib/money-review.ts";

test("a project bill is one expense in monthly and project totals", () => {
  const bill = { id: "bill-1", merchant: "Print shop", amount: 125050, date: "2026-10-10", category: "Shopping" };
  const transactions = [
    { id: "expense-1", kind: "expense", amount: 125050, category: "Shopping", description: "Print shop", date: "2026-10-10", billId: "bill-1", projectId: "byrsa" },
    { id: "payment-1", kind: "income", amount: 500000, category: "Projects", description: "Byrsa", date: "2026-10-11", projectId: "byrsa" },
    { id: "other-1", kind: "expense", amount: 20000, category: "Transport", description: "Taxi", date: "2026-10-12" },
  ];
  const review = reviewMoneyMonth(transactions, [bill], [{ id: "byrsa" }], "2026-10");
  assert.equal(review.income, 500000);
  assert.equal(review.expenses, 145050);
  assert.equal(review.projectExpenses, 125050);
  assert.equal(review.billExpenses, 125050);
  assert.equal(review.balance, 354950);
  assert.equal(moneyGroup(transactions[0]), "expense");
  assert.equal(moneyGroup(transactions[1]), "projects");
  assert.deepEqual(review.issues, []);
});

test("review flags mismatched bill details and a possible separate duplicate", () => {
  const bill = { id: "bill-1", merchant: "Cafe", amount: 100000, date: "2026-10-10", category: "Food & drink" };
  const transactions = [
    { id: "linked", kind: "expense", amount: 90000, category: "Food & drink", description: "Cafe", date: "2026-10-10", billId: "bill-1" },
    { id: "manual", kind: "expense", amount: 100000, category: "Food & drink", description: "Cafe", date: "2026-10-10" },
  ];
  const review = reviewMoneyMonth(transactions, [bill], [], "2026-10");
  assert.equal(review.issues.length, 2);
  assert.ok(review.issues.some(issue => issue.id === "bill-mismatch-linked"));
  assert.ok(review.issues.some(issue => issue.id === "possible-duplicate-bill-1-manual"));
});
