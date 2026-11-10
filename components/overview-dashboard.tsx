"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { ArrowRight, ArrowUpRight, Camera, Check, Clock3, FolderKanban, Plus, TrendingDown, Wallet } from "lucide-react";
import type { Data, Project } from "../lib/firebase-data";
import { connectionResponse } from "../lib/connection-response";
import { unconvertedProjectPayments } from "../lib/project-income";
import SocialPlatformIcon from "./social-platform-icon";

type Destination = "Projects" | "Tasks" | "Money" | "Content" | "Analytics" | "Connections";
type AudienceResult = { status: "setup" | "disconnected" | "expired" | "connected"; metrics?: { label: string; value: number }[] };
const cash = (cents: number) => new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR", maximumFractionDigits: 0 }).format(cents / 100);
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const localKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dateText = (value: string) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const projectDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const chartColors = ["#b8fb60", "#53cec4", "#74aaf0", "#eda984", "#b9a1ef", "#f4d481"];

function Audience({ user, onOpen }: { user: User; onOpen: (destination: Destination) => void }) {
  const [results, setResults] = useState<Record<string, AudienceResult | null>>({ instagram: null, tiktok: null });
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    user.getIdToken().then(async token => {
      const entries = await Promise.allSettled((["instagram", "tiktok"] as const).map(async platform => {
        const response = await fetch(`/api/social/analytics?platform=${platform}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        return [platform, await connectionResponse<AudienceResult>(response, "Could not load audience data")] as const;
      }));
      if (!active) return;
      setResults(Object.fromEntries(entries.filter(entry => entry.status === "fulfilled").map(entry => entry.value)));
      setFailed(entries.some(entry => entry.status === "rejected"));
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [user]);
  return <section className="card ov-card ov-audience" aria-labelledby="ov-audience-title">
    <div className="ov-card-head"><div className="ov-section-name"><span className="ov-icon ov-icon-audience"><SocialPlatformIcon platform="instagram" size={18}/></span><div><span className="section-kicker">AUDIENCE</span><h2 id="ov-audience-title">Social pulse</h2></div></div><button className="ov-open" onClick={() => onOpen("Analytics")} aria-label="Open social analytics"><ArrowUpRight size={18}/></button></div>
    <div className="ov-audience-grid">{(["instagram", "tiktok"] as const).map(platform => {
      const result = results[platform];
      const followers = result?.metrics?.find(metric => metric.label.toLowerCase() === "followers")?.value;
      return <div className="ov-audience-channel" key={platform}><SocialPlatformIcon platform={platform} size={27}/><div><span>{platform === "instagram" ? "Instagram" : "TikTok"}</span><strong>{result?.status === "connected" && typeof followers === "number" ? compact.format(followers) : "—"}</strong><small>{result?.status === "connected" ? typeof followers === "number" ? "followers" : "Count unavailable" : result?.status === "expired" ? "Reconnect needed" : result?.status === "setup" ? "Setup needed" : result?.status === "disconnected" ? "Not connected" : failed ? "Unavailable" : "Checking…"}</small></div></div>;
    })}</div>
    <button className="ov-inline-link" onClick={() => onOpen("Connections")}>Manage connections <ArrowRight size={15}/></button>
  </section>;
}

export default function OverviewDashboard({ data, loading, user, onOpen, onTask, onExpense, onPost }: { data: Data; loading: boolean; user: User; onOpen: (destination: Destination) => void; onTask: () => void; onExpense: () => void; onPost: () => void }) {
  const now = new Date();
  const today = localKey(now);
  const weekEnd = new Date(now); weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndKey = localKey(weekEnd);
  const openTasks = data.tasks.filter(task => !task.done);
  const overdueTasks = openTasks.filter(task => task.dueAt && localKey(new Date(task.dueAt)) < today).sort((a, b) => (a.dueAt || "").localeCompare(b.dueAt || ""));
  const nextTasks = openTasks.filter(task => !task.dueAt || localKey(new Date(task.dueAt)) >= today).sort((a, b) => (a.dueAt || "9999").localeCompare(b.dueAt || "9999"));
  const weekTasks = nextTasks.filter(task => task.dueAt && localKey(new Date(task.dueAt)) <= weekEndKey);
  const activeProjects = data.projects.filter(project => project.status === "ongoing");
  const upcomingProjects = data.projects.filter(project => project.status === "upcoming");
  const overdueProjects = [...activeProjects, ...upcomingProjects].filter(project => project.targetDate && project.targetDate < today).sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  const dueSoonProjects = [...activeProjects, ...upcomingProjects].filter(project => project.targetDate && project.targetDate >= today && project.targetDate <= weekEndKey).sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  const focusProjects = [...overdueProjects, ...dueSoonProjects, ...activeProjects.filter(project => !project.targetDate || project.targetDate > weekEndKey), ...upcomingProjects.filter(project => !project.targetDate || project.targetDate > weekEndKey)].filter((project, index, all) => all.findIndex(item => item.id === project.id) === index).slice(0, 3);
  const month = today.slice(0, 7);
  const monthEntries = data.transactions.filter(entry => entry.date.startsWith(month));
  const income = monthEntries.filter(entry => entry.kind === "income").reduce((sum, entry) => sum + entry.amount, 0);
  const spent = monthEntries.filter(entry => entry.kind === "expense").reduce((sum, entry) => sum + entry.amount, 0);
  const unconvertedCount = unconvertedProjectPayments(data.projects).length;
  const smallEntries = monthEntries.filter(entry => entry.kind === "expense" && entry.amount <= 200000);
  const smallTotal = smallEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const categories = Object.entries(monthEntries.filter(entry => entry.kind === "expense").reduce<Record<string, number>>((totals, entry) => { totals[entry.category] = (totals[entry.category] || 0) + entry.amount; return totals; }, {})).sort((a, b) => b[1] - a[1]);
  let chartOffset = 0;
  const segments = categories.map(([, amount], index) => { const start = chartOffset; chartOffset += amount / spent * 100; return `${chartColors[index % chartColors.length]} ${start}% ${chartOffset}%`; });
  const chart = spent ? `conic-gradient(${segments.join(", ")})` : "conic-gradient(#35424a 0 100%)";
  const queue = data.posts.filter(post => post.status !== "published").sort((a, b) => (a.scheduledAt || "9999").localeCompare(b.scheduledAt || "9999"));
  const latePosts = queue.filter(post => post.scheduledAt && new Date(post.scheduledAt) < now);
  const nextPost = queue.find(post => post.scheduledAt && new Date(post.scheduledAt) >= now);
  const attention = overdueTasks.length + overdueProjects.length + latePosts.length;
  const firstName = user.displayName?.split(" ")[0];
  const projectLabel = (project: Project) => project.targetDate ? `${project.targetDate < today ? "Overdue" : "Due"} ${projectDate(project.targetDate)}` : project.status === "ongoing" ? "In progress" : "Upcoming";

  if (loading) return <div className="ov-dashboard" role="status" aria-label="Loading workspace overview"><div className="dashboard-heading ov-heading"><div><div className="eyebrow">YOUR WORKSPACE · AT A GLANCE</div><h1>Your day, in focus<span className="period">.</span></h1><p>Gathering your projects, tasks, money, and content…</p></div></div><div className="ov-stats">{["Tasks", "Projects", "Money", "Content"].map(label => <div className="card ov-stat ov-loading" key={label}><span className="ov-stat-label">{label.toUpperCase()}</span><span className="ov-loading-line"/><span className="ov-loading-line short"/></div>)}</div><div className="ov-grid"><div className="card ov-card ov-attention ov-loading"><span className="ov-loading-line"/><span className="ov-loading-line short"/></div><div className="card ov-card ov-projects ov-loading"><span className="ov-loading-line"/><span className="ov-loading-line short"/></div></div></div>;

  return <div className="ov-dashboard">
    <div className="dashboard-heading ov-heading"><div><div className="eyebrow">YOUR WORKSPACE · AT A GLANCE</div><h1>{firstName ? `Good to see you, ${firstName}` : "Your day, in focus"}<span className="period">.</span></h1><p>{loading ? "Gathering your workspace…" : attention ? `${attention} item${attention === 1 ? "" : "s"} need your attention. Start with what is overdue.` : "You’re all caught up on deadlines. Here’s what’s moving next."}</p></div><button className="primary-button" onClick={onTask}><Plus size={18}/> Add task</button></div>

    <div className="ov-stats" aria-label="Workspace snapshot">
      <button className="card ov-stat" onClick={() => onOpen("Tasks")}><span className="ov-icon ov-icon-tasks"><Clock3 size={19}/></span><span className="ov-stat-label">OVERDUE TASKS</span><strong>{loading ? "—" : overdueTasks.length}</strong><small>{overdueTasks.length ? "Need a new plan" : "Nothing overdue"}</small></button>
      <button className="card ov-stat" onClick={() => onOpen("Projects")}><span className="ov-icon ov-icon-projects"><FolderKanban size={19}/></span><span className="ov-stat-label">ACTIVE PROJECTS</span><strong>{loading ? "—" : activeProjects.length}</strong><small>{upcomingProjects.length} coming up</small></button>
      <button className="card ov-stat" onClick={() => onOpen("Money")}><span className="ov-icon ov-icon-money"><Wallet size={19}/></span><span className="ov-stat-label">SPENT THIS MONTH</span><strong>{loading ? "—" : cash(spent)}</strong><small>{unconvertedCount ? "Foreign project payment missing LKR value" : income ? `${Math.round(spent / income * 100)}% of income` : "No income recorded"}</small></button>
      <button className="card ov-stat" onClick={() => onOpen("Content")}><span className="ov-icon ov-icon-content"><Camera size={19}/></span><span className="ov-stat-label">CONTENT QUEUE</span><strong>{loading ? "—" : queue.length}</strong><small>{latePosts.length ? `${latePosts.length} past schedule` : "Ideas and planned posts"}</small></button>
    </div>

    <div className="ov-grid">
      <section className="card ov-card ov-attention" aria-labelledby="ov-attention-title"><div className="ov-card-head"><div className="ov-section-name"><span className="ov-icon ov-icon-attention"><Clock3 size={19}/></span><div><span className="section-kicker">FIRST UP</span><h2 id="ov-attention-title">Needs attention</h2></div></div><span className="ov-count">{attention}</span></div>
        {loading ? <p className="ov-muted">Loading your deadlines…</p> : attention ? <div className="ov-rows">{overdueProjects.slice(0, 2).map(project => <button className="ov-row" key={project.id} onClick={() => onOpen("Projects")}><span className="ov-row-mark ov-row-project"><FolderKanban size={16}/></span><span><strong>{project.title}</strong><small>Project · target {projectDate(project.targetDate)}</small></span><span className="ov-late">Overdue</span></button>)}{overdueTasks.slice(0, 3).map(task => <button className="ov-row" key={task.id} onClick={() => onOpen("Tasks")}><span className="ov-row-mark ov-row-task"><Check size={16}/></span><span><strong>{task.title}</strong><small>Task · due {dateText(task.dueAt!)}</small></span><span className="ov-late">Overdue</span></button>)}{latePosts.slice(0, 1).map(post => <button className="ov-row" key={post.id} onClick={() => onOpen("Content")}><span className="ov-row-mark ov-row-content"><Camera size={16}/></span><span><strong>{post.title}</strong><small>{post.platform} · planned {dateText(post.scheduledAt!)}</small></span><span className="ov-late">Past plan</span></button>)}</div> : <div className="ov-empty"><Check size={23}/><strong>Nothing overdue</strong><span>Your next steps are ready below.</span></div>}
        {!loading && (weekTasks.length > 0 || dueSoonProjects.length > 0) && <div className="ov-soon"><span className="section-kicker">NEXT 7 DAYS</span><div className="ov-rows">{dueSoonProjects.slice(0, 1).map(project => <button className="ov-row" key={project.id} onClick={() => onOpen("Projects")}><span className="ov-row-mark ov-row-project"><FolderKanban size={16}/></span><span><strong>{project.title}</strong><small>Project target · {projectDate(project.targetDate)}</small></span></button>)}{weekTasks.slice(0, 2).map(task => <button className="ov-row" key={task.id} onClick={() => onOpen("Tasks")}><span className="ov-row-mark ov-row-task"><Check size={16}/></span><span><strong>{task.title}</strong><small>Task · {dateText(task.dueAt!)}</small></span></button>)}</div></div>}
      </section>

      <section className="card ov-card ov-projects" aria-labelledby="ov-projects-title"><div className="ov-card-head"><div className="ov-section-name"><span className="ov-icon ov-icon-projects"><FolderKanban size={19}/></span><div><span className="section-kicker">PROJECTS</span><h2 id="ov-projects-title">In motion</h2></div></div><button className="ov-open" onClick={() => onOpen("Projects")} aria-label="Open projects"><ArrowUpRight size={18}/></button></div>
        {loading ? <p className="ov-muted">Loading projects…</p> : focusProjects.length ? <div className="ov-project-list">{focusProjects.map(project => <button className="ov-project-item" key={project.id} onClick={() => onOpen("Projects")}><span className={`ov-stage ${project.status}`}>{project.status === "ongoing" ? "Ongoing" : "Upcoming"}</span><strong>{project.title}</strong><small>{project.nextStep || project.summary || "Open project details"}</small><em>{projectLabel(project)}</em></button>)}</div> : <div className="ov-empty ov-project-empty"><FolderKanban size={23}/><strong>No projects yet</strong><span>Keep goals and next steps together in Projects.</span><button onClick={() => onOpen("Projects")}>Create a project <ArrowRight size={14}/></button></div>}
        {!!focusProjects.length && <div className="ov-card-foot"><span>{upcomingProjects.length} upcoming · {data.projects.filter(project => project.status === "done").length} done</span><button onClick={() => onOpen("Projects")}>All projects <ArrowRight size={14}/></button></div>}
      </section>

      <section className="card ov-card ov-money" aria-labelledby="ov-money-title"><div className="ov-card-head"><div className="ov-section-name"><span className="ov-icon ov-icon-money"><Wallet size={19}/></span><div><span className="section-kicker">MONEY · THIS MONTH</span><h2 id="ov-money-title">Where it goes</h2></div></div><button className="ov-open" onClick={() => onOpen("Money")} aria-label="Open money"><ArrowUpRight size={18}/></button></div>
        <div className="ov-money-main"><div className="ov-donut" style={{ background: chart }} role="img" aria-label={spent ? `Spending by category: ${categories.map(([name, amount]) => `${name} ${cash(amount)}`).join(", ")}` : "No expenses recorded this month"}><div><span>SPENT</span><strong>{cash(spent)}</strong></div></div><div className="ov-money-numbers"><div><span>Income</span><strong>{cash(income)}</strong></div><div><span>Expenses</span><strong>{cash(spent)}</strong></div><div><span>Remaining</span><strong className={income - spent < 0 ? "ov-negative" : ""}>{cash(income - spent)}</strong></div></div></div>
        {unconvertedCount > 0 && <p className="ov-fx-warning">LKR income may be incomplete: {unconvertedCount} foreign project {unconvertedCount === 1 ? "payment needs its" : "payments need their"} LKR value. Review {unconvertedCount === 1 ? "it" : "them"} in Projects.</p>}
        {categories.length ? <div className="ov-legend">{categories.slice(0, 3).map(([name, amount], index) => <div key={name}><i style={{ background: chartColors[index] }}/><span>{name}</span><strong>{Math.round(amount / spent * 100)}%</strong></div>)}</div> : <p className="ov-muted">Your expense categories appear here as you record entries.</p>}
        <div className="ov-card-foot"><span><TrendingDown size={14}/> {smallEntries.length} small expenses · {cash(smallTotal)}</span><button onClick={onExpense}>Add entry <Plus size={14}/></button></div>
      </section>

      <section className="card ov-card ov-next" aria-labelledby="ov-next-title"><div className="ov-card-head"><div className="ov-section-name"><span className="ov-icon ov-icon-tasks"><Check size={19}/></span><div><span className="section-kicker">TASKS</span><h2 id="ov-next-title">Coming up</h2></div></div><button className="ov-open" onClick={() => onOpen("Tasks")} aria-label="Open tasks"><ArrowUpRight size={18}/></button></div>
        {nextTasks.length ? <div className="ov-rows">{nextTasks.slice(0, 4).map(task => <button className="ov-row" key={task.id} onClick={() => onOpen("Tasks")}><span className="ov-row-mark ov-row-task"><Check size={16}/></span><span><strong>{task.title}</strong><small>{task.dueAt ? localKey(new Date(task.dueAt)) === today ? "Today" : dateText(task.dueAt) : "No due date"}</small></span><ArrowRight size={15}/></button>)}</div> : <div className="ov-empty"><Check size={23}/><strong>Clear runway</strong><span>Add a task when something needs doing.</span></div>}
        <div className="ov-card-foot"><span>{openTasks.length} open · {overdueTasks.length} overdue</span><button onClick={onTask}>Add task <Plus size={14}/></button></div>
      </section>

      <section className="card ov-card ov-content" aria-labelledby="ov-content-title"><div className="ov-card-head"><div className="ov-section-name"><span className="ov-icon ov-icon-content"><Camera size={19}/></span><div><span className="section-kicker">CONTENT</span><h2 id="ov-content-title">Publishing plan</h2></div></div><button className="ov-open" onClick={() => onOpen("Content")} aria-label="Open content plan"><ArrowUpRight size={18}/></button></div>
        <div className="ov-content-summary"><strong>{queue.length}</strong><span>in your queue</span><small>{latePosts.length ? `${latePosts.length} past planned time` : nextPost?.scheduledAt ? `Next: ${dateText(nextPost.scheduledAt)}` : "Nothing scheduled yet"}</small></div>
        {queue.length ? <div className="ov-rows">{queue.slice(0, 2).map(post => <button className="ov-row" key={post.id} onClick={() => onOpen("Content")}><span className="ov-row-mark ov-row-content">{post.platform.toLowerCase() === "instagram" || post.platform.toLowerCase() === "tiktok" || post.platform.toLowerCase() === "facebook" ? <SocialPlatformIcon platform={post.platform.toLowerCase() as "instagram" | "tiktok" | "facebook"} size={17}/> : <Camera size={16}/>}</span><span><strong>{post.title}</strong><small>{post.platform} · {post.scheduledAt ? dateText(post.scheduledAt) : "Idea"}</small></span></button>)}</div> : <p className="ov-muted">Capture your next post idea to start a plan.</p>}
        <div className="ov-card-foot"><span>{data.posts.filter(post => post.status === "published").length} marked published</span><button onClick={onPost}>New idea <Plus size={14}/></button></div>
      </section>

      <Audience user={user} onOpen={onOpen}/>
    </div>
  </div>;
}
