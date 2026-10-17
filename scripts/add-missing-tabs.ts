// Adds any tab from lib/schema.ts SHEETS that doesn't exist yet in the live Sheet
// (GOOGLE_SHEET_ID), with its header row. Safe to re-run -- skips tabs already there.
// Run with: npm run sheet:sync-tabs
import { google } from "googleapis";
import { SHEETS } from "../lib/schema.ts";

async function main() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!spreadsheetId || !email || !key) throw new Error("Missing GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY");

  const auth = new google.auth.JWT({ email, key, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const sheets = google.sheets({ version: "v4", auth });
  const tabNames = Object.keys(SHEETS) as (keyof typeof SHEETS)[];

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = new Set((meta.data.sheets ?? []).map((s) => s.properties?.title));
  const toAdd = tabNames.filter((name) => !existing.has(name));

  if (!toAdd.length) {
    console.log("Nothing to add — every tab already exists.");
    return;
  }

  console.log("Adding tabs:", toAdd.join(", "));
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: toAdd.map((name) => ({ addSheet: { properties: { title: name } } })) },
  });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: toAdd.map((name) => ({ range: `${name}!A1`, values: [[...SHEETS[name]]] })),
    },
  });
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
