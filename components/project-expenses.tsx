"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, Plus, ReceiptText, Trash2, X } from "lucide-react";
import { changeData, type Project, type Transaction } from "../lib/firebase-data";

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const lkr = (cents: number) => new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR", maximumFractionDigits: 2 }).format(cents / 100);
const categories = ["Food & drink", "Transport", "Shopping", "Bills", "Subscriptions", "Health", "Other"];

export default function ProjectExpenses({ project, entries, userId }: { project: Project; entries: Transaction[]; userId: string }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Other");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const expenses = entries.filter(entry => entry.kind === "expense" && entry.projectId === project.id);
  const spent = expenses.reduce((sum, entry) => sum + entry.amount, 0);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, busy]);

  function reset(entry?: Transaction) {
    setEditing(entry || null);
    setAmount(entry ? String(entry.amount / 100) : "");
    setCategory(entry?.category || "Other");
    setDescription(entry?.description || "");
    setDate(entry?.date || today());
    setError("");
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await changeData(userId, editing ? "PATCH" : "POST", { collection: "transactions", id: editing?.id, kind: "expense", amount, category, description, date, projectId: project.id });
      reset();
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Could not save this cost."); }
    finally { setBusy(false); }
  }
  async function remove(entry: Transaction) {
    const warning = entry.billId ? "Remove this bill and its linked expense? The original file stays in Google Drive." : "Delete this project expense from Daylight Money too?";
    if (!window.confirm(warning)) return;
    setBusy(true); setError("");
    try { await changeData(userId, "DELETE", { collection: "transactions", id: entry.id }); if (editing?.id === entry.id) reset(); }
    catch (issue) { setError(issue instanceof Error ? issue.message : "Could not delete this cost."); }
    finally { setBusy(false); }
  }

  return <>
    <div className="project-expense-summary"><div><span>PROJECT EXPENSES</span><strong>{lkr(spent)}</strong><small>{expenses.length} {expenses.length === 1 ? "cost" : "costs"} · included in Money spending</small></div><button type="button" onClick={() => { reset(); setOpen(true); }}><Plus size={15}/> Manage costs</button></div>
    {open && createPortal(<div className="modal-backdrop project-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
      <div className="project-modal project-expense-modal" role="dialog" aria-modal="true" aria-labelledby={`project-expenses-${project.id}`}>
        <div className="project-modal-header"><div><span className="section-kicker">CLIENT WORK / COSTS</span><h2 id={`project-expenses-${project.id}`}>{project.title}</h2><p>Project costs also appear once in Money expenses and monthly spending.</p></div><button type="button" className="project-modal-close" onClick={() => setOpen(false)} disabled={busy} aria-label="Close project expenses"><X size={20}/></button></div>
        <div className="project-expense-total"><span>Total spent on this project</span><strong>{lkr(spent)}</strong></div>
        <div className="project-expense-list" role="region" aria-label={`Expenses for ${project.title}`} tabIndex={0}>{expenses.length ? expenses.map(entry => <div className="project-expense-row" key={entry.id}><div><strong>{entry.description || entry.category}</strong><span>{entry.date} · {entry.category}{entry.billId ? " · Bill attached" : ""}</span></div><b>−{lkr(entry.amount)}</b><button type="button" onClick={() => reset(entry)} disabled={busy} aria-label={`Edit ${entry.description || entry.category}`}><Pencil size={15}/></button><button type="button" onClick={() => void remove(entry)} disabled={busy} aria-label={`Delete ${entry.description || entry.category}`}><Trash2 size={15}/></button></div>) : <p className="project-expense-empty"><ReceiptText size={17}/> No project costs yet.</p>}</div>
        <form onSubmit={event => void save(event)} className="project-expense-form"><h3>{editing ? "Edit cost" : "Add a cost"}</h3><div className="project-expense-fields"><label>Amount (LKR)<input type="number" required min="0.01" max="1000000000" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" /></label><label>Date<input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label><label>Category<select value={category} onChange={event => setCategory(event.target.value)}>{!categories.includes(category) && <option>{category}</option>}{categories.map(item => <option key={item}>{item}</option>)}</select></label><label>Description<input value={description} onChange={event => setDescription(event.target.value)} maxLength={180} placeholder="e.g. Materials for this client" /></label></div>{editing?.billId ? <p className="project-expense-note">Editing this expense also updates its linked bill details.</p> : <p className="project-expense-note">Have a receipt? Add it in Money → Bills, then edit its expense in Money and choose this project.</p>}{error && <p className="project-error" role="alert">{error}</p>}<div className="project-expense-actions">{editing && <button type="button" onClick={() => reset()} disabled={busy}>Cancel edit</button>}<button type="submit" className="primary-button" disabled={busy}>{busy ? "Saving…" : editing ? "Save cost" : "Add cost"}</button></div></form>
      </div>
    </div>, document.body)}
  </>;
}
