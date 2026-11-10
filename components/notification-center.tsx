"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, CalendarDays, Check, Clock3, X } from "lucide-react";
import type { CalendarItem } from "../lib/google-calendar";

type Task = { id: string; title: string; dueAt: string | null; done: boolean };
type Post = { id: string; title: string; platform: string; scheduledAt: string | null; status: string };
type Notice = { id: string; title: string; detail: string; kind: "overdue" | "today" | "upcoming" | "post" | "calendar"; destination: "Tasks" | "Lectures & Meetings" | "Content"; time: number };

function noticesFor(tasks: Task[], posts: Post[], calendarItems: CalendarItem[]): Notice[] {
  const now = Date.now();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const horizon = new Date(today); horizon.setDate(horizon.getDate() + 7);
  const taskNotices = tasks.filter(task => !task.done && task.dueAt).map((task): Notice | null => {
    const time = new Date(task.dueAt!).getTime();
    if (!Number.isFinite(time) || time >= horizon.getTime()) return null;
    const kind = time < now ? "overdue" : time < tomorrow.getTime() ? "today" : "upcoming";
    const detail = kind === "overdue" ? "Overdue task" : kind === "today" ? `Due today · ${new Date(time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : `Due ${new Date(time).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`;
    return { id: `task-${task.id}`, title: task.title, detail, kind, destination: "Tasks" as const, time };
  }).filter((item): item is Notice => item !== null);
  const postNotices = posts.filter(post => post.status !== "published" && post.scheduledAt).map((post): Notice | null => {
    const time = new Date(post.scheduledAt!).getTime();
    if (!Number.isFinite(time) || time >= horizon.getTime()) return null;
    const detail = time < now ? `${post.platform} · planned earlier` : `${post.platform} · ${new Date(time).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`;
    return { id: `post-${post.id}`, title: post.title, detail, kind: "post" as const, destination: "Content" as const, time };
  }).filter((item): item is Notice => item !== null);
  const googleNotices = calendarItems.map((item): Notice | null => {
    if (!item.date) return null;
    const time = new Date(item.allDay ? `${item.date.slice(0, 10)}T09:00:00` : item.date).getTime();
    if (!Number.isFinite(time) || time >= horizon.getTime() || (item.kind === "event" && time < today.getTime())) return null;
    const day = new Date(time).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const label = item.kind === "task" ? "Google task" : item.eventType === "meeting" ? "Meeting" : item.eventType === "lecture" ? "Lecture" : "Calendar event";
    const detail = time < today.getTime() ? `${label} · overdue` : item.allDay ? `${label} · ${day}` : `${label} · ${day} at ${new Date(time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
    return { id: `google-${item.kind}-${item.id}`, title: item.title, detail, kind: "calendar", destination: item.kind === "event" ? "Lectures & Meetings" : "Tasks", time };
  }).filter((item): item is Notice => item !== null);
  return [...taskNotices, ...googleNotices, ...postNotices].sort((a, b) => a.time - b.time);
}

export default function NotificationCenter({ tasks, posts, calendarItems, loading, userId, onNavigate }: { tasks: Task[]; posts: Post[]; calendarItems: CalendarItem[]; loading: boolean; userId: string; onNavigate: (destination: "Tasks" | "Lectures & Meetings" | "Content") => void }) {
  const [open, setOpen] = useState(false);
  const shownFor = useRef<string | null>(null);
  const items = noticesFor(tasks, posts, calendarItems);
  useEffect(() => {
    if (loading || !items.length || shownFor.current === userId) return;
    shownFor.current = userId;
    const timer = window.setTimeout(() => setOpen(true), 420);
    return () => window.clearTimeout(timer);
  }, [loading, items.length, userId]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  return <div className="notification-center">
    <button type="button" className={`notification-trigger ${items.length ? "has-notices" : ""}`} aria-label={`Notifications${items.length ? `, ${items.length} items` : ""}`} aria-expanded={open} onClick={() => setOpen(value => !value)}><Bell size={19}/>{items.length > 0 && <span className="notification-badge">{items.length > 9 ? "9+" : items.length}</span>}</button>
    {open && <div className="notification-popover" role="dialog" aria-label="Your reminders">
      <div className="notification-header"><div><span className="section-kicker">GOOD TO KNOW</span><h2>Your reminders <span>{items.length}</span></h2></div><button type="button" aria-label="Close reminders" onClick={() => setOpen(false)}><X size={17}/></button></div>
      {items.length ? <div className="notification-list">{items.slice(0, 8).map(item => <button key={item.id} type="button" className={`notification-item ${item.kind}`} onClick={() => { onNavigate(item.destination); setOpen(false); }}><span className="notification-item-icon">{item.kind === "post" ? <CalendarDays size={16}/> : <Clock3 size={16}/>}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span></button>)}</div> : <div className="notification-clear"><Check size={20}/><strong>All caught up</strong><p>Tasks and planned posts due soon will appear here.</p></div>}
      {items.length > 8 && <p className="notification-more">And {items.length - 8} more in your lists.</p>}
    </div>}
  </div>;
}
