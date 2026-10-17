// Explicitly links an agent's INR (or other-currency) funding to the RMB payout it paid
// for. Never automatic -- see lib/ledger.ts agentPosition for why this exists.
import { NextResponse } from "next/server";
import { getAllData } from "@/lib/data";
import { agentOpenFundings, agentOpenSpends, fundingRemaining, spendUnbacked } from "@/lib/ledger";
import { appendRow, newId } from "@/lib/sheets";
import { withErrors } from "@/lib/api";

export const GET = withErrors(async (req: Request) => {
  const agentId = new URL(req.url).searchParams.get("agentId") ?? "";
  if (!agentId) return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  const d = await getAllData();
  return NextResponse.json({
    openFundings: agentOpenFundings(agentId, d).map((f) => ({
      movementId: f.movement.id, date: f.movement.date, currency: f.movement.currency, remaining: f.remaining,
    })),
    openSpends: agentOpenSpends(agentId, d).map((s) => ({
      movementId: s.movement.id, date: s.movement.date, currency: s.movement.currency,
      type: s.movement.type, payeeId: s.movement.payeeId, remaining: s.remaining,
    })),
  });
});

export const POST = withErrors(async (req: Request) => {
  const body = await req.json();
  const agentId = String(body.agentId ?? "");
  const fundingMovementId = String(body.fundingMovementId ?? "");
  const spendMovementId = String(body.spendMovementId ?? "");
  const fromAmount = Number(body.fromAmount);
  const toAmount = Number(body.toAmount);
  if (!agentId || !fundingMovementId || !spendMovementId) {
    return NextResponse.json({ error: "Agent, funding, and spend are required" }, { status: 400 });
  }
  if (!fromAmount || fromAmount <= 0 || !toAmount || toAmount <= 0) {
    return NextResponse.json({ error: "Both amounts must be greater than 0" }, { status: 400 });
  }

  const d = await getAllData();
  const funding = d.movements.find((m) => m.id === fundingMovementId);
  const spend = d.movements.find((m) => m.id === spendMovementId);
  if (!funding || funding.type !== "CompanyToAgent" || funding.payeeId !== agentId) {
    return NextResponse.json({ error: "Funding movement not found for this agent" }, { status: 404 });
  }
  if (!spend || spend.payerId !== agentId || !(spend.type === "AgentToVendor" || spend.type === "AgentToCompany")) {
    return NextResponse.json({ error: "Spend movement not found for this agent" }, { status: 404 });
  }

  const fundingLeft = fundingRemaining(fundingMovementId, d);
  if (fromAmount - fundingLeft > 0.01) {
    return NextResponse.json({ error: `Only ${fundingLeft} of this funding is still unconverted` }, { status: 400 });
  }
  const spendLeft = spendUnbacked(spendMovementId, d);
  if (toAmount - spendLeft > 0.01) {
    return NextResponse.json({ error: `This spend only has ${spendLeft} still unbacked` }, { status: 400 });
  }

  const id = newId("FXC");
  await appendRow("FX_Conversions", {
    id, agentId, fundingMovementId, spendMovementId,
    fromCurrency: funding.currency, fromAmount, toCurrency: spend.currency, toAmount,
    note: body.note ?? "", reversed: false, reversedReason: "", createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ id });
});
