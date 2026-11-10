import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { seal, serverDb, unseal } from "./social-server";
import { googleCalendarEventPayload, type DaylightEventType } from "./calendar-event";

const eventsUrl = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const connectionRef = (uid: string) => serverDb().doc(`users/${uid}/integrations/googleCalendar`);
const taskRef = (uid: string, taskId: string) => serverDb().doc(`users/${uid}/tasks/${taskId}`);

type SavedCalendar = { email: string; connectedAt: string; encryptedCredentials: string; tasksEnabled?: boolean };
type GoogleTokens = { accessToken: string; refreshToken: string; expiresAt: number };
type TaskRecord = { id: string; title: string; dueAt?: string | null; notes?: string; calendarEventId?: string };

export const calendarConfigured = () => Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.FIREBASE_SERVICE_ACCOUNT_JSON && process.env.SOCIAL_TOKEN_ENCRYPTION_KEY && process.env.DAYLIGHT_OWNER_UID);
export const calendarRedirectUri = (origin: string) => `${origin}/api/calendar/callback`;

export async function calendarStatus(uid: string) {
  const snapshot = await connectionRef(uid).get();
  if (!snapshot.exists) return { connected: false };
  const data = snapshot.data() as SavedCalendar;
  try { await accessToken(uid); }
  catch (issue) {
    if (issue instanceof CalendarReconnectError) return { connected: false, needsReconnect: true, email: data.email };
    throw issue;
  }
  return { connected: true, email: data.email, connectedAt: data.connectedAt, tasksEnabled: data.tasksEnabled === true };
}

export async function saveCalendar(uid: string, email: string, tokens: GoogleTokens, tasksEnabled: boolean) {
  const previous = await connectionRef(uid).get();
  await connectionRef(uid).set({ email, connectedAt: new Date().toISOString(), encryptedCredentials: seal(tokens), tasksEnabled });
  // A different Google account cannot contain the event IDs saved for the old one.
  if (previous.exists && (previous.data() as SavedCalendar).email !== email) await clearTaskEventIds(uid);
}

async function clearTaskEventIds(uid: string) {
  const tasks = await serverDb().collection(`users/${uid}/tasks`).get();
  const synced = tasks.docs.filter(task => task.get("calendarEventId"));
  for (let index = 0; index < synced.length; index += 450) {
    const batch = serverDb().batch();
    for (const task of synced.slice(index, index + 450)) batch.update(task.ref, { calendarEventId: FieldValue.delete() });
    await batch.commit();
  }
}

export async function disconnectCalendar(uid: string) {
  await clearTaskEventIds(uid);
  await connectionRef(uid).delete();
}

class CalendarReconnectError extends Error {}

async function accessToken(uid: string) {
  const reference = connectionRef(uid);
  const snapshot = await reference.get();
  if (!snapshot.exists) throw new Error("Connect Google Calendar from Connections first.");
  const data = snapshot.data() as SavedCalendar;
  let tokens: GoogleTokens;
  try { tokens = unseal<GoogleTokens>(data.encryptedCredentials); }
  catch { throw new CalendarReconnectError("The saved Calendar connection cannot be read. Reconnect it from Connections."); }
  if (tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, cache: "no-store",
    body: new URLSearchParams({ client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!, refresh_token: tokens.refreshToken, grant_type: "refresh_token" }),
  });
  const fresh = await response.json() as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !fresh.access_token) {
    if (fresh.error === "invalid_grant") throw new CalendarReconnectError("Google Calendar access expired. Reconnect it from Connections.");
    if (fresh.error === "invalid_client") throw new Error("Daylight's Calendar OAuth client secret is invalid. Update the secret in Vercel.");
    throw new Error("Google Calendar could not refresh right now. Try again shortly.");
  }
  const updated = { ...tokens, accessToken: fresh.access_token, expiresAt: Date.now() + (fresh.expires_in || 3600) * 1000 };
  await reference.update({ encryptedCredentials: seal(updated) });
  return updated.accessToken;
}

async function calendarRequest(uid: string, url: string, init: RequestInit) {
  const token = await accessToken(uid);
  const response = await fetch(url, { ...init, cache: "no-store", headers: { Authorization: `Bearer ${token}`, ...init.headers } });
  if (response.status === 401) throw new CalendarReconnectError("Google Calendar access needs attention. Reconnect it from Connections.");
  if (response.status === 403) throw new Error("Google Calendar denied this action. Check Calendar API access and account permissions.");
  return response;
}

