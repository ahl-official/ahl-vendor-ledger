# Manual test guide

A single worked walkthrough that touches every feature, using only the `TEST`-prefixed
contacts so nothing real gets touched. Each step has a copy-pasteable block of exact
field values, then what to expect afterward — if a number doesn't match, something's
broken.

Start clean: run `npm run clear:test-activity` first (wipes Orders/Movements/
Applications/Transfers; contacts are untouched). Do this any time you want to re-run
the guide from zero.

---

## 1. Add a contact

**Contacts → Add contact**
```
Name: TEST Vendor 2
Roles: Vendor
```
Save.

✅ Appears in the table at the bottom.

## 2. Edit a contact

Click **Edit** on `TEST Vendor 2` →
```
Contact / WeChat / Phone: +86 1234567890
```
**Save changes**.

✅ Table shows the new contact info immediately.

## 3. Create an order

**Orders → + New Order**
```
Vendor: TEST Vendor
Invoice ref: TEST-GUIDE-001
Currency: RMB
Description: Test item A
SKU: (leave blank)
Qty: 2
Unit: pcs
Unit price: 50
Shipping fee: 0
Adjustment: 0
```
Save order.

✅ Redirects to the order page: **Total RMB 100.00, Paid RMB 0.00, Due RMB 100.00**.

## 4. Pay it in full — "Order only"

**Record Money**
```
Flow: Company → Vendor (direct payment)
Payer: Vinitt Company
Payee: TEST Vendor
Amount: 100
Currency: RMB
Vendor payment use: Order only
Order: TEST-GUIDE-001 — due 100.00
Method: bank
```
Save.

✅ Reopen the order (Orders → TEST-GUIDE-001): **Paid 100.00, Due 0.00**.

## 5. Pay on-account (no order)

**Record Money**
```
Flow: Company → Vendor (direct payment)
Payer: Vinitt Company
Payee: TEST Vendor
Amount: 50
Currency: RMB
Vendor payment use: On-account only
Method: bank
```
Save.

✅ **Ledger** page → TEST Vendor now shows **RMB 50.00** held.

## 6. Second order, paid "Order + on-account"

**Orders → New Order**
```
Vendor: TEST Vendor
Invoice ref: TEST-GUIDE-002
Currency: RMB
Description: Test item B
Qty: 1
Unit: pcs
Unit price: 30
```
Save (due 30).

**Record Money**
```
Flow: Company → Vendor (direct payment)
Payer: Vinitt Company
Payee: TEST Vendor
Amount: 100
Currency: RMB
Vendor payment use: Order + on-account
Order: TEST-GUIDE-002 — due 30.00
Applied to this order: 30
Method: bank
```
Preview should read: *"RMB 100.00 received → 30.00 to order, 70.00 held"*. Save.

✅ TEST-GUIDE-002 is now Due 0.00. Ledger → TEST Vendor held = 50 + 70 = **RMB 120.00**.

## 7. Agent funding (Company → Agent)

**Record Money**
```
Flow: Company → Agent (INR funding sent)
Payer: Vinitt Company
Payee: TEST Agent
Amount: 1000
Currency: INR
Actual / reference rate: 15
Agent's quoted rate: 14.5
Method: bank
```
Save.

✅ Ledger → TEST Agent shows **Holds INR 1000.00**.

## 8. Agent pays vendor (and the "reverse" case in the same step)

**Record Money**
```
Flow: Agent → Vendor (agent pays vendor)
Payer: TEST Agent
Payee: TEST Vendor
Amount: 60
Currency: RMB
Vendor payment use: On-account only
Method: wechat
```
Save.

✅ Ledger → TEST Vendor held = 120 + 60 = **RMB 180.00**.
✅ Ledger → TEST Agent now shows **two lines**: `Holds INR 1000.00` *and* `Company owes RMB 60.00`.

