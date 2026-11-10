import { getFirebase, type Task } from "./firebase-data";
import { connectionResponse } from "./connection-response";
import type { CalendarEventInput, DaylightEventType } from "./calendar-event";

export type CalendarConnection = { configured: boolean; connected: boolean; needsReconnect?: boolean; email?: string; tasksEnabled?: boolean };
export type CalendarItem = { id: string; kind: "event" | "task"; title: string; date: string | null; end?: string | null; allDay: boolean; notes: string; url: string; reminder: boolean; reminderMinutes?: number; listName?: string; location?: string; eventType?: DaylightEventType; managed?: boolean };
export type CalendarItems = { events: CalendarItem[]; tasks: CalendarItem[]; tasksEnabled: boolean; tasksError?: string; rangeDays: number; pastDays?: number; error?: string };
export type { CalendarEventInput, DaylightEventType };

async function request(userId: string, method: string, body?: Record<string, unknown>) {
  const user = getFirebase()?.auth.currentUser;
  if (!user || user.uid !== userId) throw new Error("Sign in again to use Google Calendar.");
  const token = await user.getIdToken();
  const response = await fetch("/api/calendar", { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return connectionResponse<CalendarConnection & { url?: string; error?: string }>(response, "Google Calendar could not complete this action");
}

export async function getCalendarConnection(userId: string): Promise<CalendarConnection> { return request(userId, "GET"); }

export async function getCalendarItems(userId: string): Promise<CalendarItems> {
  const user = getFirebase()?.auth.currentUser;
  if (!user || user.uid !== userId) throw new Error("Sign in again to view Google Calendar.");
  const token = await user.getIdToken();
  const response = await fetch("/api/calendar/items", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  return connectionResponse<CalendarItems>(response, "Google Calendar could not load");
}

export async function connectGoogleCalendar(userId: string) {
  const result = await request(userId, "POST", { action: "connect" });
  if (!result.url) throw new Error("Google did not return a connection page.");
  window.location.assign(result.url);
}

export async function disconnectGoogleCalendar(userId: string) { await request(userId, "DELETE"); }
export async function syncTaskToCalendar(userId: string, task: Task) { if (task.dueAt && !task.calendarEventId) await request(userId, "POST", { action: "sync", taskId: task.id }); }
export async function removeTaskFromCalendar(userId: string, task: Task) { if (task.calendarEventId) await request(userId, "POST", { action: "remove", taskId: task.id }); }

export async function createEventInCalendar(userId: string, event: CalendarEventInput, requestId: string) {
  return request(userId, "POST", { action: "create-event", event, requestId });
}

export async function updateEventInCalendar(userId: string, eventId: string, event: CalendarEventInput) {
  return request(userId, "POST", { action: "update-event", eventId, event });
}

export async function deleteEventFromCalendar(userId: string, eventId: string) {
  return request(userId, "POST", { action: "delete-event", eventId });
}
