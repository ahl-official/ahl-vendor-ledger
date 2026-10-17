# AHL Vendor Ledger V1

A China/Mexico vendor-payment and order ledger for American Hairline (AHL). Tracks, per currency: what was ordered, who actually paid whom, how much of each payment paid an order, how much money is still held by each vendor, and where it was transferred — without anyone needing to understand "routing" or "allocation."

This is a **new, separate project** — not a rewrite of the old Apps Script ledger. See [`CONTEXT.md`](CONTEXT.md) for the full original planning handoff and [`PRD.md`](PRD.md) for the short flow-based spec.

## Stack

- **Next.js** (App Router, TypeScript) — UI + server-only API routes
- **Google Sheets** as the database, via a service account (server-side only — credentials never reach the browser)
- No ORM, no extra state library — API routes read/write the Sheet directly through `lib/sheets.ts`, `lib/data.ts`, `lib/ledger.ts`

## Core concepts

- **Money_Movements** — a *fresh* receipt of cash: `CompanyToAgent`, `AgentToCompany`, or `AgentToVendor`. The vendor is always paid through the agent, so only `AgentToVendor` can be applied to an order or held on-account.
- **Applications** — spends part of a vendor receipt against one of that vendor's orders.
- **Transfers** — spends part of a vendor's held balance on something other than its own order: `Transfer` (to another vendor), `PaySupplier` (external, no held balance created), or `Refund`.
- **FX_Conversions** — explicitly links an agent's funding (e.g. INR) to the payout it paid for (e.g. RMB). Never automatic — see "Agent position" below.
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
| `npm run clear:test-activity` | Wipes all Orders/Order_Items/Money_Movements/Applications/Transfers (contacts untouched). Use before going live, or to reset after a test session. |

## Screens

- **Home** — 4 actions: New Order, Record Money Movement, Use Vendor Balance, View Ledger.
- **Contacts** — one directory, multi-role (Vendor/Supplier/Agent/Company/Other), create and edit.
- **Orders** — vendor, invoice ref, multi-line products (description/SKU/qty/unit/unit price), shipping fee, calculated total. Saving an order never records a payment.
- **Record Money Movement** — pick one of the 4 cash-flow types; for a vendor receipt, choose **Order only / On-account only / Order + on-account** with a live before→after preview. Agent flows capture actual rate, agent's quoted rate, and an optional separate fee.
- **Use Vendor Balance** — spend an existing held receipt: Apply to Order, Transfer to Vendor, Pay Supplier, or Refund, with a before→change→after preview.
- **Agent FX** — explicitly confirm that a specific agent funding paid for a specific agent payout, so the two-currency position can net to settled. Lists only the unconverted/unbacked remainder of each movement; rejects over-linking.
- **Ledger** — vendor held balances, agent running position (never netted across currency unless confirmed via Agent FX), and order paid/due — every number traces back to its source rows.

## Deployment

Pushed to GitHub (`ahl-official/ahl-vendor-ledger`) and deployed on Vercel. When deploying, set these env vars in the Vercel project (same values as local `.env.local`):

- `GOOGLE_SHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY` (keep the `\n` literal characters in the string, same format as `.env.local`)

## Explicitly out of scope for V1

- Vendor↔vendor goods/raw-material barter (non-cash settlement)
- Credit notes / returns
- Receivables (e.g. Kevin, who owes the company — tagged with contact role "Other" as a directory-only reference for now)

## Still open (needs a decision, not code)

1. **Opening balances** — start every vendor/agent at zero (current state), or migrate signed-off opening balances from the old ledger? Needs real figures per contact/currency; CONTEXT.md recommends never replaying old live payments.
2. **Review-separately contacts** — confirm roles for Faye, MS DU, MS Huang, 润驰耐丝, Kevin before relying on them in reporting.
3. Confirm both operating users (Accounts, Purchase) get free create access per CONTEXT.md, with the other just notified.
