# Test cases — one at a time

Run against the live site. Use only `TEST Vendor` / `TEST Agent` / `TEST Supplier` /
`Vinitt Company` so nothing real gets touched. Check the **Ledger** page after each
case to confirm the number. Reset anytime with `npm run clear:test-activity`.

---

## Case 1 — Company sends money to a vendor, through an agent, on-account

The current app has no direct Company→Vendor payment — money to a vendor always goes
through an agent. So "send money to TEST Vendor via TEST Agent, on-account" is two
real cash events: the company funds the agent, then the agent pays the vendor.

### Step 1 — Company funds the agent

**Record Money**
```
Flow: Company → Agent (INR funding sent)
Payer: Vinitt Company
Payee: TEST Agent
Amount: 5000
Currency: RMB
Actual / reference rate: (leave blank — same currency, no FX here)
Agent's quoted rate: (leave blank)
Method: Bank
```
Save.

✅ **Ledger** → TEST Agent shows **Holds RMB 5000.00**.

### Step 2 — Agent pays the vendor, on-account (no order)

**Record Money**
```
Flow: Agent → Vendor (agent pays vendor)
Payer: TEST Agent
Payee: TEST Vendor
Amount: 5000
Currency: RMB
Vendor payment use: On-account only
Method: Bank
```
Save.

✅ **Ledger** → TEST Vendor shows **RMB 5000.00** held (nothing applied to any order —
"on-account" means it just sits with the vendor until you choose to use it later via
Use Balance).
✅ **Ledger** → TEST Agent goes back to **Settled** (funded 5000, paid out 5000, net 0).

### Why this is correct

- The vendor never has an order yet, so there was nothing to apply the payment to —
  that's exactly what "on-account" is for.
- If the agent had paid the vendor *before* being funded, TEST Agent would instead show
  "Company owes RMB 5000.00" — the app never assumes funding happened, only real
  entered movements count.
- TEST Vendor's RMB 5000 is not gone — it's reusable later: open **Use Balance**, pick
  TEST Vendor, pick this held receipt, and you can Apply it to a future order, Transfer
  it to another vendor, Pay a supplier with it, or Refund it.

---

Give me the next case whenever you're ready and I'll add it here as **Case 2**.