This is the "agent fronts money, company owes" case from the audio — it happens automatically whenever an agent pays out in a currency it was never funded in. Positions are never netted across currencies (CONTEXT.md's rule).

## 9. Agent returns money to company

**Record Money**
```
Flow: Agent → Company (RMB returned)
Payer: TEST Agent
Payee: Vinitt Company
Amount: 200
Currency: INR
Method: bank
```
Save. (Returning INR here to settle part of the funding from step 7.)

✅ Ledger → TEST Agent: `Holds INR 800.00` (1000 − 200), `Company owes RMB 60.00` unchanged.

## 10. Use Vendor Balance — Apply to Order

**Orders → New Order**
```
Vendor: TEST Vendor
Invoice ref: TEST-GUIDE-003
Currency: RMB
Description: Test item C
Qty: 1
Unit: pcs
Unit price: 40
```
Save (due 40).

**Use Balance**
```
Vendor: TEST Vendor
Held balance to spend: (pick whichever shows the most remaining)
Action: Apply to Order
Order: TEST-GUIDE-003 — due 40.00
Amount: 40
```
Save.

✅ TEST-GUIDE-003 is Due 0.00. Ledger → TEST Vendor held = 180 − 40 = **RMB 140.00**.

## 11. Use Vendor Balance — Transfer to Vendor

**Use Balance**
```
Vendor: TEST Vendor
Held balance to spend: (pick a receipt with ≥ 20 remaining)
Action: Transfer to Vendor
Transfer to vendor: TEST Vendor 2
Receiving vendor's order: No order — just add to held balance
Amount: 20
```
Save.

✅ Ledger → TEST Vendor held = 140 − 20 = **RMB 120.00**. `TEST Vendor 2` now holds **RMB 20.00**.

## 12. Use Vendor Balance — Pay Supplier

**Use Balance**
```
Vendor: TEST Vendor
Held balance to spend: (pick a receipt with ≥ 15 remaining)
Action: Pay Supplier
Pay supplier: TEST Supplier
Amount: 15
```
Save.

✅ Ledger → TEST Vendor held = 120 − 15 = **RMB 105.00**.

## 13. Use Vendor Balance — Refund

**Use Balance**
```
Vendor: TEST Vendor
Held balance to spend: (pick a receipt with ≥ 10 remaining)
Action: Refund
Amount: 10
```
Save.

✅ Ledger → TEST Vendor held = 105 − 10 = **RMB 95.00**. (If it still shows 105, the refund didn't subtract — that exact bug happened once before; see `lib/ledger.ts` `vendorHeld`.)

## 14. Final numbers to check on the Ledger page

| Contact | Expected |
|---|---|
| TEST Vendor | RMB 95.00 held |
| TEST Vendor 2 | RMB 20.00 held |
| TEST Agent | Holds INR 800.00 · Company owes RMB 60.00 |
| TEST-GUIDE-001 | Due 0.00 |
| TEST-GUIDE-002 | Due 0.00 |
| TEST-GUIDE-003 | Due 0.00 |

If every one of those matches, the whole payment engine — receipts, applications,
transfers, agent positions — is working correctly end to end.

## 15. Clean up

```bash
npm run clear:test-activity
```

Wipes all orders/movements/applications/transfers so you start the next test run from
zero. `TEST Vendor 2` stays in Contacts (no delete-contact feature yet) — harmless to
leave, or remove it manually from the `Contacts` tab in the Sheet.

---

## 16. Full walkthrough — every Record Money + Use Balance case in one run

Covers everything discussed for V1: Company↔Agent, Agent→Vendor in all 3 payment-use
patterns, a vendor-to-vendor transfer in all 3 patterns, applying a vendor's own held
balance to a new order, Pay Supplier, and Refund.

**Setup already done for you** (orders + the first funding step), so you can start
straight on step 1 below:

| Order | Vendor | Due |
|---|---|---|
| TEST-GUIDE-O1 | TEST Vendor | RMB 3,000 |
| TEST-GUIDE-O2 | TEST Vendor | RMB 1,500 |
| TEST-GUIDE-O3 | TEST Vendor | RMB 1,200 |
| TEST-GUIDE-O4 | TEST Vendor 2 | RMB 2,000 |
| TEST-GUIDE-O5 | TEST Vendor 2 | RMB 1,000 |

**Step 0 (already done):** Company → Agent, INR 100,000, so TEST Agent already has
funding to work with.

### Step 1 — Agent → Vendor, Order + on-account

**Record Money → Flow: Agent → Vendor**
```
Payer: TEST Agent
Payee: TEST Vendor
Amount: 4000   Currency: RMB
Vendor payment use: Order + on-account
  Order: TEST-GUIDE-O1 (due 3000)
  Applied to this order: 3000
```
✅ TEST-GUIDE-O1 due becomes **0**. TEST Vendor now holds **RMB 1,000**.

### Step 2 — Agent → Vendor, Order only

```
Payer: TEST Agent
Payee: TEST Vendor
Amount: 1500   Currency: RMB
Vendor payment use: Order only
  Order: TEST-GUIDE-O2 (due 1500)
```
✅ TEST-GUIDE-O2 due becomes **0**.

### Step 3 — Agent → Vendor, On-account only

```
Payer: TEST Agent
Payee: TEST Vendor
Amount: 6000   Currency: RMB
Vendor payment use: On-account only
```
✅ TEST Vendor's held balance is now **RMB 7,000** (the 1,000 from step 1 + this 6,000).

### Step 4 — Agent → Company (RMB returned)

```
Flow: Agent → Company
Payer: TEST Agent
Payee: Vinitt Company
Amount: 2000   Currency: RMB
```
✅ Standalone cash event — doesn't touch any vendor or order. Check it on the Ledger
page under TEST Agent's position.

### Step 5 — Use Balance → Apply to Order

A vendor's own held money paying a *new* order from that same vendor.

**Use Balance**
```
Vendor: TEST Vendor
Held balance to spend: pick either open receipt (1,000 or 6,000)
Action: Apply to Order
Order: TEST-GUIDE-O3 (due 1200)
Amount: 1200
```
✅ TEST-GUIDE-O3 due becomes **0**. TEST Vendor's total held drops to **RMB 5,800**.

### Step 6 — Use Balance → Transfer to Vendor, Order only

Vendor A's held money pays straight into Vendor B's order.

```
Vendor: TEST Vendor
Held balance to spend: pick a receipt with enough remaining
Action: Transfer to Vendor
Transfer to vendor: TEST Vendor 2
What the receiving vendor does with it: Order only
Receiving vendor's order: TEST-GUIDE-O4 (due 2000)
Amount: 2000
```
✅ TEST-GUIDE-O4 due becomes **0**. TEST Vendor 2's held balance is still **0** — the
whole amount went straight to the order, none of it sits as held balance.
TEST Vendor's held drops to **RMB 3,800**.

### Step 7 — Use Balance → Transfer to Vendor, On-account only

```
Vendor: TEST Vendor → Transfer to Vendor: TEST Vendor 2
What the receiving vendor does with it: On-account only
Amount: 500
```
✅ TEST Vendor 2 now holds **RMB 500**. TEST Vendor's held drops to **RMB 3,300**.

### Step 8 — Use Balance → Transfer to Vendor, Order + on-account (the split)

The case that needed a real fix: part of one transfer pays an order, the rest sits
on the receiving vendor's account — in one action, not two.

```
Vendor: TEST Vendor → Transfer to Vendor: TEST Vendor 2
What the receiving vendor does with it: Order + on-account
Receiving vendor's order: TEST-GUIDE-O5 (due 1000)
Applied to this order: 1000
Amount: 1500
```
✅ TEST-GUIDE-O5 due becomes **0**. TEST Vendor 2's held balance rises to **RMB
1,000** (the 500 from step 7 + the 500 on-account portion of this transfer — the
1,000 order portion correctly does **not** also count as held). TEST Vendor's held
drops to **RMB 1,800**.

### Step 9 — Use Balance → Pay Supplier

```
Vendor: TEST Vendor → Action: Pay Supplier
Pay supplier: TEST Supplier
Amount: 300
```
✅ TEST Vendor's held drops to **RMB 1,500**. No held balance is created for the
supplier — that money has left the system.

### Step 10 — Use Balance → Refund

```
Vendor: TEST Vendor → Action: Refund
Amount: 1500 (whatever's left)
```
✅ TEST Vendor's held balance finishes at **RMB 0**.

### Final check — Ledger page

| Who | Should show |
|---|---|
| TEST Vendor | RMB 0 held |
| TEST Vendor 2 | RMB 1,000 held |
| TEST-GUIDE-O1 through O5 | Due 0 on all five |
| TEST Agent | Holds INR 100,000, minus whatever RMB equivalent left via step 4 |

If every number above matches, every case discussed — Company↔Agent in either order,
Agent→Vendor in all 3 patterns, Agent→Company, and vendor-to-vendor transfer in all
3 patterns including the new split — is confirmed working end to end.

Clean up afterward with `npm run clear:test-activity` (step 15 above) whenever you
want to run this from zero again.
