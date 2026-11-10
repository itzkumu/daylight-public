"use client";

import { ArrowUpRight, CalendarDays, RefreshCw } from "lucide-react";
import type { CalendarItem, CalendarItems } from "../lib/google-calendar";

function when(item: CalendarItem) {
  if (!item.date) return "No date";
  if (item.allDay) return `${new Date(`${item.date.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${item.kind === "task" ? "Date only" : "All day"}`;
  const date = new Date(item.date);
  return date.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function safeGoogleLink(value: string, kind: CalendarItem["kind"]) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && (url.hostname === "google.com" || url.hostname.endsWith(".google.com"))) return url.toString();
  } catch { /* Use the Google home page below. */ }
  return kind === "task" ? "https://tasks.google.com/" : "https://calendar.google.com/";
}

function ItemRow({ item }: { item: CalendarItem }) {
  return <a className="google-item-row" href={safeGoogleLink(item.url, item.kind)} target="_blank" rel="noreferrer">
    <span className={`google-item-mark ${item.kind}`}><CalendarDays size={17}/></span>
    <span className="google-item-copy"><strong>{item.title}</strong><small>{when(item)}{item.listName ? ` · ${item.listName}` : ""}{item.reminder && item.kind === "event" ? " · Reminder set" : ""}</small>{item.notes && <small className="google-item-note">{item.notes.slice(0, 130)}</small>}</span>
    <ArrowUpRight size={16} aria-hidden="true"/>
  </a>;
}

export default function CalendarItemsPanel({ connected, data, loading, error, onRefresh, onConnect, onEnableTasks }: { connected: boolean; data: CalendarItems | null; loading: boolean; error: string; onRefresh: () => void; onConnect: () => void; onEnableTasks: () => void }) {
  return <section className="card google-items-card" aria-label="Google Tasks">
    <div className="google-items-head"><div><span className="section-kicker">FROM YOUR GOOGLE ACCOUNT</span><h2>Google Tasks <span className="count-badge">{data?.tasks.length || 0}</span></h2><p>Open Google Tasks and reminders appear alongside your Daylight tasks.</p></div>{connected && <button className="subtle-button" onClick={onRefresh} disabled={loading} aria-label="Refresh Google Tasks"><RefreshCw size={15}/> Refresh</button>}</div>
    {!connected ? <div className="google-items-state"><p>Connect Google Calendar to see Google Tasks here.</p><button className="subtle-button" onClick={onConnect}>Go to Connections <ArrowUpRight size={15}/></button></div>
      : loading && !data ? <div className="google-items-state" role="status">Loading your Google items…</div>
      : error && !data ? <div className="google-items-state" role="alert"><p>{error}</p><button className="subtle-button" onClick={onRefresh}>Try again <RefreshCw size={15}/></button></div>
      : <div className="google-items-groups">
        {error && <p className="google-items-error" role="alert">Could not refresh: {error}</p>}
        <div className="google-items-group"><h3>Google Tasks <span>{data?.tasks.length || 0}</span></h3>{!data?.tasksEnabled ? <div className="google-items-permission"><p>To see tasks and reminders created in Google Calendar, allow read-only Google Tasks access.</p><button className="subtle-button" onClick={onEnableTasks}>Include Google Tasks <ArrowUpRight size={15}/></button></div> : data.tasksError ? <div className="google-items-permission" role="alert"><p>{data.tasksError}</p><button className="subtle-button" onClick={onRefresh}>Try again <RefreshCw size={15}/></button></div> : data.tasks.length ? data.tasks.map(item => <ItemRow key={item.id} item={item}/>) : <p className="google-items-empty">No open Google Tasks in this period.</p>}</div>
      </div>}
    {connected && <p className="google-items-footnote">Google Tasks open in Google for changes. Calendar events are in Lectures &amp; Meetings. Google Tasks shares dates, but not exact reminder times, through its API.</p>}
  </section>;
}