type GoogleEvent = { id?: string; summary?: string; description?: string; location?: string; status?: string; htmlLink?: string; start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string }; reminders?: { useDefault?: boolean; overrides?: { method?: string; minutes?: number }[] }; extendedProperties?: { private?: { daylightTaskId?: string; daylightEventType?: string; daylightCreated?: string } } };
type GoogleTask = { id?: string; title?: string; notes?: string; due?: string; status?: string; webViewLink?: string; deleted?: boolean };
export type CalendarItem = { id: string; kind: "event" | "task"; title: string; date: string | null; end?: string | null; allDay: boolean; notes: string; url: string; reminder: boolean; reminderMinutes?: number; listName?: string; location?: string; eventType?: DaylightEventType; managed?: boolean };

async function calendarJson<T>(uid: string, url: URL): Promise<T> {
  const response = await calendarRequest(uid, url.toString(), { method: "GET" });
  if (!response.ok) throw new Error(`Google Calendar could not load events (${response.status}).`);
  return response.json() as Promise<T>;
}

async function googleTasksJson<T>(uid: string, url: URL): Promise<T> {
  const token = await accessToken(uid);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!response.ok) throw new Error(`Google Tasks could not load (${response.status}). Check that the Tasks API is enabled.`);
  return response.json() as Promise<T>;
}

