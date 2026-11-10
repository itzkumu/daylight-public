import { NextRequest, NextResponse } from "next/server";
import { billFolder, driveAccessToken, driveConfigured } from "../../../../lib/drive-server";
import { uidFromRequest } from "../../../../lib/social-server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    if (!driveConfigured()) throw new Error("Google Drive is not configured.");
    const uid = await uidFromRequest(request);
    const folderId = await billFolder(uid);
    const token = await driveAccessToken(uid);
    return NextResponse.json({ token, folderId }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (issue) {
    return NextResponse.json({ error: issue instanceof Error ? issue.message : "Could not access Google Drive." }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
}
