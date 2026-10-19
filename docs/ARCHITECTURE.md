# Architecture — read this before changing any money logic

This is the authoritative reference for how AHL Vendor Ledger V1 works. If you're an AI
agent or a new teammate about to touch anything under `lib/`, `app/api/`, or any page
that records or spends money, **read this file first.** Most of the bugs this project
has actually hit came from a change that looked locally correct but violated one of the
rules below. See [`DECISIONS.md`](DECISIONS.md) for the *why* behind each rule and a log
of real mistakes that happened when a rule was broken.

## The one-sentence architecture

Next.js (App Router) + a Google Sheet as the database, read/written server-side only
through `lib/sheets.ts` → `lib/data.ts` → `lib/ledger.ts`. Every financial table is
**append-only**; every balance is **computed live** from the raw rows on every read,
never cached or stored as a running total.

## Non-negotiable rules

These are the rules that, if broken, silently corrupt money numbers. Check every PR
(human or agent) against this list.

### 1. Append-only. No real DELETE on financial rows.

Nothing in `Money_Movements`, `Applications`, `Transfers`, `FX_Conversions`, or
`Credit_Notes` is ever edited or deleted in place. A correction is: set `reversed: true`
(or `active: false` for Applications) with a `reversedReason`, then append a brand-new
row with the corrected values. The old row stays forever — it's the audit trail.

- `lib/sheets.ts` → `updateRow()` is how you void a row (set its `reversed`/`active`
  flag). This is safe and expected.
- If you ever see a true row-removal helper (e.g. `deleteRowsByField`) called against
  one of the five financial tables above, **that is a violation of this rule** — it
  destroys history a shared financial ledger can't afford to lose, and multiple people
  may already be looking at a report that includes that row. `Orders`/`Order_Items`/
  `Contacts` are not strictly financial-event tables, so deleting an order a user just
  created by mistake is more defensible — but even then, prefer a `void`/`cancelled`
  flag if the order has any money already applied against it.
- UI pattern for "edit": void the old row, redirect to the same form pre-filled with
  its old values, let the user adjust and save as a *new* row. See `app/payments/new/
  page.tsx`, `app/vendor-balance/page.tsx`, `app/agent-fx/page.tsx` for the reference
  implementation (`?editId=...` query param).

### 2. Balances are computed live. Never store a running total.

`vendorHeld()`, `agentPosition()`, `orderSummary()`, `movementRemaining()`,
`fundingRemaining()`, `spendUnbacked()` in `lib/ledger.ts` are pure functions over the
full set of rows, called fresh on every GET. There is no `Ledger_Summary` tab and no
cached balance field anywhere. If you're tempted to store "current held balance" as a
column somewhere so you don't have to recompute it — don't. It will drift from reality
the first time two people edit concurrently, and nothing will tell you it's wrong.

### 3. Currencies are never netted automatically.

An agent can simultaneously show **"Holds INR 15,000"** and **"Company owes RMB 8,000"**
— these are not the same thing and must never be subtracted from each other or
collapsed into one number. The only way they connect is an explicit **Agent FX
Conversion** (`app/agent-fx/page.tsx`, `FX_Conversions` tab) where a human confirms
"this specific INR funding is what paid for that specific RMB payout." Nothing computes
or guesses that link automatically — seeFX_Conversions tab comment in `lib/schema.ts`.

If a UI change ever collapses an agent's multi-currency position into a single "status"
or "balance" number, check whether it's still representing each currency separately
underneath, or whether it's actually summing/netting unrelated currencies. The latter
is always wrong.

### 4. New receipts and historical direct receipts

New payments use AgentToVendor, CompanyToAgent, or AgentToCompany. The 19 October
migration also imports the old system's actual company-to-vendor payments as
LegacyCompanyToVendor. This import-only type preserves the real payer; the normal
POST route rejects it. isReceipt() recognizes both vendor receipt types.

An import may also carry forward a confirmed fiscal-year opening balance as
OpeningBalance in Money_Movements. It has no payer, method, or exchange rate and
does not change company or agent cash positions. It is a spendable vendor source,
labeled as an opening balance in the existing statement. It is not offered by the
new-payment form or accepted by its POST handler.

### 5. Held funds have three spendable source kinds

balanceSource() recognizes actual vendor receipts, incoming on-account Transfers,
and Credit Notes. Applications.movementId and Transfers.sourceMovementId now reference
one of these original source IDs; they do not necessarily reference Money_Movements.
No new cash receipt is fabricated to represent transferred money.

vendorOpenReceipts() retains its old API name but returns all three source kinds.
Imported historical transfers whose source receipt was unspecified have an empty
sourceMovementId: their outgoing value is reserved FIFO across the sender's sources.
New spending always names the actual source. Both the aggregate vendorHeld() total
and the sum of remaining source funds must agree, in each currency.

A transfer directly paying a receiving order contributes to orderPaid(), and contributes
zero held funds for that recipient. Later applications of an on-account transfer use
that transfer ID as their source. The same source may not be spent twice.

