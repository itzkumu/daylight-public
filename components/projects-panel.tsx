"use client";

import { useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, CalendarDays, Check, CircleDot, FileText, FolderKanban, GripVertical, Link2, Plus, Trash2, UploadCloud, X } from "lucide-react";
import { changeData, reorderItems, setItemPriority, type Priority, type Project, type ProjectMilestone, type ProjectStatus, type Transaction } from "../lib/firebase-data";
import ProjectIncomeCard from "./project-income-card";
import ProjectExpenses from "./project-expenses";
import { unconvertedProjectPayments } from "../lib/project-income";
import { uploadProjectAttachment } from "../lib/project-attachments";
import { orderedProjects } from "../lib/priority-order";
import { usePersistedOrder } from "./use-persisted-order";

const stages: { value: ProjectStatus; label: string; note: string }[] = [
  { value: "ongoing", label: "Ongoing", note: "What you are moving forward now" },
  { value: "upcoming", label: "Upcoming", note: "Ideas and work ready to start" },
  { value: "done", label: "Done", note: "Finished work you can look back on" },
];
const currencies = ["LKR", "USD", "EUR", "GBP", "AUD", "CAD", "INR"];
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const blank = {
  title: "", status: "upcoming" as ProjectStatus, priority: "normal" as Priority, area: "", summary: "", goal: "", nextStep: "",
  startDate: "", targetDate: "", notes: "", referenceLinksText: "", clientName: "", contactName: "",
  contactEmail: "", contactPhone: "", currency: "LKR", budgetAmount: "", paidAmount: "", paidAmountLkr: "", paymentDate: today(),
  milestones: [] as ProjectMilestone[], attachment: null as Project["attachment"], invoice: null as Project["invoice"],
};
type Draft = typeof blank;

