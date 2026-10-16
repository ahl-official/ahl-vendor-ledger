# AHL Vendor Ledger V1 — PRD

One-line goal: track every rupee/RMB that moves between Company, Agents, and Vendors — who was paid, how much hit an order, how much is still sitting with someone — without anyone needing to understand "routing."

## 1. The four money flows (confirmed from audio)

```
A) Direct company payment
   Vinitt Company ───RMB/USD/INR───▶ Vendor

B) Agent pays vendor directly
   Vinitt Company ──INR──▶ Agent ──RMB──▶ Vendor

C) Agent returns money, company pays vendor
   Vinitt Company ──INR──▶ Agent ──RMB──▶ Vinitt Company ──RMB──▶ Vendor

D) Agent fronts money first, company owes agent (reverse)
   Agent ──RMB──▶ Vendor  (agent's own money, used first)
   Agent ──(outstanding owed)──▶ Vinitt Company   ← company must settle this later
```

Every arrow above = one row in Money_Movements. The app never invents an arrow — each one is entered only when real money actually moved. A's running position (owes company / owed by company) is just a signed total of their arrows, shown with a clear label, not a number that could mean either direction.

## 2. Agent charges (can combine)

Three independent toggles, all optional, shown on the same screen:
- **Extra fee** — a flat/percentage charge the agent takes, entered separately.
- **Rate markup** — agent's quoted INR→RMB rate differs from the real/reference rate; both rates are shown side by side, the spread is implicit, never re-charged as a fee.
- **Both** — fee AND markup can apply to the same transfer; they are two separate fields, never merged into one number.

## 3. Vendor payment — 3 ways (pick one every time)

```
Order only        → full amount applied to order(s)
On-account only    → full amount held by vendor, no order
Order + on-account → split: part to order(s), remainder held
```

Worked example (from audio): Vinitt pays Emida RMB 100 → RMB 25 open order exists → user applies RMB 25 to the order → RMB 75 stays held by Emida. Screen shows **before → applied → after** so this is never mental math.

Later, that RMB 75 can: apply to a new order, transfer to another vendor, pay an external supplier, or get refunded — each is a *new* traceable entry, never an edit to the original RMB 100 receipt.

## 4. Create Order (matches the sample invoice)

```
Order header: Vendor · Invoice/PO ref · Date · Currency · Notes/proof
   ↓
Line items (as many as needed):
   Product · Spec (texture/quality/length/weight/color — one free "description" field) ·
   SKU (optional) · Qty · Unit · Unit Price · Line Total (calculated)
   ↓
+ Shipping fee (optional)  →  Order Total (calculated, never typed)
```
"Save order" never records a payment — payment is always a separate step (flow A–D above), so paid/due stays accurate.

## 5. Ledger / tracking (what every user actually opens)

- **Vendor card**: received, applied to orders, transferred/paid onward, refunded, currently held — per currency.
- **Order card**: total, paid, due.
- **Agent card**: INR sent, RMB delivered/paid, actual vs quoted rate, fees, and a plain-language running position ("Company owes Harni ₹X" / "Harni holds ₹X advance").
- All entries sort by **transaction date**, not entry date (explicitly called out in the audio — a 10th-dated entry must show above an 11th-dated one even if typed in later).
- Every number is clickable → opens the source entries behind it.

## 6. Add new Vendor / Supplier / Agent

One directory, one form, roles = Vendor / Supplier / Agent / Company (multi-select — e.g. Mao Nini is Vendor + Agent on one contact). Fields: name, role(s), contact/WeChat/phone, notes, active flag. Available inline from the order/payment screens too, so no one has to leave the flow to add a missing name.

## 7. Explicitly out of scope for V1 (per your call)

- Vendor↔vendor goods/raw-material barter (non-cash settlement) — revisit after the cash flow is solid.
- Credit notes / returns — revisit after the cash flow is solid.

## 8. Stack

Next.js (UI + server-only API routes) · Google Sheet as the DB. Reads/writes go through a server-side service account; Apps Script stays available as a secondary path (e.g. a bound script for triggers/notifications) but the service account is the primary write path so there's one source of truth for auth. No Sheet credentials ever reach the browser.

## 9. Still need from you before coding starts

1. Opening balances: start every vendor/agent at zero, or migrate signed-off opening balances from the current ledger?
2. Which Drive folder/account owns the new Sheet?
3. Confirm: both operating users (Accounts, Purchase) can create contacts/orders/payments freely, other user just gets notified — still correct?
