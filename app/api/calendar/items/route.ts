import { NextRequest, NextResponse } from "next/server";
import { calendarConfigured, calendarItems } from "../../../../lib/calendar-server";
import { uidFromRequest } from "../../../../lib/social-server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    if (!calendarConfigured()) throw new Error("Google Calendar is not configured.");
    const uid = await uidFromRequest(request);
    return NextResponse.json(await calendarItems(uid), { headers: { "Cache-Control": "private, no-store" } });
  } catch (issue) {
    return NextResponse.json({ error: issue instanceof Error ? issue.message : "Could not load Google Calendar." }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
}
