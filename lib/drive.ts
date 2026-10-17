import { Readable } from "node:stream";
import { google } from "googleapis";

// Server-only. Uploads proof files (invoice / transaction proof) to the Drive folder in
// GOOGLE_DRIVE_FOLDER_ID and returns a link to store in the sheet's proofUrl column.
// The folder must be in a Shared Drive (or otherwise shared with the service account as
// Editor) — service accounts have no storage quota of their own.
export async function uploadToDrive(name: string, mimeType: string, data: Buffer): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const folder = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!email || !key) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY");
  if (!folder) throw new Error("File upload is not set up: GOOGLE_DRIVE_FOLDER_ID is missing");
  const auth = new google.auth.JWT({ email, key, scopes: ["https://www.googleapis.com/auth/drive"] });
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.create({
    requestBody: { name, parents: [folder] },
    media: { mimeType, body: Readable.from(data) },
    fields: "webViewLink",
    supportsAllDrives: true,
  });
  if (!res.data.webViewLink) throw new Error("Drive did not return a link for the uploaded file");
  return res.data.webViewLink;
}
