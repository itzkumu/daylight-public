"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { ArrowRight, ArrowUpRight, BarChart3, CalendarDays, Camera, Check, CircleHelp, Clock3, FolderKanban, GripVertical, LayoutGrid, Menu, Plus, ReceiptText, Sparkles, Trash2, Wallet, X } from "lucide-react";
import { changeData, getFirebase, hasFirebaseConfig, reorderItems, setItemPriority, signIn, signOutUser, subscribeData, type Data, type Priority, type Task } from "../lib/firebase-data";
import { connectGoogleCalendar, disconnectGoogleCalendar, getCalendarConnection, getCalendarItems, removeTaskFromCalendar, syncTaskToCalendar, type CalendarConnection, type CalendarItems } from "../lib/google-calendar";
import BillsPanel from "../components/bills-panel";
import SocialConnections from "../components/social-connections";
import SocialAnalytics from "../components/social-analytics";
import MoneyLedger from "../components/money-ledger";
import MoneyReview from "../components/money-review";
import ProjectIncomeCard from "../components/project-income-card";
import NotificationCenter from "../components/notification-center";
import AssistantPanel from "../components/assistant-panel";
import CalendarItemsPanel from "../components/calendar-items-panel";
import LecturesMeetingsPanel from "../components/lectures-meetings-panel";
import AgentConnection from "../components/agent-connection";
import ProjectsPanel from "../components/projects-panel";
import OverviewDashboard from "../components/overview-dashboard";
import SocialPlatformIcon from "../components/social-platform-icon";
import { orderedTasks } from "../lib/priority-order";
import { unconvertedProjectPayments } from "../lib/project-income";
import { usePersistedOrder } from "../components/use-persisted-order";

type Transaction = { id: string; kind: string; amount: number; category: string; description: string; date: string; billId?: string; projectId?: string };
type Post = { id: string; platform: string; title: string; caption?: string; scheduledAt: string | null; status: string };
type View = "Overview" | "Projects" | "Tasks" | "Lectures & Meetings" | "Money" | "Content" | "Analytics" | "Assistant" | "Connections";
const empty: Data = { tasks: [], transactions: [], posts: [], bills: [], projects: [] };
const money = (cents: number) => new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR", maximumFractionDigits: 2 }).format(cents / 100);
const spendingColors = ["#b5fb5f", "#49cfb3", "#6ea5f4", "#d8edc0", "#8b83d9", "#f1b884", "#9caab9"];
const niceDate = (value: string) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const localKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dateKey = () => localKey(new Date());
const thisMonth = () => dateKey().slice(0, 7);

function Brand() {
  return <div className="brand"><span className="brand-art brand-logo" aria-hidden="true"/><span className="brand-copy"><strong>Airly Forge Studio</strong><small>DAYLIGHT WORKSPACE</small></span></div>;
}

