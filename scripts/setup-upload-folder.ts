// One-off: creates a "Proof Uploads" folder inside the Shared Drive the service account
// already has access to (the same one the Sheet lives in), and writes its ID into
// .env.local as GOOGLE_DRIVE_FOLDER_ID. Run with: npm run setup:upload-folder -- <SHARED_DRIVE_ID>
import { readFileSync, existsSync, appendFileSync, writeFileSync } from "node:fs";
import { google } from "googleapis";

const KEY_PATH = "secrets/service-account.json";

async function main() {
  const driveId = process.argv[2];
  if (!driveId) throw new Error("Usage: npm run setup:upload-folder -- <SHARED_DRIVE_ID>");
  if (!existsSync(KEY_PATH)) throw new Error(`Missing ${KEY_PATH}`);
  const key = JSON.parse(readFileSync(KEY_PATH, "utf8"));
  const auth = new google.auth.JWT({ email: key.client_email, key: key.private_key, scopes: ["https://www.googleapis.com/auth/drive"] });
  const drive = google.drive({ version: "v3", auth });

  const existing = await drive.files.list({
    q: `'${driveId}' in parents and name = 'Proof Uploads' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    driveId, corpora: "drive", includeItemsFromAllDrives: true, supportsAllDrives: true,
  });
  let folderId = existing.data.files?.[0]?.id;
  if (!folderId) {
    const created = await drive.files.create({
      requestBody: { name: "Proof Uploads", mimeType: "application/vnd.google-apps.folder", parents: [driveId] },
      supportsAllDrives: true,
    });
    folderId = created.data.id!;
    console.log("Created folder:", folderId);
  } else {
    console.log("Folder already exists:", folderId);
  }

  // Replace any existing GOOGLE_DRIVE_FOLDER_ID line instead of blind-appending, so
  // re-running this script never leaves two conflicting values in .env.local.
  const envPath = ".env.local";
  const envText = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  if (/^GOOGLE_DRIVE_FOLDER_ID=.*$/m.test(envText)) {
    writeFileSync(envPath, envText.replace(/^GOOGLE_DRIVE_FOLDER_ID=.*$/m, `GOOGLE_DRIVE_FOLDER_ID=${folderId}`));
    console.log("Updated GOOGLE_DRIVE_FOLDER_ID in .env.local");
  } else {
    appendFileSync(envPath, `\nGOOGLE_DRIVE_FOLDER_ID=${folderId}\n`);
    console.log("Wrote GOOGLE_DRIVE_FOLDER_ID to .env.local");
  }
  console.log(`\nAlso add this to Vercel project env vars: GOOGLE_DRIVE_FOLDER_ID=${folderId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
