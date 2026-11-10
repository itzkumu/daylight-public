"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, ArrowUpRight, CalendarDays, Clock3, MapPin, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { calendarEventInput, type DaylightEventType } from "../lib/calendar-event";
import { createEventInCalendar, deleteEventFromCalendar, updateEventInCalendar, type CalendarItem, type CalendarItems } from "../lib/google-calendar";

type Draft = { title: string; type: DaylightEventType; start: string; end: string; location: string; notes: string; reminderMinutes: string };
type Filter = "all" | DaylightEventType;

function localInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function newDraft(): Draft {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  return { title: "", type: "meeting", start: localInput(start), end: localInput(new Date(start.getTime() + 60 * 60_000)), location: "", notes: "", reminderMinutes: "30" };
}

function editDraft(item: CalendarItem): Draft {
  const start = new Date(item.date || Date.now());
  const end = new Date(item.end || start.getTime() + 60 * 60_000);
  const minutes = item.reminderMinutes;
  return { title: item.title, type: item.eventType || "event", start: localInput(start), end: localInput(end), location: item.location || "", notes: item.notes || "", reminderMinutes: minutes === 10 || minutes === 30 || minutes === 60 ? String(minutes) : item.reminder ? "30" : "0" };
}

function eventTime(item: CalendarItem) {
  if (!item.date) return "Time unavailable";
  if (item.allDay) return "All day";
  const start = new Date(item.date);
  const end = item.end ? new Date(item.end) : null;
  const time = (value: Date) => value.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return end && Number.isFinite(end.getTime()) ? `${time(start)} – ${time(end)}` : time(start);
}

function eventDay(item: CalendarItem) {
  const date = item.allDay ? new Date(`${item.date?.slice(0, 10)}T12:00:00`) : new Date(item.date || "");
  return { day: date.toLocaleDateString("en-US", { day: "2-digit" }), month: date.toLocaleDateString("en-US", { month: "short" }), label: date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) };
}

function eventEndTime(item: CalendarItem) {
  return new Date(item.allDay ? `${item.end?.slice(0, 10) || item.date?.slice(0, 10)}T00:00:00` : item.end || item.date || "").getTime();
}

function safeCalendarLink(value: string) {
  try { const url = new URL(value); if (url.protocol === "https:" && (url.hostname === "google.com" || url.hostname.endsWith(".google.com"))) return url.toString(); }
  catch { /* Use the Calendar home page. */ }
  return "https://calendar.google.com/";
}

