// One-off bootstrap: creates the V1 spreadsheet INSIDE a Shared Drive the service account
// is already a member of (Shared Drives have pooled storage, so the bot can own a file
// there — unlike a personal "My Drive", where it has zero quota), adds every tab with its
// header row, and writes credentials into .env.local.
//
// Before running:
//   1. Create a Shared Drive and add ahl-sheets-bot@ahl-sheets-automation.iam.gserviceaccount.com
//      as a Content manager.
//   2. Copy the Shared Drive ID from its URL: https://drive.google.com/drive/folders/<THIS_PART>
//   3. Run: npm run setup:sheet -- <THIS_PART>
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { google } from "googleapis";
import { SHEETS } from "../lib/schema.ts";

const KEY_PATH = "secrets/service-account.json";

async function main() {
  const driveId = process.argv[2];
  if (!driveId) {
    throw new Error("Usage: npm run setup:sheet -- <SHARED_DRIVE_ID> (see comment at top of this script)");
  }
  if (!existsSync(KEY_PATH)) {
    throw new Error(`Missing ${KEY_PATH} — put the service account JSON key there first.`);
  }
  const key = JSON.parse(readFileSync(KEY_PATH, "utf8"));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });

  const drive = google.drive({ version: "v3", auth });
  const sheets = google.sheets({ version: "v4", auth });
  const tabNames = Object.keys(SHEETS) as (keyof typeof SHEETS)[];

  console.log("Creating spreadsheet in the Shared Drive...");
  const file = await drive.files.create({
    requestBody: {
      name: "AHL Vendor Ledger V1",
      mimeType: "application/vnd.google-apps.spreadsheet",
      parents: [driveId],
    },
    supportsAllDrives: true,
  });
  const spreadsheetId = file.data.id!;
  console.log("Created:", spreadsheetId);

  console.log("Adding tabs...");
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: tabNames.map((name) => ({ addSheet: { properties: { title: name } } })) },
  });
  // Drop the default "Sheet1" that spreadsheets created this way still include.
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet1 = meta.data.sheets?.find((s) => s.properties?.title === "Sheet1");
  if (sheet1?.properties?.sheetId !== undefined) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ deleteSheet: { sheetId: sheet1.properties.sheetId } }] },
    });
  }

  console.log("Writing header rows...");
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: tabNames.map((name) => ({
        range: `${name}!A1`,
        values: [[...SHEETS[name]]],
      })),
    },
  });

  const envLine = `\nGOOGLE_SHEET_ID=${spreadsheetId}\nGOOGLE_SERVICE_ACCOUNT_EMAIL=${key.client_email}\nGOOGLE_PRIVATE_KEY="${key.private_key.replace(/\n/g, "\\n")}"\n`;
  appendFileSync(".env.local", envLine);
  console.log("Wrote credentials to .env.local");
  console.log(`\nOpen it: https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);
}

main().catch((err) => {
  console.error(JSON.stringify(err?.response?.data ?? err?.message ?? err, null, 2));
  process.exit(1);
});
