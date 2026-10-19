# AHL Vendor Ledger V1

A China/Mexico vendor-payment and order ledger for American Hairline (AHL). Tracks, per currency: what was ordered, who actually paid whom, how much of each payment paid an order, how much money is still held by each vendor, and where it was transferred — without anyone needing to understand "routing" or "allocation."

This is a **new, separate project** — not a rewrite of the old Apps Script ledger. See [`CONTEXT.md`](CONTEXT.md) for the full original planning handoff and [`PRD.md`](PRD.md) for the short flow-based spec.

> **Working on this codebase? Read [`docs/README.md`](docs/README.md) first** — it covers the data model, the non-negotiable rules around money math, and a log of real bugs this project has already hit. This applies double if you're an AI agent picking this up cold.

## Stack

- **Next.js** (App Router, TypeScript) — UI + server-only API routes
- **Google Sheets** as the database, via a service account (server-side only — credentials never reach the browser)
- No ORM, no extra state library — API routes read/write the Sheet directly through `lib/sheets.ts`, `lib/data.ts`, `lib/ledger.ts`

## Core concepts

- **Money_Movements** — a *fresh* receipt of cash: `CompanyToAgent`, `AgentToCompany`, or `AgentToVendor`. The vendor is always paid through the agent, so only `AgentToVendor` can be applied to an order or held on-account.
- **Applications** — spends part of a vendor receipt against one of that vendor's orders.
- **Transfers** — spends part of a vendor's held balance on something other than its own order: `Transfer` (to another vendor), `PaySupplier` (external, no held balance created), or `Refund`.
- **FX_Conversions** — explicitly links an agent's funding (e.g. INR) to the payout it paid for (e.g. RMB). Never automatic — see "Agent position" below.
- **Credit_Notes** — a vendor-issued return/credit against one order, credited back to that vendor's held balance and reducing the order's net cost.
- **Custom_Options** — remembers free-typed "Other" values for the Reference/Method dropdowns (Record Money) so they're reusable next time. The one non-financial tab — safe to edit/clear freely.
- Every table is **append-only** — nothing is edited in place, so the rows themselves are the audit trail. Corrections are new rows, not overwrites.
- All balances (order due, vendor held, agent position) are **computed live** from source rows on every read — never cached/stale — see `lib/ledger.ts`.
- **Agent position is tracked per currency, never auto-netted.** An agent funded in INR who pays a vendor in RMB shows *both* "Holds INR X" and "Company owes RMB Y" at once — the app never assumes a conversion happened. Confirming one is a separate, explicit step on the **Agent FX** page, which links a specific funding amount to a specific payout amount; only then does the position net to settled. Nothing auto-calculates the payout from the funding's rate — you always enter the real amount that moved.

## Local setup

1. **Install deps:**
   ```bash
   npm install
   ```