export async function calendarItems(uid: string) {
  const connection = await connectionRef(uid).get();
  if (!connection.exists) throw new Error("Connect Google Calendar first.");
  const tasksEnabled = (connection.data() as SavedCalendar).tasksEnabled === true;
  const now = Date.now();
  const from = new Date(now - 7 * 86_400_000).toISOString();
  const until = new Date(now + 365 * 86_400_000).toISOString();
  const events: CalendarItem[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const url = new URL(eventsUrl);
    url.searchParams.set("timeMin", from);
    url.searchParams.set("timeMax", until);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "250");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const result = await calendarJson<{ items?: GoogleEvent[]; nextPageToken?: string }>(uid, url);
    for (const event of result.items || []) {
      if (!event.id || event.status === "cancelled" || event.extendedProperties?.private?.daylightTaskId) continue;
      const date = event.start?.dateTime || event.start?.date || null;
      if (!date) continue;
      const savedType = event.extendedProperties?.private?.daylightEventType;
      const eventType: DaylightEventType = savedType === "meeting" || savedType === "lecture" ? savedType : "event";
      events.push({ id: event.id, kind: "event", title: event.summary?.trim() || "Untitled event", date, end: event.end?.dateTime || event.end?.date || null, allDay: Boolean(event.start?.date), notes: event.description || "", location: event.location || "", url: event.htmlLink || "https://calendar.google.com/", reminder: Boolean(event.reminders?.useDefault || event.reminders?.overrides?.length), reminderMinutes: event.reminders?.overrides?.find(item => item.method === "popup")?.minutes, eventType, managed: event.extendedProperties?.private?.daylightCreated === "true" });
    }
    pageToken = result.nextPageToken;
    if (!pageToken) break;
  }
  const tasks: CalendarItem[] = [];
  let tasksError: string | undefined;
  if (tasksEnabled) {
    try {
    let listPage: string | undefined;
    for (let page = 0; page < 3; page++) {
      const listsUrl = new URL("https://tasks.googleapis.com/tasks/v1/users/@me/lists");
      listsUrl.searchParams.set("maxResults", "100");
      if (listPage) listsUrl.searchParams.set("pageToken", listPage);
      const lists = await googleTasksJson<{ items?: { id: string; title?: string }[]; nextPageToken?: string }>(uid, listsUrl);
      for (const list of lists.items || []) {
        let taskPage: string | undefined;
        for (let index = 0; index < 10; index++) {
          const tasksUrl = new URL(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(list.id)}/tasks`);
          tasksUrl.searchParams.set("maxResults", "100");
          tasksUrl.searchParams.set("showCompleted", "false");
          tasksUrl.searchParams.set("showDeleted", "false");
          if (taskPage) tasksUrl.searchParams.set("pageToken", taskPage);
          const result = await googleTasksJson<{ items?: GoogleTask[]; nextPageToken?: string }>(uid, tasksUrl);
          for (const task of result.items || []) {
            if (!task.id || task.deleted || task.status === "completed") continue;
            const date = task.due?.slice(0, 10) || null;
            if (date && date > until.slice(0, 10)) continue;
            tasks.push({ id: `${list.id}:${task.id}`, kind: "task", title: task.title?.trim() || "Untitled task", date, allDay: true, notes: task.notes || "", url: task.webViewLink || "https://tasks.google.com/", reminder: Boolean(date), listName: list.title || "Google Tasks" });
          }
          taskPage = result.nextPageToken;
          if (!taskPage) break;
        }
      }
      listPage = lists.nextPageToken;
      if (!listPage) break;
    }
    } catch (issue) {
      tasksError = issue instanceof Error ? issue.message : "Google Tasks could not load.";
      tasks.length = 0;
    }
  }
  return { events, tasks, tasksEnabled, tasksError, rangeDays: 365, pastDays: 7 };
}

function checkedEventId(value: unknown) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{5,1024}$/.test(value)) throw new Error("Choose a valid calendar event.");
  return value;
}

async function managedEvent(uid: string, eventId: string) {
  const response = await calendarRequest(uid, `${eventsUrl}/${encodeURIComponent(eventId)}`, { method: "GET" });
  if (response.status === 404 || response.status === 410) throw new Error("This event is no longer in Google Calendar. Refresh the list.");
  if (!response.ok) throw new Error(`Could not load this Calendar event (${response.status}).`);
  const event = await response.json() as GoogleEvent;
  if (event.extendedProperties?.private?.daylightCreated !== "true") throw new Error("Edit this Google event in Google Calendar.");
  return event;
}

export async function createCalendarEvent(uid: string, input: unknown, requestId: unknown) {
  if (typeof requestId !== "string" || !/^[0-9a-f]{32}$/.test(requestId)) throw new Error("Could not save this event. Refresh and try again.");
  const id = `d2${requestId}`;
  const response = await calendarRequest(uid, eventsUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...googleCalendarEventPayload(input) }) });
  if (response.status === 409) { await managedEvent(uid, id); return { id, saved: true }; }
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(detail?.error?.message || `Google Calendar could not create this event (${response.status}).`);
  }
  return { id, saved: true };
}

export async function updateCalendarEvent(uid: string, input: unknown, eventId: unknown) {
  const id = checkedEventId(eventId);
  await managedEvent(uid, id);
  const response = await calendarRequest(uid, `${eventsUrl}/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(googleCalendarEventPayload(input)) });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(detail?.error?.message || `Google Calendar could not update this event (${response.status}).`);
  }
  return { id, saved: true };
}

export async function deleteCalendarEvent(uid: string, eventId: unknown) {
  const id = checkedEventId(eventId);
  await managedEvent(uid, id);
  const response = await calendarRequest(uid, `${eventsUrl}/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(detail?.error?.message || `Google Calendar could not delete this event (${response.status}).`);
  }
  return { id, deleted: true };
}

function checkedId(value: unknown) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new Error("Choose a valid task.");
  return value;
}

function eventId(taskId: string) { return `d1${taskId.replace(/-/g, "").toLowerCase()}`; }

export async function syncTask(uid: string, input: unknown) {
  const id = checkedId(input);
  const reference = taskRef(uid, id);
  const snapshot = await reference.get();
  if (!snapshot.exists) throw new Error("Task not found.");
  const task = snapshot.data() as TaskRecord;
  if (!task.dueAt) throw new Error("Give this task a date and time first.");
  if (task.calendarEventId) return { eventId: task.calendarEventId };
  const start = new Date(task.dueAt);
  if (!Number.isFinite(start.getTime())) throw new Error("Choose a valid task date and time.");
  const calendarId = eventId(id);
  const response = await calendarRequest(uid, eventsUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
    id: calendarId, summary: task.title, description: task.notes || "Created in Daylight",
    start: { dateTime: start.toISOString() }, end: { dateTime: new Date(start.getTime() + 30 * 60_000).toISOString() },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] },
    extendedProperties: { private: { daylightTaskId: id } },
  }) });
  if (!response.ok && response.status !== 409) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(detail?.error?.message || `Google Calendar could not add this task (${response.status}).`);
  }
  await reference.update({ calendarEventId: calendarId });
  return { eventId: calendarId };
}

export async function removeTaskEvent(uid: string, input: unknown) {
  const id = checkedId(input);
  const snapshot = await taskRef(uid, id).get();
  if (!snapshot.exists) return;
  const task = snapshot.data() as TaskRecord;
  if (!task.calendarEventId) return;
  const response = await calendarRequest(uid, `${eventsUrl}/${encodeURIComponent(task.calendarEventId)}`, { method: "DELETE" });
  if (response.ok || response.status === 404 || response.status === 410) return;
  const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  throw new Error(detail?.error?.message || `Google Calendar could not remove this task (${response.status}).`);
}
