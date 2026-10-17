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

### Why TEST Agent shows two lines, not one settled number — read this if it looks wrong

This is the exact point you flagged. The app records the INR funding and the RMB
payout as two **separate, independent events** — it never calculates one from the
other, and it never nets INR against RMB. So after both steps:

- The **INR 75,000** funding is still sitting there, untouched on paper, because
  nothing in the system ever told it "this INR became that RMB."
- The **RMB 4,800** payout shows as "company owes" because, in isolation, the agent
  spent RMB it was never directly funded in.

In reality these two numbers *are* connected (the INR funded the RMB payout), but V1
has no explicit "FX conversion" event linking a funding to a payout — CONTEXT.md's
rule is *"INR and RMB balances are never netted without an explicit FX deal,"* and V1
never built that explicit FX deal step. The `actualRate` / `quotedRate` fields you
entered in Step 1 are stored for audit (so you can see the spread later) but nothing
reads them to auto-settle the INR side.

**This is a real gap worth a decision, not a bug to silently "fix":** do you want V1
to keep showing both currencies separately like this (safest — never assumes a
conversion that wasn't explicitly confirmed), or should there be a way to mark "this
INR funding was converted and spent via that RMB payout" so the agent's position
nets to settled once both legs are recorded? Tell me which and I'll build it.

---

Give me the next case whenever you're ready and I'll add it here as **Case 2**.
