import { NextResponse } from "next/server";
import { getAllData } from "@/lib/data";
import { agentPosition, orderSummary, vendorHeld, vendorOpenReceipts } from "@/lib/ledger";
import { withErrors } from "@/lib/api";

export const GET = withErrors(async () => {
  const d = await getAllData();
  const { contacts, orders, movements, applications, transfers, fxConversions } = d;

  const currencies = Array.from(new Set([...orders.map((o) => o.currency), ...movements.map((m) => m.currency)]));

  const vendors = contacts
    .filter((c) => c.roles.includes("Vendor"))
    .map((v) => ({
      ...v,
      held: Object.fromEntries(currencies.map((cur) => [cur, vendorHeld(v.id, cur, d)])),
      openReceipts: vendorOpenReceipts(v.id, d).map((r) => ({ movementId: r.movement.id, date: r.movement.date, currency: r.movement.currency, remaining: r.remaining })),
    }));

  const agents = contacts
    .filter((c) => c.roles.includes("Agent"))
    .map((a) => ({ ...a, position: agentPosition(a.id, d) }));

  const orderCards = orders.map((o) => ({ ...o, ...orderSummary(o, d) }));

  return NextResponse.json({ vendors, agents, orders: orderCards, movements, applications, transfers, fxConversions });
});
