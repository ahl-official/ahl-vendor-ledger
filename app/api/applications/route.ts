import { NextResponse } from "next/server";
import { getAllData } from "@/lib/data";
import { orderSummary, vendorHeld, vendorOpenReceipts } from "@/lib/ledger";
import { appendRowsAtomic, newId } from "@/lib/sheets";
import { withErrors } from "@/lib/api";

export const POST = withErrors(async (req: Request) => {
  const body = await req.json();
  const amount = Number(body.amount);
  const d = await getAllData();
  const order = d.orders.find(o => o.id === body.orderId);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.001) return NextResponse.json({ error: "Enter a positive amount with at most two decimals" }, { status: 400 });
  if (order.status === "Cancelled" || order.totalKnown === false) return NextResponse.json({ error: "Confirm this order's total before applying funds; cancelled orders cannot be paid" }, { status: 400 });
  if (body.vendorId && body.vendorId !== order.vendorId) return NextResponse.json({ error: "Balance must belong to the order's vendor" }, { status: 400 });
  const { due } = orderSummary(order, d);
  if (amount - due > 0.001 || amount - vendorHeld(order.vendorId, order.currency, d) > 0.001) return NextResponse.json({ error: "Amount exceeds the order due or the vendor's held balance in this currency" }, { status: 400 });
  const sources = vendorOpenReceipts(order.vendorId, d).filter(r => r.movement.currency === order.currency && (!body.movementId || r.movement.id === body.movementId));
  if (amount - sources.reduce((s, r) => s + r.remaining, 0) > 0.001) return NextResponse.json({ error: "The selected source cannot cover this amount for this vendor and currency" }, { status: 400 });
  const createdAt = new Date().toISOString();
  let needed = amount;
  const records = [];
  for (const source of sources) {
    const used = Math.round(Math.min(needed, source.remaining) * 100) / 100;
    if (used <= 0) break;
    records.push({ id: newId("APP"), movementId: source.movement.id, orderId: order.id, amount: used, active: true, reversedReason: "", createdAt, date: String(body.date || createdAt.slice(0, 10)) });
    needed = Math.round((needed - used) * 100) / 100;
  }
  if (needed > 0.001) throw Error("Balance sources did not cover the full application");
  await appendRowsAtomic("Applications", records);
  return NextResponse.json({ id: records[0].id, ids: records.map(r => r.id) });
});
