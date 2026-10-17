# Test cases — one at a time

Run against the live site. Use only `TEST Vendor` / `TEST Agent` / `TEST Supplier` /
`Vinitt Company` so nothing real gets touched. Check the **Ledger** page after each
case to confirm the number. Reset anytime with `npm run clear:test-activity`.

---

## Case 1 — Company sends money to a vendor, through an agent, on-account

The current app has no direct Company→Vendor payment — money to a vendor always goes
through an agent. So "send money to TEST Vendor via TEST Agent, on-account" is two
real cash events: the company funds the agent, then the agent pays the vendor.

### Step 1 — Company funds the agent, in INR

**Record Money**
```
Flow: Company → Agent (INR funding sent)
Payer: Vinitt Company
Payee: TEST Agent
Amount: 75000
Currency: INR
Actual / reference rate: 15
Agent's quoted rate: 15.5
Method: Bank
```
Save.

✅ **Ledger** → TEST Agent shows **Holds INR 75000.00**.

### Step 2 — Agent converts and pays the vendor, in RMB, on-account

The agent now actually hands over RMB to the vendor. Enter the **real RMB amount the
agent actually paid out** — not something the app calculates from the rate above.
```
Flow: Agent → Vendor (agent pays vendor)
Payer: TEST Agent
Payee: TEST Vendor
Amount: 4800
Currency: RMB
Vendor payment use: On-account only
Method: Bank
```
Save.

✅ **Ledger** → TEST Vendor shows **RMB 4800.00** held.
✅ **Ledger** → TEST Agent now shows **two separate lines**: `Holds INR 75000.00` *and*
`Company owes RMB 4800.00`.

### Why TEST Agent shows two lines, not one settled number

The app records the INR funding and the RMB payout as two **separate, independent
events** — it never calculates one from the other, and never nets INR against RMB on
its own. The `actualRate` / `quotedRate` fields from Step 1 are stored for audit only;
nothing reads them to auto-settle the position. This is deliberate (CONTEXT.md: *"INR
and RMB balances are never netted without an explicit FX deal"*) — until you've
explicitly confirmed a conversion, the app won't assume one happened.

### Step 3 — Confirm the conversion (new: **Agent FX** page)

Go to **Agent FX** in the nav.
```
Agent: TEST Agent
Unconverted funding: 2026-10-17 — INR 75000.00 unconverted
Unbacked spend: 2026-10-17 — RMB 4800.00 unbacked (paid TEST Vendor)
From amount: 75000
To amount: 4800
Note: test conversion
```
Both dropdowns auto-fill the amounts with the full remaining balance — edit them down if
you're only confirming a partial conversion. Save.

✅ **Ledger** → TEST Agent now shows **Settled** — both the INR and RMB positions net to
zero, because you explicitly confirmed this funding paid for that payout.

Try linking the same funding again (or more than its remaining amount) — it's
rejected with *"Only 0 of this funding is still unconverted."* Nothing lets you
double-count a conversion.

---

Give me the next case whenever you're ready and I'll add it here as **Case 2**.
