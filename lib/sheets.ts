import { google } from "googleapis";
import { SHEETS, type SheetName } from "./schema.ts";

// Server-only. Never import this file from a client component.

function auth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY");
  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function sheetId() {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("Missing GOOGLE_SHEET_ID");
  return id;
}

async function client() {
  return google.sheets({ version: "v4", auth: auth() });
}

/** Reads every row of a tab as an array of plain string-valued objects keyed by header. */
export async function readRows(tab: SheetName): Promise<Record<string, string>[]> {
  const [rows] = await readRowsBatch([tab]);
  return rows;
}

/** Reads several tabs in ONE Sheets API call (values.batchGet) instead of one call per tab —
 *  Sheets API has a per-minute read-request quota, and a page that needs 4-6 tabs was burning
 *  4-6 requests every time it loaded. Returns rows in the same order as `tabs`. */
export async function readRowsBatch(tabs: SheetName[]): Promise<Record<string, string>[][]> {
  const sheets = await client();
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: sheetId(),
    ranges: tabs.map((tab) => `${tab}!A2:${colLetter((SHEETS[tab] as readonly string[]).length)}`),
  });
  return tabs.map((tab, i) => {
    const headers = SHEETS[tab] as readonly string[];
    const rows = res.data.valueRanges?.[i]?.values ?? [];
    return rows.map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, j) => (obj[h] = row[j] ?? ""));
      return obj;
    });
  });
}

/** Appends one row. `fields` may omit trailing columns. */
export async function appendRow(tab: SheetName, fields: Record<string, string | number | boolean | null>) {
  const sheets = await client();
  const headers = SHEETS[tab] as readonly string[];
  const row = headers.map((h) => serialize(fields[h]));
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId(),
    range: `${tab}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [row] },
  });
}

/** Patches specific columns on the row whose `id` column matches `id`. */
export async function updateRow(tab: SheetName, id: string, patch: Record<string, string | number | boolean | null>) {
  const sheets = await client();
  const headers = SHEETS[tab] as readonly string[];
  const idCol = headers.indexOf("id");
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${tab}!A2:${colLetter(headers.length)}`,
  });
  const rows = res.data.values ?? [];
  const rowIndex = rows.findIndex((r) => r[idCol] === id);
  if (rowIndex === -1) throw new Error(`${tab} row with id ${id} not found`);
  const sheetRowNumber = rowIndex + 2; // +1 header, +1 1-indexed
  const data = Object.entries(patch).map(([field, value]) => {
    const col = headers.indexOf(field);
    if (col === -1) throw new Error(`${tab} has no column ${field}`);
    return {
      range: `${tab}!${colLetter(col + 1)}${sheetRowNumber}`,
      values: [[serialize(value)]],
    };
  });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId(),
    requestBody: { valueInputOption: "RAW", data },
  });
}

/** Wipes every data row from a tab (keeps the header). Used for one-off cleanup scripts. */
export async function clearRows(tab: SheetName) {
  const sheets = await client();
  const headers = SHEETS[tab] as readonly string[];
  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId(),
    range: `${tab}!A2:${colLetter(headers.length)}`,
  });
}

/** Deletes rows from a tab where `field` matches `value`. Returns count of rows deleted. */
export async function deleteRowsByField(tab: SheetName, field: string, value: string): Promise<number> {
  const sheets = await client();
  const headers = SHEETS[tab] as readonly string[];
  const colIndex = headers.indexOf(field);
  if (colIndex === -1) throw new Error(`${tab} has no column ${field}`);

  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId() });
  const sheetObj = meta.data.sheets?.find((s) => s.properties?.title === tab);
  const sheetNumericId = sheetObj?.properties?.sheetId;
  if (sheetNumericId === undefined) throw new Error(`Tab ${tab} not found in spreadsheet`);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${tab}!A2:${colLetter(headers.length)}`,
  });
  const rows = res.data.values ?? [];
  const matchingIndices: number[] = [];
  rows.forEach((r, i) => {
    if (r[colIndex] === value) {
      matchingIndices.push(i + 1); // Row 0 is header, so row 2 in 1-based is index 1
    }
  });

  if (matchingIndices.length === 0) return 0;

  // Delete from bottom to top so row indices don't shift
  matchingIndices.sort((a, b) => b - a);

  const requests = matchingIndices.map((rowIndex) => ({
    deleteDimension: {
      range: {
        sheetId: sheetNumericId,
        dimension: "ROWS",
        startIndex: rowIndex,
        endIndex: rowIndex + 1,
      },
    },
  }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId(),
    requestBody: { requests },
  });

  return matchingIndices.length;
}

function serialize(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}

function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
