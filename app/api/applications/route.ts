import { NextResponse } from "next/server";
import { getAllData } from "@/lib/data";
import { drawFifo, INVALID_AMOUNT_ERROR, isValidMoneyAmount, orderSummary, vendorOpenReceipts } from "@/lib/ledger";
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
  // A specific source (body.movementId) must actually cover what's asked of it -- only the
  // general "apply from whatever's held" path (no movementId) is allowed to run short and
  // fall back to an advance below.
  const sources = vendorOpenReceipts(order.vendorId, d).filter(r => r.movement.currency === order.currency && (!body.movementId || r.movement.id === body.movementId));
  const covered = Math.min(amount, sources.reduce((s, r) => s + r.remaining, 0));
  if (body.movementId && amount - covered > 0.001) return NextResponse.json({ error: "The selected source cannot cover this amount for this vendor and currency" }, { status: 400 });
  const createdAt = new Date().toISOString();
  const date = String(body.date || createdAt.slice(0, 10));
  const draws = covered > 0 ? drawFifo(sources, covered) : [];
  const records: { id: string; movementId: string; orderId: string; amount: number; active: boolean; reversedReason: string; createdAt: string; date: string; vendorId?: string; currency?: string }[] = draws.map(({ source, used }) => ({
    id: newId("APP"), movementId: source.movement.id, orderId: order.id, amount: used,
    active: true, reversedReason: "", createdAt, date,
  }));
  // Whatever isn't covered by a real receipt becomes an advance: the vendor is paid
  // against this order before the company actually holds funds for them. vendorHeld()
  // then goes negative for this vendor/currency to show that explicitly, instead of
  // silently refusing to record a payment that's already been decided on.
  const shortfall = Math.round((amount - covered) * 100) / 100;
  if (shortfall > 0.001) {
    records.push({ id: newId("APP"), movementId: "", vendorId: order.vendorId, currency: order.currency, orderId: order.id, amount: shortfall, active: true, reversedReason: "", createdAt, date });
  }
  await appendRowsAtomic("Applications", records);
  return NextResponse.json({ id: records[0].id, ids: records.map(r => r.id) });
});