FIFO applications/transfers are validated in full and saved by appendRowsAtomic() in
one Sheets appendCells request, so a request cannot report success after half a spend.
Voiding a source is blocked while dependent onward spending remains. Imported rows
retain legacyId. Existing edit screens can void them and append corrected replacements;
original rows and the frozen source remain available for audit. Never overwrite/delete
the original financial event.

Legacy orders keep totalKnown=false when the source total was unknown, and preserve
legacyTotal when a detailed item breakdown does not exist. Never display these unknown
orders as settled or accept a new application until the total is confirmed. Cancelled
orders remain in history and are omitted from active lists. Legacy_Records preserves
original source rows and pending/open obligations without inventing money movements.

### 6. Money math changes need a live test, not just a build pass.

A clean `npm run build` only proves the TypeScript compiles — it proves nothing about
whether the dollars (or RMB) add up. Any change to `lib/ledger.ts`, or to a route in
`app/api/*` that appends/voids a financial row, must be verified against the real Sheet
(or a `TEST`-prefixed sandbox — see `TEST-CASES.md`) with a before/after number check,
not just "it didn't crash." Several real bugs in this project's history looked correct
in code review and were only caught by actually running the numbers (see
`DECISIONS.md`).

## Data model

Financial tabs, plus `Contacts`, `Orders`/`Order_Items`, and `Custom_Options`
(a small UX convenience, not financial). Full column list: `lib/schema.ts` → `SHEETS`.

| Tab | What it records | Key fields |
|---|---|---|
| `Contacts` | The directory. One row can hold multiple roles (`Vendor`, `Supplier`, `Agent`, `Company`, `Other`). | `roles` (comma-joined) |
| `Orders` + `Order_Items` | What was ordered. Saving an order never records a payment. | `vendorId`, items → `lineTotal` |
| `Money_Movements` | A *fresh* receipt of cash: `CompanyToAgent`, `AgentToCompany`, or `AgentToVendor`. | `type`, `payerId`, `payeeId`, `amount`, `currency`, `paymentUse` |
| `Applications` | Spends part of a vendor receipt against one of that vendor's own orders. | `movementId`, `orderId`, `amount`, `active` |
| `Transfers` | Spends part of a vendor's held balance on something that *isn't* its own order: another vendor (`Transfer`), an external supplier (`PaySupplier`), or a refund (`Refund`). | `sourceMovementId`, `fromVendorId`, `toContactId`, `purpose` |
| `FX_Conversions` | Explicitly links an agent funding to an agent payout across currencies. Never automatic. | `fundingMovementId`, `spendMovementId`, `fromAmount`, `toAmount` |
| `Credit_Notes` | A vendor-issued return/credit against one order, credited back to that vendor's held balance. | `orderId`, `vendorId`, `amount` |
| `Custom_Options` | Remembers free-typed "Other" values for the Reference/Method dropdowns so they're reusable. Not financial — safe to clear/edit freely. | `field`, `value` |

Every current financial event (all tables except `Custom_Options` and `Contacts`) has
`reversed`/`active` + `reversedReason` + `createdAt`, following rule 1.

## Request flow for a typical mutation

1. Client page (`app/.../page.tsx`, `"use client"`) collects input, `POST`s to an
   `app/api/.../route.ts` handler.
2. The route handler calls `getAllData()` (`lib/data.ts`) — **one batched Sheets API
   call** for every tab it might need (see `lib/sheets.ts` → `readRowsBatch`; this
   exists because Sheets has a per-minute read-request quota and the app used to do
   4-6 separate reads per page load).
3. The handler validates using the pure functions in `lib/ledger.ts` (e.g.
   `movementRemaining()`, `orderSummary().due`) against the request amount.
4. On success, `appendRow()` writes the new row(s). **Never run two `appendRow()` calls
   to the *same tab* in `Promise.all`** — this caused a real, confirmed data-loss bug
   (two parallel appends to `Custom_Options` silently dropped one of them; see
   `DECISIONS.md`). Sequential `await` calls are safe.
5. `withErrors()` (`lib/api.ts`) wraps every handler so a thrown error becomes a clean
   JSON 500 instead of crashing the client's `.json()` parse.

## Where to look for more

- [`DECISIONS.md`](DECISIONS.md) — why each rule above exists, open questions for the
  business owner, and a log of real incidents.
- [`../README.md`](../README.md) — local setup, scripts, deployment.
- [`../TEST-CASES.md`](../TEST-CASES.md) / [`../TESTING.md`](../TESTING.md) — worked
  examples with exact numbers, safe to run against `TEST`-prefixed contacts.
- [`../CONTEXT.md`](../CONTEXT.md) / [`../PRD.md`](../PRD.md) — the original planning
  handoff and short spec (useful for *intent*, but this file and `DECISIONS.md` are
  more current — code has moved on from the original PRD in several places, e.g. Credit
  Notes exist now even though the original PRD marked them out of scope).
