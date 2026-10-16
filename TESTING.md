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
