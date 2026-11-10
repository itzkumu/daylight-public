export type DaylightEventType = "event" | "meeting" | "lecture";

export type CalendarEventInput = {
  title: string;
  type: DaylightEventType;
  start: string;
  end: string;
  location: string;
  notes: string;
  reminderMinutes: 0 | 10 | 30 | 60;
};

export function calendarEventInput(value: unknown): CalendarEventInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Enter the event details.");
  const input = value as Record<string, unknown>;
  const title = String(input.title ?? "").trim();
  const type = input.type;
  const start = String(input.start ?? "");
  const end = String(input.end ?? "");
  const location = String(input.location ?? "").trim();
  const notes = String(input.notes ?? "").trim();
  const reminderMinutes = Number(input.reminderMinutes ?? 30);
  if (!title || title.length > 180) throw new Error("Give the event a title under 180 characters.");
  if (type !== "event" && type !== "meeting" && type !== "lecture") throw new Error("Choose Event, Meeting, or Lecture.");
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (!timestamp.test(start) || !timestamp.test(end)) throw new Error("Choose valid start and end times.");
  const startTime = Date.parse(start);
  const endTime = Date.parse(end);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime || endTime - startTime > 7 * 86_400_000) throw new Error("The end must be after the start and within seven days.");
  if (location.length > 240 || notes.length > 2000) throw new Error("Keep location under 240 characters and notes under 2,000 characters.");
  if (reminderMinutes !== 0 && reminderMinutes !== 10 && reminderMinutes !== 30 && reminderMinutes !== 60) throw new Error("Choose a valid reminder.");
  return { title, type, start: new Date(startTime).toISOString(), end: new Date(endTime).toISOString(), location, notes, reminderMinutes: reminderMinutes as CalendarEventInput["reminderMinutes"] };
}

export function googleCalendarEventPayload(value: unknown) {
  const draft = calendarEventInput(value);
  return { summary: draft.title, description: draft.notes, location: draft.location, start: { dateTime: draft.start }, end: { dateTime: draft.end }, reminders: { useDefault: false, overrides: draft.reminderMinutes ? [{ method: "popup", minutes: draft.reminderMinutes }] : [] }, extendedProperties: { private: { daylightCreated: "true", daylightEventType: draft.type } } };
}
