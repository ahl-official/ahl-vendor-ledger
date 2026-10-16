// "Apply to Order" from an existing held balance — spends part of a past receipt
// against an order without creating a new cash receipt.
import { NextResponse } from "next/server";
import { getAllData } from "@/lib/data";
import { movementRemaining, orderSummary } from "@/lib/ledger";
import { appendRow, newId } from "@/lib/sheets";
import { withErrors } from "@/lib/api";

export const POST = withErrors(async (req: Request) => {
  const body = await req.json();
  const movementId = String(body.movementId ?? "");
  const orderId = String(body.orderId ?? "");
  const amount = Number(body.amount);
  if (!movementId || !orderId) return NextResponse.json({ error: "Source balance and order are required" }, { status: 400 });
  if (!amount || amount <= 0) return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });

  const d = await getAllData();

  const remaining = movementRemaining(movementId, d);
  if (amount - remaining > 0.01) {
    return NextResponse.json({ error: `Only ${remaining} is still held from this receipt` }, { status: 400 });
  }
  const order = d.orders.find((o) => o.id === orderId);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const { due } = orderSummary(order, d);
  if (amount - due > 0.01) {
    return NextResponse.json({ error: `Order only has ${due} due` }, { status: 400 });
  }

  const id = newId("APP");
  await appendRow("Applications", {
    id, movementId, orderId, amount, active: true, reversedReason: "", createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ id });
});