2. **Create a Google Sheet** in your own Drive (service accounts have no storage quota to own files directly) and share it as **Editor** with your service account's email.
3. **Bootstrap the tabs** (adds all 6 tabs + header rows to that Sheet):
   ```bash
   npm run setup:sheet -- <SHARED_DRIVE_OR_SHEET_ID>
   ```
   This also writes `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, and `GOOGLE_PRIVATE_KEY` into `.env.local`. Put the service account JSON key at `secrets/service-account.json` first (both `.env.local` and `secrets/` are gitignored — never commit them).
4. **Run it:**
   ```bash
   npm run dev       # development
   npm run build && npm run start   # production (no dev-mode compile lag)
   ```

## Seed scripts

| Script | What it does |
|---|---|
| `npm run seed:contacts` | Adds the 26 approved vendors, Mr. Lucas Zhang (supplier), and the 3 agents from `THEME_AND_CONTACT_SEED.txt`. |
| `npm run seed:review-contacts` | Adds the 5 "needs confirmation" contacts (Faye, MS DU, MS Huang, 润驰耐丝, Kevin) — run only after reviewing their roles. |
| `npm run seed:test-contacts` | Adds `TEST Vendor` / `TEST Agent` / `TEST Supplier` so manual testing never touches real business names. |
| `npm run clear:test-activity` | Wipes all Orders/Order_Items/Money_Movements/Applications/Transfers/FX_Conversions (contacts and Custom_Options untouched). Use before going live, or to reset after a test session. |
| `npm run sheet:sync-tabs` | Adds any tab from `lib/schema.ts` that doesn't exist yet in the live Sheet, with its header row. Safe to re-run. Use this after pulling code that added a new tab. |
| `npm run add:contact -- "Name" Role1[,Role2]` | Adds one contact — a reusable one-off, for additions outside the bulk seed scripts. |
| `npm run setup:upload-folder -- <SHARED_DRIVE_ID>` | Creates (or finds) a "Proof Uploads" folder in the given Shared Drive and writes `GOOGLE_DRIVE_FOLDER_ID` into `.env.local`. Needed for the proof-file upload feature — see Deployment below. |

## Screens

- **Home** — 4 actions: New Order, Record Money Movement, Use Vendor Balance, View Ledger.
- **Contacts** — one directory, multi-role (Vendor/Supplier/Agent/Company/Other), create and edit, A–Z sorted.
- **Orders** — vendor, invoice ref, multi-line products (description/SKU/qty/unit/unit price), shipping fee, calculated total, optional proof file (PDF/image, uploaded to Drive). Saving an order never records a payment. Order detail supports editing line items, deleting the order, issuing a Credit Note against it, unlinking a wrongly-applied payment, and a one-click "apply vendor's held balance" suggestion when the vendor already has enough held.
- **Record Money Movement** — pick one of the 3 cash-flow types; for a vendor receipt, choose **Order only / On-account only / Order + on-account** with a live before→after preview. Agent flows capture actual rate, agent's quoted rate, and an optional separate fee. Method and Reference are growing dropdowns (defaults + anything typed under "Other" before, remembered for everyone).
- **Use Vendor Balance** — spend an existing held receipt (or, now, a vendor's total held balance across all open receipts): Apply to Order, Transfer to Vendor, or Pay Supplier, with a before→change→after preview. (Refund moved to Credit Notes on the order itself — see Orders above.)
- **Agent FX** — explicitly confirm that a specific agent funding paid for a specific agent payout, so the two-currency position can net to settled. Lists only the unconverted/unbacked remainder of each movement; rejects over-linking.
- **Ledger** — vendor held balances, agent running position (never netted across currency unless confirmed via Agent FX), and order paid/due — every number traces back to its source rows.

## Deployment

Pushed to GitHub (`ahl-official/ahl-vendor-ledger`) and deployed on Vercel. When deploying, set these env vars in the Vercel project (same values as local `.env.local`):

- `GOOGLE_SHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY` (keep the `\n` literal characters in the string, same format as `.env.local`)
- `GOOGLE_DRIVE_FOLDER_ID` (for proof-file uploads on Orders — run `npm run setup:upload-folder -- <SHARED_DRIVE_ID>` to create the folder and get this value)

## Explicitly out of scope for V1

- Vendor↔vendor goods/raw-material barter (non-cash settlement)
- Receivables (e.g. Kevin, who owes the company — tagged with contact role "Other" as a directory-only reference for now)
- Authentication/login — there is none. Anyone with the URL has full read/write access.

## Still open (needs a decision, not code)

1. **Opening balances** — start every vendor/agent at zero (current state), or migrate signed-off opening balances from the old ledger? Needs real figures per contact/currency; CONTEXT.md recommends never replaying old live payments.
2. **Review-separately contacts** — confirm roles for Faye, MS DU, MS Huang, 润驰耐丝, Kevin before relying on them in reporting.
3. Confirm both operating users (Accounts, Purchase) get free create access per CONTEXT.md, with the other just notified.
