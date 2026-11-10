import assert from "node:assert/strict";
import test from "node:test";
import { calendarEventInput, googleCalendarEventPayload } from "../lib/calendar-event.ts";

test("a lecture keeps its type, local time conversion, and reminder", () => {
  const result = calendarEventInput({ title: "  Design lecture  ", type: "lecture", start: "2026-11-04T12:00:00+05:30", end: "2026-11-04T13:30:00+05:30", location: "Room A", notes: "Bring slides", reminderMinutes: 10 });
  assert.deepEqual(result, { title: "Design lecture", type: "lecture", start: "2026-11-04T06:30:00.000Z", end: "2026-11-04T08:00:00.000Z", location: "Room A", notes: "Bring slides", reminderMinutes: 10 });
  const google = googleCalendarEventPayload(result);
  assert.equal(google.start.dateTime, "2026-11-04T06:30:00.000Z");
  assert.equal(google.end.dateTime, "2026-11-04T08:00:00.000Z");
  assert.deepEqual(google.reminders, { useDefault: false, overrides: [{ method: "popup", minutes: 10 }] });
  assert.deepEqual(google.extendedProperties.private, { daylightCreated: "true", daylightEventType: "lecture" });
});

test("a meeting must have a valid end time and supported type", () => {
  assert.throws(() => calendarEventInput({ title: "Client call", type: "meeting", start: "2026-11-04T10:00:00Z", end: "2026-11-04T09:00:00Z", reminderMinutes: 30 }), /end must be after/);
  assert.throws(() => calendarEventInput({ title: "Client call", type: "webinar", start: "2026-11-04T10:00:00Z", end: "2026-11-04T11:00:00Z", reminderMinutes: 30 }), /Choose Event/);
  assert.throws(() => calendarEventInput({ title: "Client call", type: "meeting", start: "2026-11-04T10:00:00Z", end: "2026-11-04T11:00:00Z", reminderMinutes: -1 }), /valid reminder/);
  assert.deepEqual(googleCalendarEventPayload({ title: "Launch", type: "event", start: "2026-11-04T10:00:00Z", end: "2026-11-04T11:00:00Z", reminderMinutes: 0 }).reminders, { useDefault: false, overrides: [] });
});
