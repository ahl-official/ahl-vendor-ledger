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

### 4. A "receipt" is only `AgentToVendor`.

There is no direct `CompanyToVendor` movement type — the vendor is always paid through
an agent (`lib/ledger.ts` → `isReceipt()`). Only `AgentToVendor` movements can be
applied to an order, held on-account, or spent later via Use Vendor Balance. If you add
a new way for a vendor to receive money, you must decide whether it's a true "receipt"
(and thus should flow through `isReceipt()`/`vendorOpenReceipts()`) or something else
entirely (like a `Transfer` or `Credit_Notes` row, which are *separate* mechanisms — see
rule 5).

### 5. "Held balance" has THREE different sources — know which functions see which.

A vendor's displayed `vendorHeld()` total is the sum of:
- **Receipts** (`AgentToVendor` movements) — tracked individually, with their own
  `remaining` via `movementRemaining()` / `vendorOpenReceipts()`.
- **Transfers in** (`purpose: "Transfer"`, `toContactId` = this vendor) — another
  vendor sent part of their held balance here.
- **Credit notes** (`Credit_Notes` rows for this vendor) — issued against a return.

**`vendorOpenReceipts()` / `movementRemaining()` only see the first bucket** (original
receipt movements with their own `movementId`). Transfers-in and credit-notes-in have
no `movementId` of their own — they're not "receipts" in that sense.

**This is the most dangerous trap in the codebase.** Any code path that needs to *spend*
a vendor's balance (Use Vendor Balance, or a "spend from total held balance" shortcut)
must decide up front whether it's spending from one specific receipt (fine — use
`movementRemaining()`), or from the vendor's *aggregate* `vendorHeld()` total. If it
validates against the aggregate total but then tries to find the money by walking
`vendorOpenReceipts()`, **it will come up short whenever any of that balance came from
a Transfer-in or a Credit Note** — because those never show up in that list. Before
trusting (or writing) any "spend from total balance" feature, trace exactly which
sub-total it validates against and which sub-total it draws the money from. They must
match, or you need a FIFO/allocation step that also accounts for transfers-in and
credit-notes-in as separate "sources," not just receipts.

### 6. Money math changes need a live test, not just a build pass.

A clean `npm run build` only proves the TypeScript compiles — it proves nothing about
whether the dollars (or RMB) add up. Any change to `lib/ledger.ts`, or to a route in
`app/api/*` that appends/voids a financial row, must be verified against the real Sheet
(or a `TEST`-prefixed sandbox — see `TEST-CASES.md`) with a before/after number check,
not just "it didn't crash." Several real bugs in this project's history looked correct
in code review and were only caught by actually running the numbers (see
`DECISIONS.md`).

## Data model

Six financial tabs, plus `Contacts`, `Orders`/`Order_Items`, and `Custom_Options`
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

Every financial row (all tables except `Custom_Options` and `Contacts`) has
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
