import type { Project, ProjectPayment, Transaction } from "./firebase-data";

export function projectPaidLkr(project: Project) {
  return project.currency === "LKR" || !project.currency
    ? Math.round((project.paidAmount || 0) * 100)
    : Math.round((project.paidAmountLkr || 0) * 100);
}

export function unconvertedProjectPayments(projects: Project[]): Project[] {
  return projects.filter(project => project.currency && project.currency !== "LKR" && (project.paidAmount || 0) > 0 && !project.paidAmountLkr);
}

export function projectCurrencyTotals(projects: Project[]) {
  const totals = new Map<string, { currency: string; budget: number; paid: number; due: number; count: number }>();
  for (const project of projects) {
    const currency = project.currency || "LKR";
    const total = totals.get(currency) || { currency, budget: 0, paid: 0, due: 0, count: 0 };
    const budget = Math.round((project.budgetAmount || 0) * 100);
    const paid = Math.round((project.paidAmount || 0) * 100);
    total.budget += budget;
    total.paid += paid;
    total.due += Math.max(0, budget - paid);
    total.count++;
    totals.set(currency, total);
  }
  return [...totals.values()].sort((a, b) => a.currency === "LKR" ? -1 : b.currency === "LKR" ? 1 : a.currency.localeCompare(b.currency));
}

export function projectPayments(project: Project): ProjectPayment[] {
  if (project.paymentEvents) return project.paymentEvents;
  const amountLkr = projectPaidLkr(project);
  return amountLkr > 0 ? [{ id: "opening", date: (project.createdAt || project.updatedAt).slice(0, 10), amountLkr }] : [];
}

export function reconcileProjectPayments(project: Project | null, targetLkr: number, date: string): ProjectPayment[] {
  const payments = project ? projectPayments(project).map(payment => ({ ...payment })) : [];
  let difference = targetLkr - payments.reduce((sum, payment) => sum + payment.amountLkr, 0);
  if (difference > 0) payments.push({ id: crypto.randomUUID(), date, amountLkr: difference });
  if (difference < 0) {
    for (let index = payments.length - 1; index >= 0 && difference < 0; index--) {
      const removed = Math.min(payments[index].amountLkr, -difference);
      payments[index].amountLkr -= removed;
      difference += removed;
    }
  }
  return payments.filter(payment => payment.amountLkr > 0);
}

export function projectIncomeEntries(projects: Project[]): Transaction[] {
  return projects.flatMap(project => projectPayments(project).map(payment => ({
    id: `project-${project.id}-${payment.id}`,
    kind: "income",
    amount: payment.amountLkr,
    category: "Projects",
    description: project.title,
    date: payment.date,
    createdAt: `${payment.date}T12:00:00.000Z`,
    projectId: project.id,
  })));
}
