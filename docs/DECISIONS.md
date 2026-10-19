# Decisions, rationale, and incident log

Why the rules in [`ARCHITECTURE.md`](ARCHITECTURE.md) exist, plus a running log of real
mistakes this project has already made — so the next person (human or AI) doesn't repeat
them. Add to this file whenever a non-obvious decision is made or a real bug is found and
fixed; don't just fix silently and move on.

## Why append-only, never edit/delete financial rows

A shared Google Sheet has no transactions and no row-level locking. Two people can have
the ledger open at once. If a row can be silently edited or deleted, there is no way to
answer "what did this actually say an hour ago, and who changed it?" — which is exactly
the question that comes up when a number looks wrong. Append-only + a `reversed` flag
means the full history is always in the sheet, visible, and attributable.

**Real incident (confirmed and fixed, see 2026-10-19 below):** an agent working on this
codebase added `DELETE` endpoints for `Money_Movements`, `Applications`, `Transfers`,
and `Credit_Notes` (via a new `deleteRowsByField` in `lib/sheets.ts`), wired to real
"delete" and "edit" buttons in the UI — including `Money_Movements` DELETE cascading
into hard-deleting any Applications/Transfers that referenced it. Removed; `PATCH`
(void) is now the only correction path for all four tables.

## Why balances are computed live, never cached

CONTEXT.md (the original planning doc) explicitly considered a `Ledger_Summary` tab for
cached totals and rejected it. A cached total drifts the moment it's wrong once — and
with no transactions, "wrong once" happens. Computing from source rows on every read
means the numbers are provably correct as long as the *functions* are correct, which is
a much smaller thing to get right and keep right.

## Why currencies are never netted

From the real audio/business context this app was built from: Vinitt Company funds an
agent in INR, the agent converts and pays a vendor in RMB. The *real* exchange rate used
is often not the quoted one, and sometimes the agent fronts their own money before being
reimbursed. If the app guessed "INR 75,000 in ≈ RMB 4,838 out" automatically, it would
be inventing a number nobody confirmed. Keeping INR and RMB as separate, un-netted
figures — and requiring an explicit **Agent FX Conversion** to link them — means every
number on screen traces back to a real, confirmed event. See `app/agent-fx/page.tsx` and
its explanation text.

## Why there's no direct Company→Vendor payment

Confirmed business rule (16 Oct 2026): the vendor is always paid through an agent. This
replaced an earlier version of the app that did support direct Company→Vendor payments
— if you're an agent reading old code, tests, or docs that mention `CompanyToVendor`,
that path no longer exists. `MOVEMENT_TYPES` in `lib/schema.ts` is the source of truth.

## Incident log

### 2026-10-17 — Parallel `appendRow` calls silently dropped data

**What happened:** `app/api/movements/route.ts` registered new "Other" dropdown values
for both the Reference and Method fields using `Promise.all([registerOptionIfNew(...),
registerOptionIfNew(...)])`. Both calls appended to the same `Custom_Options` tab at
nearly the same time. Verified live: entering a brand-new Method *and* a brand-new
Reference in the same request resulted in only the Method value being saved — the
Reference value vanished with no error.

**Why:** the Sheets API's `values.append` has no cross-call locking. Two near-simultaneous
append calls to the same tab can both compute "insert after the last row" before either
write is visible to the other, and one write wins.

**Fix:** sequential `await` instead of `Promise.all` for same-tab appends. Verified live
after the fix: both values persisted correctly on the next call.

**Lesson:** never run two `appendRow()` calls to the same sheet tab concurrently,
anywhere in this codebase, even if they look independent.

### 2026-10-16 — Refund transfer double-counted into vendor's own held balance

**What happened:** a refund's `toContactId` was being set to the *refunding vendor's own
ID* (as a placeholder "where did the money go"), and `vendorHeld()`'s "transfers in"
calculation counted *any* transfer whose `toContactId` matched the vendor — including
the vendor's own refund-out row. The refund's `-amount` (transfersOut) and the same
row's `+amount` (transfersIn, because toContactId happened to equal the vendor) canceled
out, so a refund appeared to change nothing.

**Fix:** `vendorHeld()`'s `transfersIn` now only counts `purpose === "Transfer"` rows
(real vendor-to-vendor transfers), never `Refund` or `PaySupplier`. A refund's
`toContactId` is informational only (who the money conceptually went back to) and must
never be set to the refunding vendor itself.

**Lesson:** when a field is dual-purpose ("who received this" vs. "where this is filed
for display"), a generic aggregation function that reads that field can accidentally
treat the two meanings the same way. Be explicit about which `purpose`/`type` values a
balance calculation should include.

### 2026-10-19 — Review of a large external change set

A separate agent/session made 14 commits adding Credit Notes, order edit/delete,
payment unlinking, a "spend from vendor's total held balance" shortcut, a rewritten
Ledger page, and file upload to Google Drive — without having read this doc (it didn't
exist yet) or the project's established invariants. A review was run against the rules
in `ARCHITECTURE.md`. Findings:

**1. (Severity: high, fixed) Real hard-delete buttons wired into the UI, destroying the
audit trail.** A new `deleteRowsByField` in `lib/sheets.ts` did a genuine
`deleteDimension` batch update — the row was gone from the sheet forever. It was wired
to: the Ledger page's per-row delete icon (`handleDeleteTransaction`, confirm text
literally said "This action cannot be undone"); the order page's credit-note delete
button; and — worst — the "Edit" flows on Record Money and Use Vendor Balance, which
*looked* like an edit but actually deleted the original row with zero trace before
inserting the replacement. `DELETE /api/movements/[id]` additionally cascaded into
hard-deleting every `Applications`/`Transfers` row that referenced it. **Fix:** removed
every `DELETE` export from the four financial `[id]` routes; `PATCH` (void) is now the
only correction path, matching rule 1. The Ledger/order "delete" buttons now call PATCH
and the confirm text says the row stays visible, struck-through.