function dateLabel(value: string) {
  if (!value) return "No deadline";
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-LK", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}
function draftFor(project?: Project): Draft {
  if (!project) return { ...blank, paymentDate: today(), milestones: [] };
  return {
    title: project.title, status: project.status, priority: project.priority || "normal", area: project.area || "", summary: project.summary || "",
    goal: project.goal || "", nextStep: project.nextStep || "", startDate: project.startDate || "",
    targetDate: project.targetDate || "", notes: project.notes || "",
    referenceLinksText: (project.referenceLinks?.length ? project.referenceLinks : project.link ? [project.link] : []).join("\n"),
    clientName: project.clientName || "", contactName: project.contactName || "",
    contactEmail: project.contactEmail || "", contactPhone: project.contactPhone || "",
    currency: project.currency || "LKR", budgetAmount: project.budgetAmount == null ? "" : String(project.budgetAmount),
    paidAmount: project.paidAmount ? String(project.paidAmount) : "", paidAmountLkr: project.paidAmountLkr ? String(project.paidAmountLkr) : "", paymentDate: today(), milestones: (project.milestones || []).map(item => ({ ...item })),
    attachment: project.attachment || null, invoice: project.invoice || null,
  };
}

export function ProjectSpotlight({ projects, loading, onOpen }: { projects: Project[]; loading: boolean; onOpen: (project?: Project) => void }) {
  const project = orderedProjects(projects.filter(item => item.status === "ongoing"))[0];
  return <section className="project-spotlight" aria-label="Featured project">
    <div className="project-spotlight-grid" aria-hidden="true" />
    <div className="project-spotlight-orbit" aria-hidden="true"><span /><span /><span /></div>
    <div className="project-spotlight-content">
      <div className="project-eyebrow"><CircleDot size={15} /> ACTIVE PROJECT</div>
      <h2>{loading ? "Opening your projects…" : project ? project.title : "Start something worth building."}</h2>
      <p>{project?.summary || (loading ? "" : "Give your next idea a place to grow. Add a project brief, then keep its next step in sight.")}</p>
      {project && <div className="project-spotlight-meta"><span>{project.clientName || project.area || "Personal project"}</span><span>{project.targetDate ? `Deadline ${dateLabel(project.targetDate)}` : "No deadline"}</span>{project.budgetAmount != null && <span>{money(Math.max(0, project.budgetAmount - (project.paidAmount || 0)), project.currency || "LKR")} due</span>}</div>}
      {project?.nextStep && <div className="project-spotlight-next"><span>NEXT MOVE</span><strong>{project.nextStep}</strong></div>}
      <button onClick={() => onOpen(project)}>{project ? "Edit featured project" : "Create a project"} <ArrowRight size={17} /></button>
    </div>
  </section>;
}

function ProjectCard({ project, transactions, userId, busy, onEdit, onMove, onRemove, onPriority, dragHandle, dragged, dropTarget }: { project: Project; transactions: Transaction[]; userId: string; busy: boolean; onEdit: () => void; onMove: (status: ProjectStatus) => void; onRemove: () => void; onPriority: (priority: Priority) => void; dragHandle: React.ComponentProps<"button">; dragged: boolean; dropTarget: boolean }) {
  const links = project.referenceLinks?.length ? project.referenceLinks : project.link ? [project.link] : [];
  const paid = project.paidAmount || 0;
  const budget = project.budgetAmount;
  const nextMilestone = (project.milestones || []).filter(item => !item.done).sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"))[0];
  return <article data-sort-id={project.id} className={`project-card ${dragged ? "sort-dragged" : ""} ${dropTarget ? "sort-target" : ""}`}>
    <div className="project-card-top"><button type="button" className="sort-handle" aria-label={`Move ${project.title}; drag or press up and down arrow keys`} title="Drag to reorder · arrow keys also work" {...dragHandle}><GripVertical size={17}/></button><span className="project-card-icon"><FolderKanban size={20} /></span><span className="project-card-area">{project.area || "PROJECT"}</span><button aria-label={`Edit ${project.title}`} onClick={onEdit}><ArrowUpRight size={19} /></button></div>
    <h3>{project.title}</h3><p className="project-card-summary">{project.summary || "Add a short description to give this project context."}</p>
    <label className={`priority-select priority-${project.priority || "normal"}`}><span className="sr-only">Priority for {project.title}</span><select aria-label={`Priority for ${project.title}`} value={project.priority || "normal"} onChange={event => onPriority(event.target.value as Priority)} disabled={busy}><option value="high">High priority</option><option value="normal">Normal priority</option><option value="low">Low priority</option></select></label>
    {project.clientName && <p className="project-card-client">Client <strong>{project.clientName}</strong></p>}
    {project.goal && <div className="project-card-goal"><span>GOAL</span><strong>{project.goal}</strong></div>}
    {project.nextStep && project.status !== "done" && <div className="project-card-next"><span>NEXT STEP</span><strong>{project.nextStep}</strong></div>}
    {(budget != null || paid > 0) && <div className="project-card-finance"><div><span>Budget</span><strong>{budget == null ? "Not set" : money(budget, project.currency || "LKR")}</strong></div><div><span>Paid</span><strong>{money(paid, project.currency || "LKR")}</strong></div><div><span>{budget != null && paid > budget ? "Paid above budget" : "Due"}</span><strong>{budget == null ? "—" : money(Math.abs(budget - paid), project.currency || "LKR")}</strong></div></div>}
    <ProjectExpenses project={project} entries={transactions} userId={userId}/>
    {unconvertedProjectPayments([project]).length > 0 && <p className="project-card-fx-warning">Enter the LKR value of what was paid to include it in Money.</p>}
    {nextMilestone && <div className="project-card-milestone"><CircleDot size={13}/><span>Next milestone: <strong>{nextMilestone.title}</strong>{nextMilestone.dueDate && ` · ${dateLabel(nextMilestone.dueDate)}`}</span></div>}
    <div className="project-card-meta"><span><CalendarDays size={14} /> {dateLabel(project.targetDate)}</span>{project.invoice && <a href={project.invoice.url} target="_blank" rel="noreferrer" aria-label={`Open invoice ${project.invoice.name}`}><FileText size={14} /> Invoice</a>}{project.attachment && <a href={project.attachment.url} target="_blank" rel="noreferrer" aria-label={`Open attachment ${project.attachment.name}`}><FileText size={14} /> File</a>}{links[0] && <a href={links[0]} target="_blank" rel="noreferrer" aria-label={`Open first reference for ${project.title}`}><Link2 size={14} /> Reference</a>}{links.length > 1 && <button className="project-more-links" onClick={onEdit}>+{links.length - 1} links</button>}</div>
    <div className="project-card-actions"><button onClick={onEdit}>Edit details</button>{project.status === "upcoming" && <button onClick={() => onMove("ongoing")} disabled={busy}>Start <ArrowRight size={14} /></button>}{project.status === "ongoing" && <button onClick={() => onMove("done")} disabled={busy} title="Marks the full budget as paid and records any remaining LKR income today">Mark done & paid <Check size={14} /></button>}{project.status === "done" && <button onClick={() => onMove("ongoing")} disabled={busy}>Reopen <ArrowRight size={14} /></button>}<button className="project-remove" onClick={onRemove} disabled={busy} aria-label={`Remove ${project.title}`}><Trash2 size={15} /></button></div>
  </article>;
}

function ProjectStage({ stage, projects, transactions, userId, loading, busy, onEdit, onMove, onRemove, onError }: { stage: typeof stages[number]; projects: Project[]; transactions: Transaction[]; userId: string; loading: boolean; busy: boolean; onEdit: (project?: Project) => void; onMove: (project: Project, status: ProjectStatus) => void; onRemove: (project: Project) => void; onError: (message: string) => void }) {
  const items = orderedProjects(projects.filter(project => project.status === stage.value));
  const order = usePersistedOrder(items, ids => reorderItems(userId, "projects", ids), onError);
  return <section className="project-stage" aria-labelledby={`project-stage-${stage.value}`}>
    <div className="project-stage-heading"><div><span className={`project-stage-dot ${stage.value}`} /><h2 id={`project-stage-${stage.value}`}>{stage.label}</h2><span className="project-stage-count">{items.length}</span></div><p>Drag to reorder</p></div>
    {loading ? <div className="project-loading" role="status">Loading projects…</div> : items.length ? <div className="project-card-grid priority-list">{order.items.map(project => <ProjectCard key={project.id} project={project} transactions={transactions} userId={userId} busy={busy} onEdit={() => onEdit(project)} onMove={status => onMove(project, status)} onRemove={() => onRemove(project)} onPriority={priority => void setItemPriority(userId, "projects", project.id, priority).catch(issue => onError(issue instanceof Error ? issue.message : "Could not update priority."))} dragHandle={order.bind(project.id)} dragged={order.draggedId === project.id} dropTarget={order.targetId === project.id && order.draggedId !== project.id} />)}</div> : <div className="project-empty"><span><FolderKanban size={22} /></span><div><strong>{stage.value === "upcoming" ? "Your next idea goes here" : stage.value === "ongoing" ? "Nothing in motion yet" : "Finished projects will gather here"}</strong><p>{stage.value === "done" ? "Mark an ongoing project done when you finish it." : "Create a project brief and keep the details together."}</p></div>{stage.value !== "done" && <button onClick={() => onEdit()}>Add project <Plus size={15} /></button>}</div>}
  </section>;
}

export default function ProjectsPanel({ userId, projects, transactions, loading }: { userId: string; projects: Project[]; transactions: Transaction[]; loading: boolean }) {
  const [editing, setEditing] = useState<Project | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFor());
  const [file, setFile] = useState<File | null>(null);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!showForm) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) setShowForm(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [showForm, busy]);

  function openForm(project?: Project) {
    setEditing(project || null);
    setDraft(draftFor(project));
    setFile(null);
    setInvoiceFile(null);
    setError("");
    setShowForm(true);
  }
  function updateMilestone(id: string, changes: Partial<ProjectMilestone>) {
    setDraft(current => ({ ...current, milestones: current.milestones.map(item => item.id === id ? { ...item, ...changes } : item) }));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const referenceLinks = draft.referenceLinksText.split(/\r?\n/).map(link => link.trim()).filter(Boolean);
    if (draft.startDate && draft.targetDate && draft.targetDate < draft.startDate) { setError("The deadline must be on or after the start date."); return; }
    if (referenceLinks.length > 10 || referenceLinks.some(link => !/^https?:\/\//i.test(link))) { setError("Add up to 10 full http or https reference links, one per line."); return; }
    const validAmount = (value: string) => value === "" || (Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1_000_000_000 && Math.abs(Number(value) * 100 - Math.round(Number(value) * 100)) < 0.000001);
    if (!validAmount(draft.budgetAmount) || !validAmount(draft.paidAmount) || !validAmount(draft.paidAmountLkr)) { setError("Enter budget and paid amounts with up to two decimal places."); return; }
    const finalPaid = draft.status === "done" && draft.budgetAmount !== "" ? Math.max(Number(draft.budgetAmount), Number(draft.paidAmount || 0)) : Number(draft.paidAmount || 0);
    if (draft.currency !== "LKR" && finalPaid > 0 && (!draft.paidAmountLkr || Number(draft.paidAmountLkr) <= 0)) { setError(`Enter the LKR value of the ${money(finalPaid, draft.currency)} paid so far, not the full project price.`); return; }
    if (draft.currency !== "LKR" && editing && finalPaid > (editing.paidAmount || 0) && Number(draft.paidAmountLkr || 0) <= (editing.paidAmountLkr || 0)) { setError("Update the amount received in LKR for this new payment."); return; }
    if (invoiceFile && !(/\.(pdf|png|jpe?g|webp|gif)$/i.test(invoiceFile.name) || invoiceFile.type === "application/pdf" || invoiceFile.type.startsWith("image/"))) { setError("Choose a PDF or image for the invoice."); return; }
    setBusy(true); setError("");
    try {
      const attachment = file ? await uploadProjectAttachment(userId, file) : draft.attachment;
      const invoice = invoiceFile ? await uploadProjectAttachment(userId, invoiceFile) : draft.invoice;
      await changeData(userId, editing ? "PATCH" : "POST", {
        collection: "projects", id: editing?.id, ...draft, referenceLinks,
        budgetAmount: draft.budgetAmount === "" ? null : Number(draft.budgetAmount),
        paidAmount: finalPaid, paidAmountLkr: draft.currency === "LKR" ? finalPaid : Number(draft.paidAmountLkr || 0), expectedPaidAmountLkr: editing ? (editing.paidAmountLkr ?? ((editing.currency === "LKR" || !editing.currency) ? editing.paidAmount || 0 : 0)) : undefined, paymentDate: draft.paymentDate, attachment, invoice,
      });
      setShowForm(false); setFile(null); setInvoiceFile(null);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Could not save this project."); }
    finally { setBusy(false); }
  }
  async function move(project: Project, status: ProjectStatus) {
    if (status === "done" && project.currency !== "LKR" && project.currency && ((project.budgetAmount != null && (project.paidAmount || 0) < project.budgetAmount) || ((project.paidAmount || 0) > 0 && !project.paidAmountLkr))) {
      openForm(project);
      setDraft(current => ({ ...current, status: "done", paidAmount: String(project.budgetAmount == null ? project.paidAmount || 0 : Math.max(project.budgetAmount, project.paidAmount || 0)) }));
      return;
    }
    setBusy(true); setError("");
    try { await changeData(userId, "PATCH", { collection: "projects", id: project.id, status, stageOnly: true }); }
    catch (issue) { setError(issue instanceof Error ? issue.message : "Could not update this project."); }
    finally { setBusy(false); }
  }
  async function remove(project: Project) {
    if (!window.confirm(`Remove “${project.title}” from Daylight? Its costs will remain in Money as ordinary expenses. Attached files will remain in Google Drive.`)) return;
    setBusy(true); setError("");
    try { await changeData(userId, "DELETE", { collection: "projects", id: project.id }); }
    catch (issue) { setError(issue instanceof Error ? issue.message : "Could not remove this project."); }
    finally { setBusy(false); }
  }

  const budget = draft.budgetAmount === "" ? null : Number(draft.budgetAmount);
  const paid = draft.status === "done" && budget != null ? Math.max(budget, Number(draft.paidAmount || 0)) : Number(draft.paidAmount || 0);
  const due = budget == null ? null : Math.max(0, budget - paid);

  return <div className="projects-page">
    <div className="projects-intro"><div><span className="eyebrow">YOUR WORK, IN MOTION</span><h1>Projects<span className="period">.</span></h1><p>Keep the brief, client, timeline, budget, and files together.</p></div><button className="primary-button" onClick={() => openForm()}><Plus size={18} /> New project</button></div>
    <ProjectIncomeCard projects={projects} title="Project totals" />
    <ProjectSpotlight projects={projects} loading={loading} onOpen={openForm}/>
    <div className="project-metrics" aria-label="Project counts">{stages.map(stage => <div className={`project-metric project-metric-${stage.value}`} key={stage.value}><span>{stage.label}</span><strong>{projects.filter(project => project.status === stage.value).length.toString().padStart(2, "0")}</strong><small>{stage.note}</small></div>)}</div>
    {error && !showForm && <div className="project-error" role="alert">{error}<button onClick={() => setError("")}>Dismiss</button></div>}
    {stages.map(stage => <ProjectStage key={stage.value} stage={stage} projects={projects} transactions={transactions} userId={userId} loading={loading} busy={busy} onEdit={openForm} onMove={(project, status) => void move(project, status)} onRemove={project => void remove(project)} onError={setError} />)}
    {showForm && <div className="modal-backdrop project-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setShowForm(false); }}>
      <div className="project-modal" role="dialog" aria-modal="true" aria-labelledby="project-modal-title">
        <div className="project-modal-header"><div><span className="section-kicker">PROJECT BRIEF</span><h2 id="project-modal-title">{editing ? "Edit project" : "New project"}</h2><p>Plan the work, track payment, and keep the client details close.</p></div><button className="project-modal-close" onClick={() => setShowForm(false)} disabled={busy} aria-label="Close project form"><X size={20} /></button></div>
        <form onSubmit={save}>
          <div className="project-form-grid">
            <section><h3>01 / Project</h3>
              <label>Project title<input autoFocus required maxLength={180} placeholder="e.g. Brand identity for Acme" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
              <label>Priority<select value={draft.priority} onChange={event => setDraft({ ...draft, priority: event.target.value as Priority })}><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label>
              <label>Stage<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as ProjectStatus })}>{stages.map(stage => <option key={stage.value} value={stage.value}>{stage.label}</option>)}</select></label>
              <label>Area or type <span>optional</span><input maxLength={80} placeholder="e.g. Branding, web, production" value={draft.area} onChange={event => setDraft({ ...draft, area: event.target.value })} /></label>
              <label>What is this project about? <span>optional</span><textarea maxLength={500} rows={4} placeholder="The brief and main deliverables" value={draft.summary} onChange={event => setDraft({ ...draft, summary: event.target.value })} /></label>
              <label>What does done look like? <span>optional</span><textarea maxLength={500} rows={3} placeholder="The outcome the client expects" value={draft.goal} onChange={event => setDraft({ ...draft, goal: event.target.value })} /></label>
            </section>
            <section><h3>02 / Client & timeline</h3>
              <label>Client or company <span>optional</span><input maxLength={180} placeholder="Client name" value={draft.clientName} onChange={event => setDraft({ ...draft, clientName: event.target.value })} /></label>
              <label>Contact person <span>optional</span><input maxLength={180} placeholder="Who to speak with" value={draft.contactName} onChange={event => setDraft({ ...draft, contactName: event.target.value })} /></label>
              <div className="project-date-grid"><label>Contact email <span>optional</span><input type="email" maxLength={254} placeholder="name@example.com" value={draft.contactEmail} onChange={event => setDraft({ ...draft, contactEmail: event.target.value })} /></label><label>Contact phone <span>optional</span><input type="tel" maxLength={80} placeholder="+94…" value={draft.contactPhone} onChange={event => setDraft({ ...draft, contactPhone: event.target.value })} /></label></div>
              <div className="project-date-grid"><label>Start date <span>optional</span><input type="date" value={draft.startDate} onChange={event => setDraft({ ...draft, startDate: event.target.value })} /></label><label>Deadline <span>optional</span><input type="date" value={draft.targetDate} onChange={event => setDraft({ ...draft, targetDate: event.target.value })} /></label></div>
              <label>Next step <span>optional</span><input maxLength={300} placeholder="The next concrete action" value={draft.nextStep} onChange={event => setDraft({ ...draft, nextStep: event.target.value })} /></label>
            </section>
          </div>
          <section className="project-form-resources"><h3>03 / Budget & invoice</h3>
            <div className="project-payment-grid"><label>Currency<select value={draft.currency} onChange={event => setDraft({ ...draft, currency: event.target.value })}>{currencies.map(currency => <option key={currency} value={currency}>{currency}</option>)}</select></label><label>Full project price ({draft.currency}) <span>optional · includes unpaid work</span><input type="number" min="0" max="1000000000" step="0.01" inputMode="decimal" placeholder="0.00" value={draft.budgetAmount} onChange={event => setDraft({ ...draft, budgetAmount: event.target.value })} /></label><label>Paid so far ({draft.currency}) <span>money already received</span><input type="number" min="0" max="1000000000" step="0.01" inputMode="decimal" placeholder="0.00" value={paid || ""} disabled={draft.status === "done" && budget != null} onChange={event => setDraft({ ...draft, paidAmount: event.target.value })} /></label><div className="project-due-preview"><span>{budget != null && paid > budget ? "Paid above budget" : "Still unpaid"}</span><strong>{due == null ? "Add full price" : money(paid > (budget || 0) ? paid - (budget || 0) : due, draft.currency)}</strong><small>Full price minus paid so far</small></div></div>
            {editing && draft.currency !== (editing.currency || "LKR") && <p className="project-currency-change" role="status">Changing the currency does not convert the numbers. Check the full price and amount paid in {draft.currency}, and update the LKR value before saving.</p>}
            {draft.currency !== "LKR" && <label className="project-lkr-input">LKR value of payments received <span>convert only what has already been paid</span><input type="number" min="0" max="1000000000" step="0.01" inputMode="decimal" placeholder="0.00" value={draft.paidAmountLkr} onChange={event => setDraft({ ...draft, paidAmountLkr: event.target.value })} /><small className="project-payment-explainer">{paid > 0 ? `This is the LKR equivalent of the ${money(paid, draft.currency)} paid so far${due != null && due > 0 ? `; leave the unpaid ${money(due, draft.currency)} out` : ""}. Include earlier payments in this total.` : "Enter an LKR amount only after a payment arrives. The full project price stays in the selected currency."}</small></label>}
            <label className="project-lkr-input">Date payment was received <span>choose the date for newly recorded paid income</span><input type="date" value={draft.paymentDate} onChange={event => setDraft({ ...draft, paymentDate: event.target.value })} /></label>
            <p className="project-form-hint">Only the paid amount becomes income. New payments count in the month you received them. Marking an LKR project Done records any unpaid balance as received today.</p>
            <label className="project-file-label"><UploadCloud size={19} /><span>{invoiceFile ? invoiceFile.name : draft.invoice ? draft.invoice.name : "Upload invoice"}</span><small>PDF or image · saved to Google Drive · up to 10 MB</small><input type="file" accept=".pdf,image/*" onChange={event => setInvoiceFile(event.target.files?.[0] || null)} /></label>
            {draft.invoice && !invoiceFile && <button className="project-clear-file" type="button" onClick={() => setDraft({ ...draft, invoice: null })}>Remove invoice from project</button>}
          </section>
          <section className="project-form-resources"><div className="project-section-heading"><h3>04 / Milestones</h3><button type="button" onClick={() => setDraft(current => ({ ...current, milestones: [...current.milestones, { id: crypto.randomUUID(), title: "", dueDate: "", done: false }] }))} disabled={draft.milestones.length >= 20}><Plus size={14}/> Add milestone</button></div>
            {draft.milestones.length ? <div className="project-milestone-list">{draft.milestones.map((item, index) => <div className="project-milestone-edit" key={item.id}><label className="project-milestone-check"><input type="checkbox" checked={item.done} onChange={event => updateMilestone(item.id, { done: event.target.checked })} /><span>Done</span></label><label>Milestone {index + 1}<input required maxLength={180} placeholder="e.g. First design review" value={item.title} onChange={event => updateMilestone(item.id, { title: event.target.value })} /></label><label>Due date <span>optional</span><input type="date" value={item.dueDate} onChange={event => updateMilestone(item.id, { dueDate: event.target.value })} /></label><button type="button" aria-label={`Remove milestone ${index + 1}`} onClick={() => setDraft(current => ({ ...current, milestones: current.milestones.filter(entry => entry.id !== item.id) }))}><Trash2 size={16}/></button></div>)}</div> : <p className="project-form-hint">Add key reviews, deliveries, or payment stages if this project has them.</p>}
          </section>
          <section className="project-form-resources"><h3>05 / References & files</h3>
            <label>Reference links <span>optional · one URL per line</span><textarea maxLength={10000} rows={3} placeholder={"https://example.com/brief\nhttps://example.com/inspiration"} value={draft.referenceLinksText} onChange={event => setDraft({ ...draft, referenceLinksText: event.target.value })} /></label>
            {editing && (editing.referenceLinks?.length || editing.link) && <div className="project-reference-list">{(editing.referenceLinks?.length ? editing.referenceLinks : [editing.link]).map((link, index) => <a href={link} key={`${link}-${index}`} target="_blank" rel="noreferrer"><Link2 size={13}/> Open reference {index + 1}</a>)}</div>}
            <label>Notes <span>optional</span><textarea maxLength={4000} rows={4} placeholder="Decisions, requirements, or anything useful to remember" value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label>
            <label className="project-file-label"><UploadCloud size={19} /><span>{file ? file.name : draft.attachment ? draft.attachment.name : "Attach another project file"}</span><small>Saved to Google Drive · up to 10 MB</small><input type="file" onChange={event => setFile(event.target.files?.[0] || null)} /></label>
            {draft.attachment && !file && <button className="project-clear-file" type="button" onClick={() => setDraft({ ...draft, attachment: null })}>Remove attachment from project</button>}
          </section>
          {error && <p className="project-form-error" role="alert">{error}</p>}
          <div className="project-form-footer"><span><CircleDot size={14} /> Changes sync across your devices.</span><button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create project"} <ArrowRight size={17} /></button></div>
        </form>
      </div>
    </div>}
  </div>;
}
