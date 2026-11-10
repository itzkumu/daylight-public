"use client";

import { ArrowDownLeft, FolderKanban } from "lucide-react";
import type { Project } from "../lib/firebase-data";
import { projectCurrencyTotals, projectIncomeEntries, unconvertedProjectPayments } from "../lib/project-income";

const cash = (cents: number) => new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR", maximumFractionDigits: 0 }).format(cents / 100);
const currencyCash = (cents: number, currency: string) => new Intl.NumberFormat("en-LK", { style: "currency", currency, maximumFractionDigits: 2 }).format(cents / 100);

export default function ProjectIncomeCard({ projects, title, month, className = "" }: { projects: Project[]; title: string; month?: string; className?: string }) {
  const entries = projectIncomeEntries(projects);
  const paid = entries.reduce((sum, entry) => sum + entry.amount, 0);
  const monthPaid = month ? entries.filter(entry => entry.date.startsWith(month)).reduce((sum, entry) => sum + entry.amount, 0) : 0;
  const totals = projectCurrencyTotals(projects);
  const unconverted = unconvertedProjectPayments(projects);
  return <section className={`card project-income-card ${className}`} aria-label={title}>
    <div className="project-income-heading"><span className="project-income-icon"><FolderKanban size={19}/></span><div><span className="section-kicker">CLIENT WORK</span><h2>{title}</h2></div></div>
    <div className="project-currency-grid">{(totals.length ? totals : [{ currency: "LKR", budget: 0, paid: 0, due: 0, count: 0 }]).map(total => <div className="project-currency-panel" key={total.currency}><div className="project-currency-title"><strong>{total.currency}</strong><span>{total.count} {total.count === 1 ? "project" : "projects"}</span></div><div className="project-currency-values"><div><span>Total budgets</span><strong>{currencyCash(total.budget, total.currency)}</strong></div><div><span>Paid</span><strong>{currencyCash(total.paid, total.currency)}</strong></div><div><span>Still due</span><strong>{currencyCash(total.due, total.currency)}</strong></div></div></div>)}</div>
    <div className="project-income-foot"><span>Included in LKR income <strong>{cash(paid)}</strong></span>{month && <span><ArrowDownLeft size={14}/> This month <strong>{cash(monthPaid)}</strong></span>}</div>
    {unconverted.length > 0 && <div className="project-income-warning" role="status"><strong>Foreign payment missing from LKR totals</strong><span>{unconverted.map(project => `${project.title}: ${new Intl.NumberFormat("en-LK", { style: "currency", currency: project.currency || "EUR" }).format(project.paidAmount || 0)}`).join(" · ")}. Edit {unconverted.length === 1 ? "this project" : "these projects"} to enter the LKR value of the amount already paid.</span></div>}
    <p>Budgets and due amounts stay in each project’s currency. Money counts payments received in LKR or recorded with an LKR value.</p>
  </section>;
}