**2. (Severity: high, fixed) Voiding a movement no longer cascaded to its Application —
re-introduced during the fix above.** Once the hard-delete cascade was removed, voiding
a movement that had been applied to an order left the old `Applications` row `active:
true`, so an edited order-linked payment would double-count (old Application + new
Application both counting toward the order's paid total). **Fix:** `PATCH
/api/movements/[id]` now also voids (sets `active: false`) any Applications still
pointing at it, server-side, so every caller gets this for free. **Verified live:** paid
an order in full (due → 0), voided the movement, order correctly went back to due 500 —
no double-count.

**3. (Severity: high, fixed) "Spend from vendor's total held balance" could silently
move less money than requested while reporting success.** `vendorHeld()` sums receipts +
transfers-in + credit-notes-in; `vendorOpenReceipts()` (what the FIFO spender actually
draws from) only sees original receipt movements — transfers-in and credit-notes-in have
no `movementId` of their own and are invisible to it. The code validated the requested
amount against `vendorHeld()` (the bigger number) but spent from `vendorOpenReceipts()`
(the smaller one), and never checked afterward whether it had actually covered the full
amount. **Concrete failure, verified live:** a vendor with RMB 5,800 in real receipts
plus a RMB 1,000 credit note (RMB 6,800 total held) — requesting a RMB 6,800 transfer
used to silently create transfers summing to only 5,800 and return success, losing 1,000
RMB of value with no record of where it went. **Fix:** added an explicit check before
writing anything: if open receipts can't cover the request, fail with a clear error
naming exactly how much is/isn't available, instead of silently under-spending.
**Verified live** both the failure case (clean error) and that a legitimate amount still
succeeds. Note this doesn't add the ability to *actually* re-spend transfer-in/credit-
note money through this screen — that's a real feature gap, just no longer a silent one.

**4. (Severity: high, fixed) Ledger overview's agent card collapsed per-currency
positions into one guessed RMB number — violated the "never netted" invariant.** A new
ad hoc `agentRmbBalance()` function converted every movement into a synthetic RMB figure
using the funding's own rate (with no agreed convention for which direction to divide
vs. multiply), silently dropping any leg with no rate and no matching FX conversion. The
underlying `agentPosition()` in `lib/ledger.ts` was untouched and still correct — the
regression was entirely a UI function bypassing it. **Fix:** the card now renders
`a.position` directly (the real per-currency data the API already returns), same pattern
as the per-contact Agent lookup view. Dead function removed.

**5. (Severity: low, documented not fixed) Reversed Applications/Transfers can
reference a deleted order.** Order deletion blocks when the order has active payments or
active credit notes, but doesn't check already-reversed ones — deleting an order can
leave voided Applications/Transfers pointing at a nonexistent `orderId`. Confirmed inert
today (every balance function filters on `!reversed`/`.active` first), but a future
feature that doesn't filter that way could be bitten by it. Not fixed — low risk, real
fix would mean either blocking delete on *any* historical reference or cascading the
void, and neither was worth doing under time pressure for a dormant risk.

**6. (Severity: none, confirmed fine) Order-edit's full item-replace, Credit Note
vendor-id derivation, Credit Note reversal, and `deleteRowsByField`'s row-index math**
were all checked and are correct. `Order_Items` replace-on-edit isn't referenced by id
from any other table, so wholesale replacement has no referential-integrity fallout.
Credit Note `vendorId` is always derived server-side from the order, never client input.
Reversing a credit note is idempotent and both `orderSummary()`/`vendorHeld()` drop it
correctly. `deleteRowsByField` itself (still used for `Order_Items` replace, and
available for non-financial cleanup) has no off-by-one.

**7. (Severity: none, documented) "Refund" was removed from the Use Vendor Balance UI**
in favor of Credit Notes. The API path (`purpose: "Refund"`) still exists and works —
unreachable from the UI now, not a bug, just unreferenced code. Left as-is; a future
cleanup could remove it or repoint it.

**8. (Severity: low, fixed) Three smaller gaps found while fixing the above.** The Agent
FX nav link had been silently dropped from `app/components/Nav.tsx` even though the page
and API still worked — restored. `Credit_Notes` was missing from `npm run
clear:test-activity`'s table list (added, after it caused this review's own test data to
linger). And `GOOGLE_DRIVE_FOLDER_ID` was never set anywhere, breaking the proof-upload
feature entirely (`File upload is not set up: GOOGLE_DRIVE_FOLDER_ID is missing`) —
created the folder (`npm run setup:upload-folder`) and wrote the env var locally; **you
must add the same `GOOGLE_DRIVE_FOLDER_ID` to Vercel's project env vars** for uploads to
work in production, local `.env.local` only covers local dev.

## Open questions for the business owner (unchanged from original PRD)

1. **Opening balances** — every vendor/agent still starts at zero. Real historical
   balances from the old ledger have never been migrated (and shouldn't be, without
   signed-off figures — see `CONTEXT.md`).
2. **Review-separately contacts** — Faye, MS DU, MS Huang, 润驰耐丝 — roles still
   unconfirmed.
3. Both operating users (Accounts, Purchase) getting free create access, per
   `CONTEXT.md` — there is still no authentication/login system in this app at all.
   Anyone with the URL has full read/write access.
