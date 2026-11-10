import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { calendarConfigured, calendarRedirectUri, calendarStatus, createCalendarEvent, deleteCalendarEvent, disconnectCalendar, removeTaskEvent, syncTask, updateCalendarEvent } from "../../../lib/calendar-server";
import { origin, seal, uidFromRequest } from "../../../lib/social-server";

export const runtime = "nodejs";

const failure = (issue: unknown) => NextResponse.json({ error: issue instanceof Error ? issue.message : "Calendar request failed." }, { status: 400 });

export async function GET(request: NextRequest) {
  try {
    if (!calendarConfigured()) return NextResponse.json({ configured: false, connected: false });
    const uid = await uidFromRequest(request);
    return NextResponse.json({ configured: true, ...await calendarStatus(uid) });
  } catch (issue) { return failure(issue); }
}

export async function POST(request: NextRequest) {
  try {
    const uid = await uidFromRequest(request);
    const body = await request.json() as { action?: string; taskId?: string; eventId?: string; event?: unknown; requestId?: string };
    if (body.action === "sync") return NextResponse.json(await syncTask(uid, body.taskId));
    if (body.action === "remove") { await removeTaskEvent(uid, body.taskId); return NextResponse.json({ ok: true }); }
    if (body.action === "create-event") return NextResponse.json(await createCalendarEvent(uid, body.event, body.requestId));
    if (body.action === "update-event") return NextResponse.json(await updateCalendarEvent(uid, body.event, body.eventId));
    if (body.action === "delete-event") return NextResponse.json(await deleteCalendarEvent(uid, body.eventId));
    if (body.action !== "connect") throw new Error("Unknown calendar action.");
    if (!calendarConfigured()) throw new Error("Google Calendar needs server settings before it can connect.");
    const state = randomBytes(24).toString("base64url");
    const base = origin(request);
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", process.env.GOOGLE_OAUTH_CLIENT_ID!);
    url.searchParams.set("redirect_uri", calendarRedirectUri(base));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email https://www.googleapis.com/auth/calendar.events.owned https://www.googleapis.com/auth/tasks.readonly");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent select_account");
    url.searchParams.set("state", state);
    const response = NextResponse.json({ url: url.toString() });
    response.cookies.set("daylight_calendar_oauth", seal({ uid, state, origin: base, expiresAt: Date.now() + 600_000 }), {
      httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/api/calendar/callback", maxAge: 600,
    });
    return response;
  } catch (issue) { return failure(issue); }
}

export async function DELETE(request: NextRequest) {
  try {
    const uid = await uidFromRequest(request);
    await disconnectCalendar(uid);
    return NextResponse.json({ ok: true });
  } catch (issue) { return failure(issue); }
}
