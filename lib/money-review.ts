import type { Bill, Project, Transaction } from "./firebase-data";

export type MoneyIssue = { id: string; title: string; detail: string; transactionId?: string };
export type MoneyGroup = "expense" | "income" | "projects";

export function moneyGroup(entry: Pick<Transaction, "kind" | "projectId">): MoneyGroup {
  return entry.kind === "expense" ? "expense" : entry.kind === "income" && entry.projectId ? "projects" : "income";
}

export function reviewMoneyMonth(transactions: Transaction[], bills: Bill[], projects: Project[], month: string) {
  const entries = transactions.filter(entry => entry.date.startsWith(month));
  const monthBills = bills.filter(bill => bill.date.startsWith(month));
  const income = entries.filter(entry => entry.kind === "income").reduce((sum, entry) => sum + entry.amount, 0);
  const expenses = entries.filter(entry => entry.kind === "expense").reduce((sum, entry) => sum + entry.amount, 0);
  const projectIncome = entries.filter(entry => entry.kind === "income" && entry.projectId).reduce((sum, entry) => sum + entry.amount, 0);
  const projectExpenses = entries.filter(entry => entry.kind === "expense" && entry.projectId).reduce((sum, entry) => sum + entry.amount, 0);
  const billExpenses = entries.filter(entry => entry.kind === "expense" && entry.billId).reduce((sum, entry) => sum + entry.amount, 0);
  const issues: MoneyIssue[] = [];
  const byBillId = new Map<string, Transaction[]>();
  for (const entry of transactions) if (entry.billId) byBillId.set(entry.billId, [...(byBillId.get(entry.billId) || []), entry]);
  for (const bill of monthBills) {
    const linked = byBillId.get(bill.id) || [];
    if (!linked.length) issues.push({ id: `bill-missing-${bill.id}`, title: `Bill missing an expense: ${bill.merchant}`, detail: "The bill is saved, but its linked Money entry has not appeared. Refresh; Daylight attempts to restore it automatically." });
    if (linked.length > 1) issues.push({ id: `bill-duplicate-${bill.id}`, title: `Bill counted more than once: ${bill.merchant}`, detail: `${linked.length} Money entries link to this bill. Review them before deleting anything.`, transactionId: linked[0].id });
    for (const entry of linked) {
      if (entry.kind !== "expense" || entry.amount !== bill.amount || entry.date !== bill.date || entry.category !== bill.category || entry.description !== bill.merchant) {
        issues.push({ id: `bill-mismatch-${entry.id}`, title: `Bill and expense differ: ${bill.merchant}`, detail: "The amount, date, category, or merchant is different between the bill and Money. Open the expense to review and save the correct values.", transactionId: entry.id });
      }
    }
  }
  const projectIds = new Set(projects.map(project => project.id));
  for (const project of projects) {
    if (!project.paymentEvents?.some(payment => payment.date.startsWith(month))) continue;
    const eventTotal = project.paymentEvents.reduce((sum, payment) => sum + payment.amountLkr, 0);
    const paidLkr = Math.round((project.currency === "LKR" || !project.currency ? project.paidAmount || 0 : project.paidAmountLkr || 0) * 100);
    if (eventTotal !== paidLkr) issues.push({ id: `project-payments-${project.id}`, title: `Project payments need review: ${project.title}`, detail: "The dated payment entries do not add up to the project's paid total. Open the project and check the paid amount." });
  }
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.amount) || entry.amount <= 0) issues.push({ id: `invalid-${entry.id}`, title: "Invalid money amount", detail: `${entry.description || entry.category} has an amount that needs review.`, transactionId: entry.id });
    if (entry.kind === "expense" && entry.projectId && !projectIds.has(entry.projectId)) issues.push({ id: `project-missing-${entry.id}`, title: "Project expense needs a project", detail: `${entry.description || entry.category} links to a removed project. Choose another project or leave it as an ordinary expense.`, transactionId: entry.id });
  }
  for (const bill of monthBills) {
    const candidates = entries.filter(entry => !entry.billId && entry.kind === "expense" && entry.date === bill.date && entry.amount === bill.amount && entry.description.trim().toLowerCase() === bill.merchant.trim().toLowerCase());
    for (const entry of candidates) issues.push({ id: `possible-duplicate-${bill.id}-${entry.id}`, title: `Possible extra expense: ${bill.merchant}`, detail: "A separate entry has the same merchant, date, and amount as this bill. Check whether both purchases happened.", transactionId: entry.id });
  }
  return { income, expenses, balance: income - expenses, projectIncome, projectExpenses, billExpenses, billCount: monthBills.length, entryCount: entries.length, issues };
}