function downloadCalendar(task: Task) {
  if (!task.dueAt) return;
  const start = new Date(task.dueAt), end = new Date(start.getTime() + 30 * 60000);
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const safe = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Daylight//Tasks//EN", "BEGIN:VEVENT", `UID:${task.id}@daylight`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${safe(task.title)}`, `DESCRIPTION:${safe(task.notes || "Created in Daylight")}`, "BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY", "DESCRIPTION:Task reminder", "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" })); a.download = "daylight-task.ics"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function Home() {
  const [view, setView] = useState<View>("Overview");
  const [calendarNotice, setCalendarNotice] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("view") === "connections") queueMicrotask(() => setView("Connections"));
    if (params.get("view") === "analytics") queueMicrotask(() => setView("Analytics"));
    if (params.get("view") === "money") queueMicrotask(() => setView("Money"));
    if (params.get("view") === "calendar") queueMicrotask(() => setView("Lectures & Meetings"));
    if (params.get("view") === "projects") queueMicrotask(() => setView("Projects"));
    if (params.get("calendar") === "error") queueMicrotask(() => setCalendarNotice(params.get("message") || "Google Calendar could not be connected."));
    if (params.has("calendar")) window.history.replaceState(null, "", window.location.pathname);
  }, []);
  const [data, setData] = useState<Data>(empty);
  const [loading, setLoading] = useState(hasFirebaseConfig);
  const [authReady, setAuthReady] = useState(() => !hasFirebaseConfig());
  const [user, setUser] = useState<User | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);
  const [error, setError] = useState("");
  const [form, setForm] = useState<"task" | "transaction" | "post" | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [moneyMonth, setMoneyMonth] = useState(thisMonth());
  const [taskTitle, setTaskTitle] = useState(""); const [taskDue, setTaskDue] = useState(""); const [taskNotes, setTaskNotes] = useState(""); const [taskPriority, setTaskPriority] = useState<Priority>("normal");
  const [kind, setKind] = useState("expense"); const [amount, setAmount] = useState(""); const [category, setCategory] = useState("Food & drink"); const [description, setDescription] = useState(""); const [entryDate, setEntryDate] = useState(dateKey());
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [transactionProjectId, setTransactionProjectId] = useState("");
  const [platform, setPlatform] = useState("Instagram"); const [postTitle, setPostTitle] = useState(""); const [postCaption, setPostCaption] = useState(""); const [postDate, setPostDate] = useState("");
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [saving, setSaving] = useState(false);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarConnection, setCalendarConnection] = useState<CalendarConnection>({ configured: false, connected: false });
  const [calendarChecked, setCalendarChecked] = useState(false);
  const [calendarLoadFailed, setCalendarLoadFailed] = useState(false);
  const [googleItems, setGoogleItems] = useState<CalendarItems | null>(null);
  const [googleItemsLoading, setGoogleItemsLoading] = useState(false);
  const [googleItemsError, setGoogleItemsError] = useState("");
  const [googleItemsRevision, setGoogleItemsRevision] = useState(0);
  const syncAttempts = useRef(new Set<string>());
  const refresh = useCallback(() => setLoadRevision(value => value + 1), []);
  useEffect(() => {
    const firebase = getFirebase();
    if (!firebase) return;
    return onAuthStateChanged(firebase.auth, account => { setUser(account); setAuthReady(true); if (!account) { setCalendarConnected(false); setCalendarConnection({ configured: false, connected: false }); setCalendarChecked(false); setCalendarLoadFailed(false); syncAttempts.current.clear(); setData(empty); setLoading(false); } }, issue => { setError(issue.message); setAuthReady(true); setLoading(false); });
  }, []);
  useEffect(() => {
    if (!user) return;
    let active = true;
    queueMicrotask(() => { setCalendarChecked(false); setCalendarLoadFailed(false); });
    getCalendarConnection(user.uid).then(result => { if (active) { setCalendarConnection(result); setCalendarConnected(result.connected); } })
      .catch(issue => { if (active) { setCalendarLoadFailed(true); setCalendarNotice(issue instanceof Error ? issue.message : "Could not load Calendar connection."); } })
      .finally(() => { if (active) setCalendarChecked(true); });
    return () => { active = false; };
  }, [user]);
  useEffect(() => {
    if (!user) return;
    const timer = setTimeout(() => setLoading(true), 0);
    const unsubscribe = subscribeData(user.uid, value => { setData(value); setLoading(false); setError(""); }, issue => { setError(issue.message); setLoading(false); });
    return () => { clearTimeout(timer); unsubscribe(); };
  }, [user, loadRevision]);
  useEffect(() => {
    if (!user || !calendarConnected) return;
    let active = true;
    const load = async () => {
      setGoogleItemsLoading(true);
      try {
        const items = await getCalendarItems(user.uid);
        if (active) { setGoogleItems(items); setGoogleItemsError(""); }
      } catch (issue) {
        if (active) setGoogleItemsError(issue instanceof Error ? issue.message : "Could not load Google Calendar.");
      } finally { if (active) setGoogleItemsLoading(false); }
    };
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 120_000);
    const onFocus = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", onFocus);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [user, calendarConnected, googleItemsRevision]);
  useEffect(() => {
    if (view === "Lectures & Meetings" && calendarConnected) queueMicrotask(() => setGoogleItemsRevision(value => value + 1));
  }, [view, calendarConnected]);
  useEffect(() => {
    if (user && calendarConnected) return;
    queueMicrotask(() => { setGoogleItems(null); setGoogleItemsError(""); setGoogleItemsLoading(false); });
  }, [user, calendarConnected]);
  useEffect(() => {
    if (!user || !calendarChecked || !calendarConnected || loading) return;
    const pending = data.tasks.filter(task => task.dueAt && !task.calendarEventId && !syncAttempts.current.has(task.id));
    for (const task of pending) {
      syncAttempts.current.add(task.id);
      void syncTaskToCalendar(user.uid, task).catch(issue => setError(`Google Calendar could not add ${task.title}. Retry from Tasks. ${issue instanceof Error ? issue.message : ""}`));
    }
  }, [user, calendarChecked, calendarConnected, loading, data.tasks]);
  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool: (tool: Record<string, unknown>, options: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool || !user) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: "create_daylight_task", title: "Add a Daylight task",
      description: "Save a task to the signed-in user's Daylight dashboard.",
      inputSchema: { type: "object", properties: { title: { type: "string" }, dueAt: { type: "string", description: "Optional ISO date and time" }, notes: { type: "string" } }, required: ["title"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input: unknown) {
        const value = input as { title?: string; dueAt?: string; notes?: string };
        if (!value?.title?.trim()) throw new Error("A task title is required.");
        const result = await changeData(user.uid, "POST", { collection: "tasks", ...value });
        if (!result.row) throw new Error("Could not save task.");
        const task = result.row as Task;
        if (task.dueAt && calendarConnected) await syncTaskToCalendar(user.uid, task);
        return { id: task.id, title: value.title.trim(), calendar: task.dueAt ? (calendarConnected ? "added" : "needs calendar connection") : "needs a date and time" };
      },
    }, { signal: lifecycle.signal })).catch(() => {});
    return () => lifecycle.abort();
  }, [user, calendarConnected]);
  async function send(method: string, payload: Record<string, unknown>) { if (!user) { setError("Sign in to save your changes."); return false; } setSaving(true); setError(""); try { await changeData(user.uid, method, payload); return true; } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); return false; } finally { setSaving(false); } }
  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!user) { setError("Sign in to save your task."); return; }
    setSaving(true); setError("");
    try {
      const dueAt = taskDue ? new Date(taskDue).toISOString() : null;
      const result = await changeData(user.uid, "POST", { collection: "tasks", title: taskTitle, dueAt, notes: taskNotes, priority: taskPriority });
      const task = result.row as Task;
      setTaskTitle(""); setTaskDue(""); setTaskNotes(""); setTaskPriority("normal"); setForm(null);
      if (dueAt && calendarConnected) {
        syncAttempts.current.add(task.id);
        try { await syncTaskToCalendar(user.uid, task); }
        catch (issue) { setError(`Task saved, but Google Calendar could not add it. Use Retry calendar sync on the task. ${issue instanceof Error ? issue.message : ""}`); }
      } else if (dueAt) {
        setError("Task saved. Connect Google Calendar in Connections to sync it automatically.");
      }
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Could not save your task."); }
    finally { setSaving(false); }
  }
  async function connectCalendar() {
    if (!user) return;
    setCalendarBusy(true); setError("");
    try {
      if (!calendarConnected) { await connectGoogleCalendar(user.uid); return; }
      const pending = data.tasks.filter(task => task.dueAt && !task.calendarEventId);
      const outcomes = await Promise.allSettled(pending.map(task => syncTaskToCalendar(user.uid, task)));
      const failed = outcomes.filter(outcome => outcome.status === "rejected").length;
      setGoogleItemsRevision(value => value + 1);
      if (failed) setError(`${failed} dated task${failed === 1 ? "" : "s"} could not be added to Google Calendar. Retry from Tasks.`);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Could not connect Google Calendar."); }
    finally { setCalendarBusy(false); }
  }
  async function enableGoogleTasks() {
    if (!user) return;
    setGoogleItemsError("");
    try { await connectGoogleCalendar(user.uid); }
    catch (issue) { setGoogleItemsError(issue instanceof Error ? issue.message : "Could not open Google permissions."); }
  }
  async function disconnectCalendar() {
    if (!user) return;
    setCalendarBusy(true); setError("");
    try { await disconnectGoogleCalendar(user.uid); setCalendarConnected(false); setCalendarConnection(previous => ({ ...previous, connected: false, needsReconnect: false, email: undefined })); syncAttempts.current.clear(); }
    catch (issue) { setError(issue instanceof Error ? issue.message : "Could not disconnect Google Calendar."); }
    finally { setCalendarBusy(false); }
  }
  async function retryCalendar(task: Task) {
    if (!user) return;
    setCalendarBusy(true); setError("");
    try { await syncTaskToCalendar(user.uid, task); setCalendarConnected(true); }
    catch (issue) { setError(issue instanceof Error ? issue.message : "Could not add the task to Google Calendar."); }
    finally { setCalendarBusy(false); }
  }
  async function removeTask(task: Task) {
    if (!user) return;
    setSaving(true); setError("");
    try {
      await removeTaskFromCalendar(user.uid, task);
      await changeData(user.uid, "DELETE", { collection: "tasks", id: task.id });
    } catch (issue) { setError(`Task was not deleted. ${issue instanceof Error ? issue.message : "Please try again."}`); }
    finally { setSaving(false); }
  }
  function openTransactionForm(entry?: Transaction) {
    setError("");
    setEditingTransaction(entry || null);
    setKind(entry?.kind || "expense");
    setAmount(entry ? String(entry.amount / 100) : "");
    setCategory(entry?.category || "Food & drink");
    setDescription(entry?.description || "");
    setEntryDate(entry?.date || dateKey());
    setTransactionProjectId(entry?.projectId || "");
    setForm("transaction");
  }
  async function addTransaction(e: React.FormEvent) {
    e.preventDefault();
    if (await send(editingTransaction ? "PATCH" : "POST", { collection: "transactions", id: editingTransaction?.id, kind, amount, category, description, date: entryDate, projectId: kind === "expense" ? transactionProjectId : "" })) {
      setAmount(""); setDescription(""); setEditingTransaction(null); setForm(null);
    }
  }
  async function removeTransaction(entry: Transaction) {
    if (entry.billId && !window.confirm("Remove this bill and its linked expense from Daylight? The original file will stay in Google Drive.")) return;
    if (!entry.billId && !window.confirm("Delete this money entry?")) return;
    await send("DELETE", { collection: "transactions", id: entry.id, billId: entry.billId });
  }
  function openPostForm(post?: Post) { setEditingPost(post || null); setPlatform(post?.platform || "Instagram"); setPostTitle(post?.title || ""); setPostCaption(post?.caption || ""); setPostDate(post?.scheduledAt ? localKey(new Date(post.scheduledAt)) + "T" + new Date(post.scheduledAt).toTimeString().slice(0, 5) : ""); setForm("post"); }
  async function addPost(e: React.FormEvent) { e.preventDefault(); if (await send(editingPost ? "PATCH" : "POST", { collection: "posts", id: editingPost?.id, platform, title: postTitle, caption: postCaption, scheduledAt: postDate ? new Date(postDate).toISOString() : null })) { setPostTitle(""); setPostCaption(""); setPostDate(""); setEditingPost(null); setForm(null); } }
  if (!authReady) return <div className="auth-screen"><div className="auth-card"><Brand/><div className="loading-line" role="status"><span className="loading-orbit"/> Opening your workspace…</div></div></div>;
  if (!hasFirebaseConfig()) return <div className="auth-screen"><div className="auth-card"><Brand/><h1>Connect your Firebase project</h1><p>Add your Firebase web app settings in Vercel, then redeploy to enable your synced dashboard.</p><a href="https://firebase.google.com/docs/web/setup" target="_blank" rel="noreferrer">Firebase setup guide <ArrowUpRight size={16}/></a></div></div>;
  if (!user) return <div className="auth-screen"><div className="auth-card"><Brand/><span className="section-kicker">YOUR PERSONAL WORKSPACE</span><h1>A little more room for your day.</h1><p>Sign in with Google to keep your tasks, spending, and content plans together across your devices.</p>{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button" onClick={() => void signIn().catch(issue => setError(issue instanceof Error ? issue.message : "Could not sign in."))}>Continue with Google <ArrowRight size={17}/></button></div></div>;
  const openTasks = orderedTasks(data.tasks.filter(t => !t.done));
  const daylightEventIds = new Set(data.tasks.map(task => task.calendarEventId).filter(Boolean));
  const visibleGoogleItems = googleItems ? { ...googleItems, events: googleItems.events.filter(item => !daylightEventIds.has(item.id)) } : null;
  const visibleMoneyTransactions = data.transactions.filter(t => t.date.startsWith(moneyMonth));
  const unconvertedProjects = unconvertedProjectPayments(data.projects);
  const visibleIncome = visibleMoneyTransactions.filter(t => t.kind === "income").reduce((sum, t) => sum + t.amount, 0);
  const visibleSpent = visibleMoneyTransactions.filter(t => t.kind === "expense").reduce((sum, t) => sum + t.amount, 0);
  const visibleCategories = Object.entries(visibleMoneyTransactions.filter(t => t.kind === "expense").reduce<Record<string, number>>((acc, t) => { acc[t.category] = (acc[t.category] || 0) + t.amount; return acc; }, {})).sort((a, b) => b[1] - a[1]);
  let categoryArcEnd = 0;
  const spendingChart = visibleSpent > 0 ? `conic-gradient(${visibleCategories.map(([, value], index) => {
    const start = categoryArcEnd;
    categoryArcEnd += value / visibleSpent * 100;
    return `${spendingColors[index % spendingColors.length]} ${start}% ${categoryArcEnd}%`;
  }).join(", ")})` : "none";
  const visibleSmall = visibleMoneyTransactions.filter(t => t.kind === "expense" && t.amount <= 200000).length;
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const nav: { label: View; icon: React.ElementType }[] = [{ label: "Overview", icon: LayoutGrid }, { label: "Projects", icon: FolderKanban }, { label: "Tasks", icon: Check }, { label: "Lectures & Meetings", icon: CalendarDays }, { label: "Money", icon: Wallet }, { label: "Content", icon: Camera }, { label: "Analytics", icon: BarChart3 }, { label: "Assistant", icon: Sparkles }, { label: "Connections", icon: CircleHelp }];
  function go(label: View) { setView(label); setMobileNav(false); setForm(null); }

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
      <Brand/>
      <div className="side-label">WORKSPACE</div>
      <nav aria-label="Main navigation">{nav.map(({ label, icon: Icon }) => <button key={label} data-section={label.toLowerCase()} className={`nav-item ${view === label ? "active" : ""}`} onClick={() => go(label)}><Icon size={18} strokeWidth={1.9} /><span>{label}</span>{view === label && <span className="active-indicator" />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-tip"><Sparkles size={17} /><p>Make room for what matters.</p><span>One clear place to plan your day.</span></div><div className="avatar-row"><div className="avatar">{(user.displayName || user.email || "D").slice(0, 1).toUpperCase()}</div><div><strong>{user.displayName || "My workspace"}</strong><small>Personal dashboard</small></div><button className="sign-out-button" onClick={() => void signOutUser().catch(issue => setError(issue instanceof Error ? issue.message : "Could not sign out."))}>Sign out</button></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><button className="mobile-menu" aria-label="Open menu" onClick={() => setMobileNav(!mobileNav)}><Menu size={22}/></button><div className="breadcrumb">Workspace <span>/</span> <strong>{view}</strong></div><div className="top-actions"><span className="today-pill"><CalendarDays size={18}/><span className="date-long">{today}</span><span className="date-short">{new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></span><NotificationCenter tasks={data.tasks} posts={data.posts} calendarItems={visibleGoogleItems ? [...visibleGoogleItems.events, ...visibleGoogleItems.tasks] : []} loading={loading || !calendarChecked || (calendarConnected && googleItemsLoading && !googleItems)} userId={user.uid} onNavigate={go}/></div></header>
      <div className="content">
        {error && <div className="error-banner" role="alert">{error}<button onClick={error.includes("Calendar") || error.includes("calendar") ? () => setError("") : refresh}>{error.includes("Calendar") || error.includes("calendar") ? "Dismiss" : "Try again"}</button></div>}
        {view === "Overview" && <OverviewDashboard data={data} loading={loading} user={user} onOpen={go} onTask={() => setForm("task")} onExpense={() => openTransactionForm()} onPost={() => openPostForm()}/>}
        {view === "Projects" && <ProjectsPanel userId={user.uid} projects={data.projects} transactions={data.transactions} loading={loading} />}
        {view === "Tasks" && <><div className="page-heading"><div><div className="eyebrow">MAKE SPACE FOR WHAT MATTERS</div><h1>Tasks<span className="period">.</span></h1><p>A clear view of everything on your list.</p></div><button className="primary-button" onClick={() => setForm("task")}><Plus size={18}/> New task</button></div><div className="two-column"><section className="card large-card"><div className="card-title-row"><h2>To do <span className="count-badge">{openTasks.length}</span></h2><span className="quiet-label">DRAG TO ORDER · PRIORITY MARKS URGENCY</span></div>{openTasks.length ? <TaskPriorityList tasks={openTasks} userId={user.uid} onError={setError} toggle={t => void send("PATCH", { collection: "tasks", id: t.id, done: true })} remove={t => void removeTask(t)} sync={t => void retryCalendar(t)} syncBusy={calendarBusy || saving} calendarConnected={calendarConnected} onConnectCalendar={() => go("Connections")} /> : <div className="empty-state"><div className="empty-icon"><Check size={22}/></div><strong>Nothing on your list</strong><p>Start with one thing you want to get done.</p></div>}</section><section className="card side-card"><span className="section-kicker">REMINDERS</span><h2>Calendar, automatically.</h2><p>Dated tasks go to Google with an alert. Your Google Tasks appear below; events are in Lectures & Meetings.</p><div className="callout-line"><CalendarDays size={17}/> {calendarConnected ? `Connected to ${calendarConnection.email || "your Google account"}` : "Connect Google Calendar once in Connections."}</div></section></div><CalendarItemsPanel connected={calendarConnected} data={visibleGoogleItems} loading={googleItemsLoading} error={googleItemsError} onRefresh={() => setGoogleItemsRevision(value => value + 1)} onConnect={() => go("Connections")} onEnableTasks={() => void enableGoogleTasks()}/>{data.tasks.some(t => t.done) && <section className="card completed-card"><h2>Completed <span className="count-badge">{data.tasks.filter(t => t.done).length}</span></h2>{data.tasks.filter(t => t.done).map(t => <TaskRow key={t.id} task={t} toggle={() => send("PATCH", { collection: "tasks", id: t.id, done: false })} remove={() => void removeTask(t)} sync={() => void retryCalendar(t)} syncBusy={calendarBusy || saving} calendarConnected={calendarConnected} onConnectCalendar={() => go("Connections")}/>)}</section>}</>}
        {view === "Lectures & Meetings" && <LecturesMeetingsPanel userId={user.uid} connected={calendarConnected} account={calendarConnection.email} data={visibleGoogleItems} loading={googleItemsLoading} error={googleItemsError} onRefresh={() => setGoogleItemsRevision(value => value + 1)} onConnect={() => go("Connections")}/>}
        {view === "Money" && <>
          <div className="page-heading money-page-heading"><div><div className="eyebrow">YOUR MONTH AT A GLANCE</div><h1>Money<span className="period">.</span></h1><p>Know what comes in, what goes out, and where it goes. Scanned bills count in their bill month.</p></div><div className="money-heading-actions"><label className="money-month-picker">Month <input type="month" value={moneyMonth} onChange={event => setMoneyMonth(event.target.value || thisMonth())} aria-label="Select money month"/></label><button className="money-bills-jump" type="button" onClick={() => document.getElementById("bills-title")?.scrollIntoView({ behavior: "smooth", block: "start" })}><ReceiptText size={16}/> Bills</button><button className="primary-button" onClick={() => openTransactionForm()}><Plus size={18}/> Add entry</button></div></div>
          <ProjectIncomeCard projects={data.projects} title="Project income" month={moneyMonth} className="money-top-projects" />
          <div className="stat-grid money-stat-grid"><div className="card stat-card income-stat"><span>INCOME</span><strong>{money(visibleIncome)}</strong><small>Selected month</small></div><div className="card stat-card expense-stat"><span>SPENDING</span><strong>{money(visibleSpent)}</strong><small>Selected month · includes bills</small></div><div className="card stat-card accent-stat"><span>LEFT OVER</span><strong>{money(visibleIncome - visibleSpent)}</strong><small>Income minus spending</small></div></div>
          {unconvertedProjects.length > 0 && <div className="money-balance-warning" role="status"><strong>LKR balance may be incomplete.</strong><span>{unconvertedProjects.length} foreign-currency project {unconvertedProjects.length === 1 ? "payment has" : "payments have"} no LKR value recorded. {unconvertedProjects.length === 1 ? "That payment is" : "Those payments are"} excluded until you enter the LKR value of what was paid.</span><button type="button" onClick={() => go("Projects")}>Review projects <ArrowRight size={14}/></button></div>}
          <MoneyReview transactions={data.transactions} bills={data.bills} projects={data.projects} month={moneyMonth} formatMoney={money} onEdit={openTransactionForm}/><div className="money-content-grid money-columns"><MoneyLedger entries={visibleMoneyTransactions} monthCount={visibleMoneyTransactions.length} busy={saving} formatMoney={money} onEdit={openTransactionForm} onDelete={entry => void removeTransaction(entry)} onOpenProject={() => go("Projects")} onAdd={() => openTransactionForm()}/><section className="card side-card spending-card"><span className="section-kicker">WHERE IT GOES</span><h2>Spending by category</h2>{visibleCategories.length ? <><div className="spending-donut" role="img" aria-label={`Spending by category: ${visibleCategories.map(([name, value]) => `${name} ${money(value)}`).join(", ")}`} style={{ background: spendingChart }}><div className="spending-donut-center"><span>TOTAL SPENT</span><strong>{money(visibleSpent)}</strong></div></div><div className="spending-legend">{visibleCategories.map(([name, value], index) => <div className="spending-legend-row" key={name}><span className="spending-legend-dot" style={{ background: spendingColors[index % spendingColors.length] }}/><span className="spending-legend-name">{name}</span><strong>{money(value)}</strong></div>)}</div></> : <p className="muted">Categories appear as you log expenses.</p>}{visibleSpent > 0 && <p className="micro-insight">{visibleSmall} smaller expenses under Rs. 2,000 in this month.</p>}</section><BillsPanel userId={user.uid} bills={data.bills} onBillSaved={setMoneyMonth} /></div>
        </>}
        {view === "Content" && <><div className="page-heading"><div><div className="eyebrow">PLAN YOUR PRESENCE</div><h1>Content<span className="period">.</span></h1><p>Keep your ideas and publishing plans in one place.</p></div><button className="primary-button" onClick={() => openPostForm()}><Plus size={18}/> New post idea</button></div><div className="platform-grid">{["Instagram", "TikTok", "Facebook"].map(p => <div className="card platform-card" key={p}><div className="platform-icon"><SocialPlatformIcon platform={p.toLowerCase() as "instagram" | "tiktok" | "facebook"} size={23}/></div><strong>{p}</strong><span>{data.posts.filter(x => x.platform === p && x.status !== "published").length} planned</span><button className="platform-connect-link" onClick={() => go("Connections")}>Manage connection →</button></div>)}</div><section className="card large-card"><div className="card-title-row"><h2>Publishing plan</h2><span className="quiet-label">IDEAS & SCHEDULE</span></div>{data.posts.length ? data.posts.map(p => <div className="content-row" key={p.id}><div className="platform-icon small">{["Instagram", "TikTok", "Facebook"].includes(p.platform) ? <SocialPlatformIcon platform={p.platform.toLowerCase() as "instagram" | "tiktok" | "facebook"} size={18}/> : <Camera size={17}/>}</div><div><strong>{p.title}</strong>{p.caption && <p className="content-caption">{p.caption}</p>}<small>{p.platform} · {p.scheduledAt ? niceDate(p.scheduledAt) : "No date set"}</small></div><span className={`status-chip ${p.status === "published" ? "published" : ""}`}>{p.status === "published" ? "Published" : p.scheduledAt ? "Planned" : "Idea"}</span><button className="mini-action" onClick={() => openPostForm(p)}>Edit plan</button><button className="mini-action" onClick={() => send("PATCH", { collection: "posts", id: p.id, status: p.status === "published" ? "idea" : "published", title: p.title, caption: p.caption || "", platform: p.platform, scheduledAt: p.scheduledAt })}>{p.status === "published" ? "Undo" : "Mark published"}</button><button className="delete-button" aria-label="Delete post" onClick={() => send("DELETE", { collection: "posts", id: p.id })}><Trash2 size={16}/></button></div>) : <div className="empty-state"><div className="empty-icon"><Camera size={22}/></div><strong>Your next post starts here</strong><p>Save an idea, platform, and planned date.</p></div>}</section><div className="fine-print">Dates and captions are planned in Daylight. Posts do not publish automatically; platform publishing approval and media upload support are still required.</div></>}
        {view === "Analytics" && <><div className="page-heading"><div><div className="eyebrow">YOUR CHANNELS, CLEARLY</div><h1>Analytics<span className="period">.</span></h1><p>Real performance from each connected account, in its own view.</p></div></div><SocialAnalytics user={user} onConnections={() => go("Connections")}/></>}
        {view === "Assistant" && <><div className="page-heading"><div><div className="eyebrow">THINK IT THROUGH</div><h1>Assistant<span className="period">.</span></h1><p>Talk through plans with the facts from your Daylight workspace.</p></div></div><AssistantPanel user={user} onNewPost={() => openPostForm()} onNewTask={() => setForm("task")}/></>}
        {view === "Connections" && <><div className="page-heading"><div><div className="eyebrow">BRING YOUR TOOLS TOGETHER</div><h1>Connections<span className="period">.</span></h1><p>Keep your accounts linked to this workspace.</p></div></div>{calendarNotice && <p className="social-message" role="alert">{calendarNotice}</p>}<div className="connections-grid"><section className="card connection-card"><div className="connection-icon"><CalendarDays size={22}/></div><h2>Google Calendar</h2><p>Dated tasks and your Lectures & Meetings sync with the connected Google Calendar. This connection follows your Daylight login across visits.</p><div className="calendar-connection-actions"><button className="subtle-button calendar-connect-button" onClick={() => void connectCalendar()} disabled={calendarBusy || !calendarChecked || (!calendarConnected && !calendarConnection.configured)}>{calendarBusy || !calendarChecked ? "Checking…" : calendarLoadFailed ? "Status unavailable" : calendarConnected ? "Sync pending tasks" : calendarConnection.needsReconnect ? "Reconnect Google Calendar" : calendarConnection.configured ? "Connect Google Calendar" : "Setup needed"} <ArrowRight size={16}/></button>{(calendarConnected || calendarConnection.needsReconnect) && <button className="social-disconnect" onClick={() => void disconnectCalendar()} disabled={calendarBusy}>Disconnect</button>}</div><span className={`connection-status ${calendarConnected ? "ready" : ""}`}>{calendarLoadFailed ? "Status unavailable" : calendarConnected ? `Connected: ${calendarConnection.email || "Google account"}` : calendarConnection.needsReconnect ? `Reconnect: ${calendarConnection.email || "Google account"}` : calendarConnection.configured ? "Choose your Google account" : "OAuth setup needed"}</span>{calendarChecked && !calendarLoadFailed && !calendarConnection.configured && <p className="fine-print">Add the Calendar OAuth credentials and shared server settings in Vercel. <a href="https://github.com/itzkumu/daylight-public/blob/main/docs/integrations.md#automatically-add-dated-tasks-to-google-calendar" target="_blank" rel="noreferrer">See setup steps ↗</a></p>}</section><section className="card connection-card"><div className="connection-icon"><Sparkles size={22}/></div><h2>AI planning</h2><p>Chat with your workspace context for content ideas, priorities, and spending patterns.</p><button className="subtle-button" onClick={() => go("Assistant")}>Open assistant <ArrowRight size={16}/></button></section></div><AgentConnection user={user}/><SocialConnections user={user}/><p className="fine-print">Connections belong to your signed-in account. Google, Meta, and TikTok may ask you to reconnect if their permissions expire or are revoked.</p></>}
      </div>
    </main>
    {form && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setForm(null); }}><div className="modal" role="dialog" aria-modal="true" aria-label={form === "transaction" && editingTransaction ? "Edit money entry" : `Add ${form}`}><div className="modal-header"><div><span className="section-kicker">QUICK ADD</span><h2>{form === "task" ? "New task" : form === "transaction" ? (editingTransaction ? "Edit money entry" : "Add money entry") : (editingPost ? "Edit post plan" : "New post idea")}</h2></div><button className="close-button" onClick={() => setForm(null)} aria-label="Close"><X size={20}/></button></div>{form === "task" ? <form onSubmit={addTask}><label>What needs doing?<input autoFocus required placeholder="e.g. Send the client proposal" value={taskTitle} onChange={e => setTaskTitle(e.target.value)}/></label><label>Date & time <span>optional · needed for Google Calendar</span><input type="datetime-local" value={taskDue} onChange={e => setTaskDue(e.target.value)}/></label><label>Priority<select value={taskPriority} onChange={e => setTaskPriority(e.target.value as Priority)}><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label><label>Notes <span>optional</span><textarea placeholder="Anything you want to remember" value={taskNotes} onChange={e => setTaskNotes(e.target.value)}/></label>{error && <p className="task-form-error" role="alert">{error}</p>}<button className="primary-button form-submit" disabled={saving}>Add task <ArrowRight size={17}/></button></form> : form === "transaction" ? <form onSubmit={addTransaction}><div className="segmented"><button type="button" className={kind === "expense" ? "selected" : ""} onClick={() => { setKind("expense"); setCategory("Food & drink"); }}>Expense</button><button type="button" className={kind === "income" ? "selected" : ""} disabled={Boolean(editingTransaction?.billId)} onClick={() => { setKind("income"); setCategory("Work"); }}>Income</button></div><label>Amount (LKR)<input autoFocus type="number" min="0.01" step="0.01" required placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)}/></label><label>Category<select value={category} onChange={e => setCategory(e.target.value)}>{(kind === "expense" ? ["Food & drink", "Transport", "Shopping", "Bills", "Subscriptions", "Health", "Other"] : ["Work", "Business", "Gift", "Other"]).map(x => <option key={x}>{x}</option>)}</select></label>{kind === "expense" && <label>Project <span>optional · also shows in Projects</span><select value={transactionProjectId} onChange={e => setTransactionProjectId(e.target.value)}><option value="">No project</option>{data.projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>}<label>Description <span>optional</span><input placeholder="e.g. Morning coffee" value={description} onChange={e => setDescription(e.target.value)}/></label><label>Date<input type="date" required value={entryDate} onChange={e => setEntryDate(e.target.value)}/></label>{error && <p className="task-form-error" role="alert">{error}</p>}<button className="primary-button form-submit" disabled={saving}>{editingTransaction ? "Save changes" : "Save entry"} <ArrowRight size={17}/></button></form> : <form onSubmit={addPost}><label>Post idea<input autoFocus required placeholder="e.g. Behind the scenes reel" value={postTitle} onChange={e => setPostTitle(e.target.value)}/></label><label>Caption / notes <span>optional</span><textarea value={postCaption} onChange={e => setPostCaption(e.target.value)} maxLength={2200} rows={4} placeholder="Write a caption or draft notes"/></label><label>Platform<select value={platform} onChange={e => setPlatform(e.target.value)}>{["Instagram", "TikTok", "Facebook"].map(x => <option key={x}>{x}</option>)}</select></label><label>Planned date <span>optional</span><input type="datetime-local" value={postDate} onChange={e => setPostDate(e.target.value)}/></label><button className="primary-button form-submit" disabled={saving}>{editingPost ? "Save plan" : "Save idea"} <ArrowRight size={17}/></button></form>}</div></div>}
  </div>;
}

function TaskPriorityList({ tasks, userId, onError, toggle, remove, sync, syncBusy, calendarConnected, onConnectCalendar }: { tasks: Task[]; userId: string; onError: (message: string) => void; toggle: (task: Task) => void; remove: (task: Task) => void; sync: (task: Task) => void; syncBusy: boolean; calendarConnected: boolean; onConnectCalendar: () => void }) {
  const order = usePersistedOrder(tasks, ids => reorderItems(userId, "tasks", ids), onError);
  return <div className="task-list priority-list">{order.items.map(task => <TaskRow key={task.id} task={task} toggle={() => toggle(task)} remove={() => remove(task)} sync={() => sync(task)} syncBusy={syncBusy} calendarConnected={calendarConnected} onConnectCalendar={onConnectCalendar} dragHandle={order.bind(task.id)} dragged={order.draggedId === task.id} dropTarget={order.targetId === task.id && order.draggedId !== task.id} onPriority={priority => void setItemPriority(userId, "tasks", task.id, priority).catch(issue => onError(issue instanceof Error ? issue.message : "Could not update priority."))} />)}</div>;
}

function TaskRow({ task, toggle, remove, sync, syncBusy = false, calendarConnected = false, onConnectCalendar, compact = false, dragHandle, dragged = false, dropTarget = false, onPriority }: { task: Task; toggle: () => void; remove?: () => void; sync?: () => void; syncBusy?: boolean; calendarConnected?: boolean; onConnectCalendar?: () => void; compact?: boolean; dragHandle?: React.ComponentProps<"button">; dragged?: boolean; dropTarget?: boolean; onPriority?: (priority: Priority) => void }) {
  return <div data-sort-id={dragHandle ? task.id : undefined} className={`task-row ${task.done ? "task-done" : ""} ${dragged ? "sort-dragged" : ""} ${dropTarget ? "sort-target" : ""}`}>
    {dragHandle && <button type="button" className="sort-handle" aria-label={`Move ${task.title}; drag or press up and down arrow keys`} title="Drag to reorder · arrow keys also work" {...dragHandle}><GripVertical size={17}/></button>}
    <button className="task-check" aria-label={task.done ? "Mark task incomplete" : "Complete task"} onClick={toggle}>{task.done && <Check size={14}/>}</button>
    <div className="task-main"><strong>{task.title}</strong><div className="task-meta">{task.dueAt ? <><Clock3 size={13}/><span>{new Date(task.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {new Date(task.dueAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span></> : <span>No due date</span>}{task.notes && !compact && <span className="note-preview">· {task.notes}</span>}</div></div>
    {task.dueAt && <div className="calendar-actions">{task.calendarEventId && calendarConnected ? <span className="calendar-synced"><CalendarDays size={13}/> In Calendar</span> : calendarConnected ? <button onClick={sync} disabled={!sync || syncBusy} aria-label={`Retry Google Calendar sync for ${task.title}`}>Retry calendar sync</button> : <button onClick={onConnectCalendar} disabled={!onConnectCalendar}>Connect Calendar</button>}<button onClick={() => downloadCalendar(task)} title="Download calendar event">Calendar file</button></div>}
    {onPriority && <label className={`priority-select priority-${task.priority || "normal"}`}><span className="sr-only">Priority for {task.title}</span><select aria-label={`Priority for ${task.title}`} value={task.priority || "normal"} onChange={event => onPriority(event.target.value as Priority)}><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label>}
    {remove && <button className="delete-button" aria-label={`Delete ${task.title}`} onClick={remove}><Trash2 size={16}/></button>}
  </div>;
}
