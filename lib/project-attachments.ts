import { getFirebase } from "./firebase-data";

const maxAttachmentBytes = 10 * 1024 * 1024;

async function driveFetch(url: string, token: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message || `Google Drive could not upload this file (${response.status}).`);
  }
  return response;
}

export async function uploadProjectAttachment(userId: string, file: File) {
  if (!file.size || file.size > maxAttachmentBytes) throw new Error("Choose a file smaller than 10 MB.");
  const firebase = getFirebase();
  const currentUser = firebase?.auth.currentUser;
  if (!currentUser || currentUser.uid !== userId) throw new Error("Sign in again before uploading a file.");
  const session = await fetch("/api/drive/session", {
    headers: { Authorization: `Bearer ${await currentUser.getIdToken()}` }, cache: "no-store",
  });
  const access = await session.json() as { token?: string; error?: string };
  if (!session.ok || !access.token) throw new Error(access.error || "Connect Google Drive in Money before attaching project files.");
  const token = access.token;
  const query = new URLSearchParams({ q: "name = 'Daylight Projects' and mimeType = 'application/vnd.google-apps.folder' and trashed = false", fields: "files(id)", pageSize: "1" });
  const listing = await driveFetch(`https://www.googleapis.com/drive/v3/files?${query}`, token);
  const found = await listing.json() as { files?: { id: string }[] };
  let folderId = found.files?.[0]?.id;
  if (!folderId) {
    const created = await driveFetch("https://www.googleapis.com/drive/v3/files?fields=id", token, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Daylight Projects", mimeType: "application/vnd.google-apps.folder" }),
    });
    folderId = ((await created.json()) as { id: string }).id;
  }
  if (!folderId) throw new Error("Google Drive could not create the project folder.");
  const boundary = `daylight-project-${crypto.randomUUID()}`;
  const mimeType = file.type || "application/octet-stream";
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify({ name: file.name.slice(0, 240), mimeType, parents: [folderId] }),
    `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    file,
    `\r\n--${boundary}--\r\n`,
  ]);
  const uploaded = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", token, {
    method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body,
  });
  const result = await uploaded.json() as { id?: string; webViewLink?: string };
  if (!result.id) throw new Error("Google Drive did not return the attached file.");
  return { name: file.name.slice(0, 240), driveFileId: result.id, url: result.webViewLink || `https://drive.google.com/file/d/${result.id}/view` };
}