export default function LecturesMeetingsPanel({ userId, connected, account, data, loading, error, onRefresh, onConnect }: { userId: string; connected: boolean; account?: string; data: CalendarItems | null; loading: boolean; error: string; onRefresh: () => void; onConnect: () => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarItem | null>(null);
  const [draft, setDraft] = useState<Draft>(newDraft);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const requestId = useRef<string | null>(null);
  const events = (data?.events || []).filter(item => item.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const matching = events.filter(item => filter === "all" || (item.eventType || "event") === filter);
  const upcoming = matching.filter(item => eventEndTime(item) >= now);
  const recent = matching.filter(item => !upcoming.includes(item));
  const next = events.find(item => eventEndTime(item) >= now);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, saving]);

  function changeDraft(changes: Partial<Draft>) { requestId.current = null; setDraft(value => ({ ...value, ...changes })); setFormError(""); }
  function begin(item?: CalendarItem) { setEditing(item || null); setDraft(item ? editDraft(item) : newDraft()); requestId.current = null; setFormError(""); setNotice(""); setOpen(true); }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setFormError("");
    try {
      const input = calendarEventInput({ title: draft.title, type: draft.type, start: new Date(draft.start).toISOString(), end: new Date(draft.end).toISOString(), location: draft.location, notes: draft.notes, reminderMinutes: Number(draft.reminderMinutes) });
      if (editing) await updateEventInCalendar(userId, editing.id, input);
      else {
        requestId.current ||= crypto.randomUUID().replace(/-/g, "");
        await createEventInCalendar(userId, input, requestId.current);
      }
      setOpen(false); setEditing(null); setNotice(`${input.type === "event" ? "Event" : input.type === "meeting" ? "Meeting" : "Lecture"} saved in Google Calendar.`); onRefresh();
    } catch (issue) { setFormError(issue instanceof Error ? issue.message : "Could not save this Calendar event."); }
    finally { setSaving(false); }
  }

  async function remove(item: CalendarItem) {
    if (!window.confirm(`Remove “${item.title}” from Google Calendar?`)) return;
    setSaving(true); setNotice("");
    try { await deleteEventFromCalendar(userId, item.id); setNotice("Event removed from Google Calendar."); onRefresh(); }
    catch (issue) { setNotice(issue instanceof Error ? issue.message : "Could not remove this event."); }
    finally { setSaving(false); }
  }

  const filters: { value: Filter; label: string }[] = [{ value: "all", label: "All" }, { value: "meeting", label: "Meetings" }, { value: "lecture", label: "Lectures" }, { value: "event", label: "Events" }];
  const renderRow = (item: CalendarItem) => {
    const day = eventDay(item);
    return <article className="lm-event-row" key={item.id}>
      <div className="lm-date-tile" aria-label={day.label}><span>{day.month}</span><strong>{day.day}</strong></div>
      <div className="lm-event-main"><div className="lm-event-tags"><span className={`lm-type lm-${item.eventType || "event"}`}>{item.eventType || "event"}</span><span>{item.managed ? "Daylight" : "Google Calendar"}</span></div><h3>{item.title}</h3><div className="lm-event-meta"><span><Clock3 size={14}/>{eventTime(item)}</span>{item.location && <span><MapPin size={14}/>{item.location}</span>}</div>{item.notes && <p>{item.notes.slice(0, 160)}{item.notes.length > 160 ? "…" : ""}</p>}</div>
      <div className="lm-event-actions"><a href={safeCalendarLink(item.url)} target="_blank" rel="noreferrer" aria-label={`Open ${item.title} in Google Calendar`}><ArrowUpRight size={17}/><span>Open</span></a>{item.managed && <><button type="button" onClick={() => begin(item)} disabled={saving} aria-label={`Edit ${item.title}`}><Pencil size={15}/><span>Edit</span></button><button type="button" className="lm-delete" onClick={() => void remove(item)} disabled={saving} aria-label={`Remove ${item.title} from Google Calendar`}><Trash2 size={15}/></button></>}</div>
    </article>;
  };

  return <div className="lm-page">
    <div className="page-heading lm-heading"><div><span className="eyebrow">YOUR CALENDAR, IN ONE PLACE</span><h1>Lectures &amp; Meetings<span className="period">.</span></h1><p>See what is scheduled and add time to your connected Google Calendar.</p></div><button className="primary-button" onClick={() => connected ? begin() : onConnect()}><Plus size={18}/>{connected ? "New event" : "Connect Calendar"}</button></div>
    <div className="lm-summary-grid"><div className="lm-summary-card lm-next-card"><span className="section-kicker">UP NEXT</span>{next ? <><strong>{next.title}</strong><p>{eventDay(next).label} · {eventTime(next)}</p></> : <><strong>Clear calendar</strong><p>Your next event will appear here.</p></>}</div><div className="lm-summary-card"><span className="section-kicker">SCHEDULED</span><strong>{events.filter(item => eventEndTime(item) >= now).length}</strong><p>In the coming year</p></div><div className="lm-summary-card"><span className="section-kicker">CONNECTED ACCOUNT</span><strong className="lm-account-name">{connected ? account || "Google Calendar" : "Not connected"}</strong><p>{connected ? "Updates refresh while Daylight is open" : "Connect once in Connections"}</p></div></div>
    {notice && <div className="lm-notice" role="status">{notice}</div>}
    <section className="card lm-calendar-card"><div className="lm-list-heading"><div><span className="section-kicker">GOOGLE CALENDAR</span><h2>Scheduled events <span className="count-badge">{events.length}</span></h2><p>New and changed events from your primary calendar appear automatically.</p></div>{connected && <button className="subtle-button" type="button" onClick={onRefresh} disabled={loading}><RefreshCw size={15}/>{loading ? "Refreshing…" : "Refresh"}</button>}</div>
      {!connected ? <div className="lm-empty"><CalendarDays size={24}/><strong>Connect Google Calendar</strong><p>Your lectures, meetings, and events will appear here.</p><button type="button" onClick={onConnect}>Go to Connections <ArrowRight size={15}/></button></div>
        : loading && !data ? <div className="lm-empty" role="status">Loading your calendar…</div>
        : error && !data ? <div className="lm-empty" role="alert"><strong>Calendar could not load</strong><p>{error}</p><button type="button" onClick={onRefresh}>Try again <RefreshCw size={15}/></button></div>
        : <>{error && <p className="lm-inline-error" role="alert">Could not refresh: {error}</p>}<div className="lm-filter-bar" role="group" aria-label="Filter calendar events">{filters.map(item => <button key={item.value} type="button" className={filter === item.value ? "active" : ""} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}<span>{item.value === "all" ? events.length : events.filter(event => (event.eventType || "event") === item.value).length}</span></button>)}</div><div className="lm-event-list" role="region" aria-label="Lectures and meetings" tabIndex={0}>{upcoming.length > 0 && <><h3 className="lm-group-title">Coming up</h3>{upcoming.map(renderRow)}</>}{recent.length > 0 && <><h3 className="lm-group-title">Recent</h3>{recent.map(renderRow)}</>}{matching.length === 0 && <div className="lm-empty"><CalendarDays size={24}/><strong>{filter === "all" ? "Nothing scheduled yet" : `No ${filter}s in this period`}</strong><p>{filter === "all" ? "Add an event here or in Google Calendar to see it in this list." : "Choose another filter to see your other events."}</p>{filter === "all" && <button type="button" onClick={() => begin()}>Add an event <Plus size={15}/></button>}</div>}</div><p className="lm-range-note">Showing the past {data?.pastDays || 7} days and the next {data?.rangeDays || 365} days from your primary calendar. Google edits refresh while this page is open.</p></>}
    </section>
    {open && createPortal(<div className="modal-backdrop lm-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setOpen(false); }}><div className="modal lm-modal" role="dialog" aria-modal="true" aria-labelledby="lm-modal-title"><div className="modal-header"><div><span className="section-kicker">GOOGLE CALENDAR</span><h2 id="lm-modal-title">{editing ? "Edit scheduled event" : "New scheduled event"}</h2><p>Save here and it appears in your connected Google Calendar.</p></div><button type="button" className="close-button" aria-label="Close event form" onClick={() => setOpen(false)} disabled={saving}><X size={20}/></button></div><form onSubmit={event => void save(event)}><label>Type<select value={draft.type} onChange={event => changeDraft({ type: event.target.value as DaylightEventType })}><option value="event">Event</option><option value="meeting">Meeting</option><option value="lecture">Lecture</option></select></label><label>Title<input autoFocus required maxLength={180} placeholder="e.g. Design review with client" value={draft.title} onChange={event => changeDraft({ title: event.target.value })}/></label><div className="lm-form-dates"><label>Starts<input type="datetime-local" required value={draft.start} onChange={event => changeDraft({ start: event.target.value })}/></label><label>Ends<input type="datetime-local" required value={draft.end} onChange={event => changeDraft({ end: event.target.value })}/></label></div><label>Location or meeting link <span>optional</span><input maxLength={240} placeholder="e.g. Studio / Google Meet link" value={draft.location} onChange={event => changeDraft({ location: event.target.value })}/></label><label>Reminder<select value={draft.reminderMinutes} onChange={event => changeDraft({ reminderMinutes: event.target.value })}><option value="0">No reminder</option><option value="10">10 minutes before</option><option value="30">30 minutes before</option><option value="60">1 hour before</option></select></label><label>Notes <span>optional</span><textarea rows={3} maxLength={2000} placeholder="Agenda, preparation, or details" value={draft.notes} onChange={event => changeDraft({ notes: event.target.value })}/></label>{formError && <p className="lm-form-error" role="alert">{formError}</p>}<button className="primary-button form-submit" disabled={saving}>{saving ? "Saving to Google…" : editing ? "Save changes" : "Add to Calendar"}<ArrowRight size={16}/></button></form></div></div>, document.body)}
  </div>;
}
