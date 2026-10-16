# AHL Vendor Ledger V1 — context and implementation plan

**Status:** planning handoff only, 15 October 2026. This folder contains no application code. Do not push, deploy, edit, or delete anything in the existing production system as part of this plan.

**Developer handoff:** Read this entire file **and** `THEME_AND_CONTACT_SEED.txt` before starting a new project. The TXT file fixes the old application's visual palette and lists every name currently found in the old Vendors tab, with real vendors separated from special/test entries. Use both files as planning input; neither authorizes changes to the existing production app or Sheet.

## 1. Goal and boundary

Build a **new, much simpler** China/Mexico vendor-payment and order ledger. Use **Next.js** for the application and **one new Google Sheet as the V1 database**. Keep the visual character of the old app (warm off-white, black borders, amber accent, monospaced headings) with clearer status colors and plain-language labels. This is a separate project, not an in-place rewrite of the existing Apps Script app.

V1 must answer, for every currency separately: **What was ordered? Who actually paid whom? How much of each payment paid an order? How much money is still held by each vendor? Where was it transferred?** Users must not need to understand “route,” “allocation,” or “link advance” to complete routine work.

The existing [production Master Database](https://docs.google.com/spreadsheets/d/12Z4mYdEaRqmPsz413IAW_twCs1OPWIMEXNNrI6f95O8/edit) is a **read-only reference for planning and seed data**. Do not connect the new app to it for writes. Do not copy live balances blindly or post old transactions again.

## 2. Confirmed business rules

- Two operating users: Accounts (`accounts2@americanhairline.com`) and Purchase (`americanhairline9@gmail.com`); Admin (`ai@americanhairline.com`). Previously agreed: both operating users may create contacts, orders, and real payment entries; the other user is notified, not asked to approve. Reconfirm before release.
- A payment is entered **only after money actually moves**. A planned order or agent instruction is not a cash transaction.
- Three vendor-payment uses, selected explicitly each time:
  1. **Order only:** the full payment is applied to one or more orders.
  2. **On-account only:** no order is required; the vendor holds the full amount for future use.
  3. **Order + on-account:** an entered portion pays order(s); the remainder is held by the vendor.
- A vendor's held amount can later pay a new/existing order, be transferred to another vendor, be paid onward to an external supplier, or be refunded. Later use creates a **new auditable application/transfer**, not an edit to the original payment.
- A vendor→vendor transfer reduces the sender's held balance and increases the receiver's held balance; it may optionally apply to a receiver's order. Vendor→external-supplier payment reduces the sender's held balance and records the supplier payment, but does **not** create a held balance for the outside supplier.
- Orders contain **multiple product rows**: product/description, optional SKU/reference, quantity, unit, unit price, line amount, currency, plus optional shipping/adjustment. Total is calculated; users do not manually retype the same total into payments.
- Both actual/reference FX rate and agent's quoted INR→RMB rate must be visible. A separate fee is entered only if really charged; do not count the rate spread again as commission. INR and RMB balances are never netted without an explicit FX deal.
- Simple status display is desired: “Agent received money” and “Agent paid vendor.” Status comes from posted money events, **not** from a free-editable label. Corrections reverse/void with reason and audit history; they do not silently erase cash records.

## 3. Agent cash path — critical decision before coding

The latest request describes: **Vinitt sends INR to agent → agent converts to RMB → agent gives RMB to Vinitt → Vinitt pays vendor**. Earlier real examples used: **Vinitt sends INR to agent → agent pays vendor directly in RMB**. These are different cash paths and must not be conflated.

Recommended V1 data design can represent both, but show only the confirmed choices in the UI:

| Path | Real money events to record |
|---|---|
| Agent pays vendor directly | Vinitt→agent INR; agent→vendor RMB. |
| Agent returns RMB to company | Vinitt→agent INR; agent→Vinitt RMB; Vinitt→vendor RMB. |
| Direct company payment | Vinitt→vendor RMB/USD/INR; no agent event. |

**Owner confirmation required:** Does V1 need both agent paths, or only one? The phrase “Vinitt company then gives it to agent” appears circular; confirm whether the final recipient is the **vendor**. Never generate the extra RMB handoff automatically without a real transfer.

## 4. V1 user experience (few screens)

1. **Home:** four clear actions — New Order, Record Money Movement, Use Vendor Balance, View Ledger — plus pending tasks. No 20-tab navigation.
2. **Contacts:** one editable contact directory; types are Vendor, Supplier, Agent and Company, with multiple roles allowed for the same person. Required name; contact/WeChat/phone and notes visible and editable. Prefill approved real names below, not E2E tests.
3. **Orders:** choose vendor, invoice/PO reference, date, currency, notes/proof; add as many product lines as needed on the same screen. Calculate line and order totals; show paid/due. Invoice number unique per vendor. “Save order” never records payment.
4. **Record Money Movement:** choose actual payer, recipient, amount, currency, date, method/reference and optional proof. If an agent is involved, capture the INR funding, FX rate/fee and RMB handoff/vendor payout as **separate real events in one simple timeline**. For vendor receipt choose Order only, On-account only or Order + on-account; preview exact paid and held amounts before saving.
5. **Use Vendor Balance:** choose vendor/currency and an existing held-money source; then Apply to Order, Transfer to Vendor, Pay Supplier or Refund. Show “before → change → after” balances. No second cash receipt is created when applying existing funds to an order.
6. **Ledger:** vendor card shows **received, applied to orders, transferred/paid onward, refunded, currently held**; order card shows item total, paid, due; agent card shows INR sent, RMB delivered/paid, actual/quoted rates and fees. Every number opens its source entries.

For routine agent work, users see two plain-language milestones (“Agent received money” and “Agent paid vendor”). “Use an earlier advance” appears only when an unassigned **previously recorded** agent funding exists, and its action merely associates that old funding with a new deal; it must not create another payment.

## 5. V1 database, relationships and accounting

Use **one new Google Sheets workbook** as source of truth, with these tabs (final column schema to be specified before coding):

| Tab | Purpose |
|---|---|
| `Contacts` | Stable contact ID, name, roles, region, contact, notes, active flag, legacy ID. |
| `Orders` | Order ID, vendor ID, invoice/PO number, currency, dates, shipping/adjustment, calculated total, status, proof. |
| `Order_Items` | Item ID, order ID, description/SKU, quantity, unit, unit price, line total. |
| `FX_Deals` | Agent ID, INR funding expectation/actual, actual and quoted rates, separate fee, intended RMB, chosen cash path. |
| `Money_Movements` | One row per **actual** company→agent, agent→company, agent→vendor, company→vendor, vendor→vendor/supplier, or refund event; amount, currency, payer, payee, date, proof, linked deal, status, idempotency key. |
| `Applications` | Separate order applications of an existing vendor receipt, source movement ID, order ID, amount, active/reversed state. |
| `Transfers` | Linked outgoing/incoming vendor transfer or external-supplier payment, source vendor, recipient, currency, proof, purpose, optional receiving order. |
| `Audit_Log` | Who/when/action/before/after/reason, immutable correction trail. |
| `Ledger_Summary` | Human-readable, read-only snapshot of order due and funds held by contact and currency; refreshed from posted source records. |

**Relationships:** one order has many items and many applications; one money movement may feed many applications; an FX deal links its real INR/RMB money movements. Keep immutable IDs and references instead of matching by names. If a contact is both vendor and agent, it is one contact with two roles, not two people.

**Core equations, per currency:**

- `order_total = sum(quantity × unit_price) + shipping + signed adjustment`.
- `order_paid = sum(active applications to that order)`; `order_due = max(0, order_total − order_paid)`.
- `vendor_held = posted money received by vendor + posted transfers in − active order applications − posted transfers/supplier payments out − refunds out`.
- `unapplied_source = posted vendor receipt − its active order applications − its posted onward uses`; never let it go below zero or spend it twice.
- `agent INR position = actual INR sent to agent − INR value of verified RMB delivered/paid and agreed fees`, displayed with a clear direction (“company owes agent” or “agent holds company advance”). Exact settlement convention must be signed off during detailed schema design.

All mutations must validate payer/recipient, currency, nonnegative remainder and order due on the **server**. Use a request/idempotency key to prevent duplicate entries on retries; prevent two users consuming the same held balance concurrently. Never use status-text edits to alter balances.

## 6. Existing names to prefill (read-only seed snapshot, 15 October 2026)

Source: the current Master Database's `Vendors`, `Supplier List` and `Agents` tabs. Import names/roles with legacy IDs for traceability; review spellings and avoid duplicates before activation. **Do not migrate monetary transactions just by importing contacts.**

**Regular vendor names (26):** Nancy (Lord Hair); Harry; Mao Nini (Sally Pu / Saili); Starrose; TR (T.R.); Linda; Drew Silli (Dhruv / Sillee); Zyron; Chau (Yan); Sritan; Jifa; Accessories2; Rachel Runiyasi; Sunny; Jenny Tenlon; Anne; FSM; Vlight; Hi-MO; Ya Xuan; Huang (uniforms); Atop (scissors); Yanny (pedicure); Bao Cheng (trolley/dryers/mirrors/TV); Ling Ling (bedsheets); Emida. Mao Nini is currently also marked as a payment agent; preserve that second role if confirmed.

**External supplier:** Mr. Lucas Zhang. His legacy `Supplier List` row is at row 1001 (blank/false rows above it), so migration must read the actual full used range rather than only the first 100 rows.

**Agents:** HARNI; RAKESH; AMIT.

**Review separately, not automatic regular vendors:** Faye (vendor/payment coordinator); MS DU, MS Huang and 润驰耐丝 (legacy role “Needs Confirmation”); Kevin (receivable/owes company); Vinitt Company (company, not vendor). Exclude `E2E-TEST-20260922 Sunny Supplies`, `Sunny Supplies2` and `Sunny Supplies22` test contacts from production prefill.

## 7. Design, access and speed

- Reuse old app visual tokens: ink `#1c1c1a`, paper `#f6f5f1`, warm accent `#8a5a1f`, line `#ccc9bd`, soft background `#eeece3`. Add labeled semantic states: green = recorded/settled, amber = held/pending, red = overdue/error/reversal, blue = information. Color never carries meaning alone; always show text.
- Next.js UI + **server-only** Google Sheets API access. A service account is an authentication identity for the backend, **not a speed feature by itself**. Do not expose a service-account key or Sheet API credentials in browser code. If hosted on Google Cloud, prefer an attached service account without a downloaded key; otherwise choose secure server-side secret handling. User login/session is separate from the service account.
- For speed: load only the selected screen and bounded rows/columns; paginate histories; batch reads/writes; cache small stable contact/config lists; update only affected ledger summaries; keep image/PDF binaries in Drive, IDs/links in Sheet; measure p50/p95 load and write latency. Do not reread the entire workbook or refresh every report during each form submission.
- Google Sheets API still has per-minute quotas and concurrent-write constraints. A single service account also counts as one API user for quota purposes. V1 is suitable for a small team, but build an adapter so the same business logic can later use a proper database if volume grows.
- No separate duplicate Accounts/Purchase database files in V1; one master workbook and role-specific **app views** reduce synchronization errors. Decide later whether a read-only human-facing export/view Sheet is necessary.
- Keep the new Sheet and attachments in a new restricted Drive folder. Give direct Sheet access only to those who need it; do not use “Anyone with the link = Editor” in production. No plaintext passwords or service-account keys in the Sheet or this repository.

Google references: [Sheets API batching](https://developers.google.com/workspace/sheets/api/guides/batch), [Sheets API usage limits](https://developers.google.com/workspace/sheets/api/limits), [Apps Script performance practices](https://developers.google.com/apps-script/guides/support/best-practices), [service-account credential guidance](https://docs.cloud.google.com/docs/authentication/application-default-credentials).

## 8. Implementation phases for the next developer/AI

1. **Resolve decisions and baseline:** confirm the exact agent RMB path(s), production opening-balance policy, currencies/units, and initial user permissions. Snapshot the old ledger; get written sign-off on any opening balances. Do not import historical payments as new movements.
2. **Detailed schema + examples:** finalize columns, IDs, statuses, proof links, currency rules, correction rules and the three payment-use examples. Create a small test workbook and sample data; verify formulas manually.
3. **Foundation:** separate Next.js project, server-only Sheets/Drive adapter, authenticated role sessions, error handling, audit/idempotency/concurrency controls, selected-page reads and tests. No old-app deployment changes.
4. **Contacts + detailed orders:** prefill approved contact names, deduplicate roles, implement editable contacts and multi-item orders with calculated totals and attachments.
5. **Money + ledger:** implement real money events, agent FX paths, three payment-use choices, held-money application, vendor→vendor and vendor→supplier transfers, reversals, and a simple traceable ledger dashboard.
6. **Speed + release:** measure cold/warm page times; batch/cache/paginate as needed; run both-user end-to-end tests for all three uses and both agent paths, duplicate-click and concurrent-spend tests, and a rollback rehearsal. Deploy only after explicit approval.

## 9. V1 acceptance examples

- A detailed Emida order has 11 item rows totaling RMB 24,377. An **actual** RMB 65,100 vendor receipt can apply RMB 24,000 to that order, leaving RMB 377 order due and RMB 41,100 held; a later RMB 377 application clears the order without a new receipt.
- A vendor holding RMB 41,100 transfers RMB 10,000 to another vendor: sender held becomes RMB 31,100; receiver held increases RMB 10,000; one actual transfer and one linked audit trail, not two unrelated receipts.
- A second, distinct HARNI→Emida payment of RMB 25,309 has its **own** movement/deal. It must never reuse the first payout ID or accidentally pay the same order beyond its outstanding balance.
- Company→agent INR and agent→vendor RMB may occur in either order; the screen shows both real statuses and the rate/fee math without inventing a transaction. If agent→company RMB is confirmed as a path, test that additional real handoff separately.
- Order-only, on-account-only and split payment each reconcile to the same total money received; void/reverse restores exact balances and retains history.

## 10. Decisions still needed from the owner

1. **Agent path:** Does the agent normally pay the vendor directly, return RMB to Vinitt for Vinitt to pay, or must V1 support both? Who is the final recipient in the latest spoken example?
2. **Starting balances:** New project with clean zero balances, or migrate verified open orders/vendor-held/agent balances from the current live ledger as opening entries? Recommendation: only signed-off opening balances, never replay live payments.
3. **Final destination of new files:** Which Google Drive folder/account will own the new master Sheet and attachment folders? This local planning folder is not a production Drive folder.

Everything else above is a **proposed V1 specification**, not evidence that the new project, database or deployment exists yet.
