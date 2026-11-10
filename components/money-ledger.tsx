"use client";

import { ArrowDownLeft, ArrowUpRight, FolderKanban, Pencil, Trash2, Wallet } from "lucide-react";
import { moneyGroup } from "../lib/money-review";

export type LedgerEntry = { id: string; kind: string; amount: number; category: string; description: string; date: string; billId?: string; projectId?: string };

type Props = {
  entries: LedgerEntry[];
  monthCount: number;
  busy: boolean;
  formatMoney: (cents: number) => string;
  onEdit: (entry: LedgerEntry) => void;
  onDelete: (entry: LedgerEntry) => void;
  onOpenProject: () => void;
  onAdd: () => void;
};

export default function MoneyLedger({ entries, monthCount, busy, formatMoney, onEdit, onDelete, onOpenProject, onAdd }: Props) {
  const groups = [
    { kind: "expense", title: "Expenses", hint: "Money out", icon: ArrowUpRight },
    { kind: "income", title: "Income", hint: "Money in", icon: ArrowDownLeft },
    { kind: "projects", title: "Projects", hint: "Client payments", icon: FolderKanban },
  ] as const;
  return <section className="card large-card ledger-card">
    <div className="card-title-row ledger-title"><div><span className="section-kicker">YOUR ACTIVITY</span><h2>Entries for this month</h2></div><span className="quiet-label">{monthCount} ENTRIES</span></div>
    {entries.length ? <div className="ledger-groups">{groups.map(group => {
      const list = entries.filter(entry => moneyGroup(entry) === group.kind);
      const Icon = group.icon;
      return <div className={`ledger-group ${group.kind}`} key={group.kind}>
        <div className="ledger-group-heading"><div className="ledger-group-icon"><Icon size={16}/></div><div><h3>{group.title}</h3><span>{group.hint}</span></div><strong>{list.length}</strong></div>
        {list.length > 3 && <span className="ledger-scroll-hint">Scroll to view all {list.length} entries</span>}
        {list.length ? <div className="ledger-list" role="region" aria-label={`${group.title} for this month`} tabIndex={0}>{list.map(entry => <div className="ledger-entry" key={entry.id}>
          <div className="ledger-entry-main"><strong>{entry.description || entry.category}</strong><span>{entry.category} <i>·</i> {new Date(`${entry.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}{entry.billId ? " · Bill" : ""}{entry.kind === "expense" && entry.projectId ? " · Project expense" : ""}</span></div>
          <b className="ledger-amount">{group.kind === "expense" ? "−" : "+"}{formatMoney(entry.amount)}</b>
          <div className="ledger-entry-actions">{group.kind === "projects" ? <button type="button" onClick={onOpenProject}><FolderKanban size={13}/> Open project</button> : <><button type="button" aria-label={`Edit ${entry.description || entry.category}`} title="Edit entry" onClick={() => onEdit(entry)} disabled={busy}><Pencil size={13}/> Edit</button><button type="button" aria-label={`Delete ${entry.description || entry.category}`} title={entry.billId ? "Remove bill and expense" : "Delete entry"} onClick={() => onDelete(entry)} disabled={busy}><Trash2 size={14}/> Delete</button></>}</div>
        </div>)}</div> : <div className="ledger-empty">No {group.kind === "projects" ? "project payments" : group.kind === "income" ? "other income" : "expenses"} yet.</div>}
      </div>;
    })}</div> : <div className="empty-state ledger-first-empty"><div className="empty-icon"><Wallet size={22}/></div><strong>Start with today</strong><p>Log even the small purchases. Patterns will appear here.</p><button onClick={onAdd}>Add your first entry <ArrowUpRight size={14}/></button></div>}
  </section>;
}
