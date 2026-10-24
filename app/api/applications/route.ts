import { NextResponse } from "next/server";
import { getAllData } from "@/lib/data";
import { INVALID_AMOUNT_ERROR, isValidMoneyAmount, orderSummary } from "@/lib/ledger";
import { appendRowsAtomic, newId } from "@/lib/sheets";
import { withErrors } from "@/lib/api";

export const POST = withErrors(async (req: Request) => {
  const body = await req.json();
  const amount = Number(body.amount);
  const d = await getAllData();
  const order = d.orders.find(o => o.id === body.orderId);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (!isValidMoneyAmount(amount)) return NextResponse.json({ error: INVALID_AMOUNT_ERROR }, { status: 400 });
  if (order.status === "Cancelled" || order.totalKnown === false) return NextResponse.json({ error: "Confirm this order's total before applying funds; cancelled orders cannot be paid" }, { status: 400 });
  if (body.vendorId && body.vendorId !== order.vendorId) return NextResponse.json({ error: "Balance must belong to the order's vendor" }, { status: 400 });
  const { due } = orderSummary(order, d);
  if (amount - due > 0.001) return NextResponse.json({ error: "Amount exceeds the order due" }, { status: 400 });
  const createdAt = new Date().toISOString();
  const date = String(body.date || createdAt.slice(0, 10));
  // One row per "Apply to Order" click -- not split across whichever individual receipts
  // happen to make up the vendor's held balance. Keyed by vendorId/currency (what
  // vendorHeld()/vendorAccount() read), not a specific movementId: if this exceeds what's
  // currently held, the excess is simply an advance -- vendorHeld() goes negative for this
  // vendor/currency -- rather than a tracked, receipt-by-receipt shortfall.
  const record = { id: newId("APP"), movementId: "", vendorId: order.vendorId, currency: order.currency, orderId: order.id, amount, active: true, reversedReason: "", createdAt, date };
  await appendRowsAtomic("Applications", [record]);
  return NextResponse.json({ id: record.id, ids: [record.id] });
});
