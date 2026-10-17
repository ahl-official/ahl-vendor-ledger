// "Apply to Order" from an existing held balance — spends part of a past receipt
// (or from the vendor's total held balance) against an order without creating a new cash receipt.
import { NextResponse } from "next/server";
import { getAllData } from "@/lib/data";
import { movementRemaining, orderSummary, vendorHeld, vendorOpenReceipts } from "@/lib/ledger";
import { appendRow, newId } from "@/lib/sheets";
import { withErrors } from "@/lib/api";

export const POST = withErrors(async (req: Request) => {
  const body = await req.json();
  const movementId = String(body.movementId ?? "");
  const vendorId = String(body.vendorId ?? "");
  const orderId = String(body.orderId ?? "");
  const amount = Number(body.amount);

  if ((!movementId && !vendorId) || !orderId) {
    return NextResponse.json({ error: "Vendor/source balance and order are required" }, { status: 400 });
  }
  if (!amount || amount <= 0) return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });

  const d = await getAllData();
  const order = d.orders.find((o) => o.id === orderId);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const { due } = orderSummary(order, d);
  if (amount - due > 0.01) {
    return NextResponse.json({ error: `Order only has ${order.currency} ${due.toFixed(2)} due` }, { status: 400 });
  }

  // If specific movementId is given
  if (movementId) {
    const remaining = movementRemaining(movementId, d);
    if (amount - remaining > 0.01) {
      return NextResponse.json({ error: `Only ${remaining.toFixed(2)} is still held from this receipt` }, { status: 400 });
    }

    const id = newId("APP");
    await appendRow("Applications", {
      id,
      movementId,
      orderId,
      amount,
      active: true,
      reversedReason: "",
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json({ id });
  }

  // If vendorId is given: spend from total held balance across open receipts FIFO
  const actualVendorId = vendorId || order.vendorId;
  const totalHeld = vendorHeld(actualVendorId, order.currency, d);
  if (amount - totalHeld > 0.01) {
    return NextResponse.json({ error: `Vendor only holds ${order.currency} ${totalHeld.toFixed(2)} in total balance` }, { status: 400 });
  }

  const openReceipts = vendorOpenReceipts(actualVendorId, d).filter((r) => r.movement.currency === order.currency);
  if (openReceipts.length === 0) {
    return NextResponse.json({ error: `Vendor has no open balance in ${order.currency}` }, { status: 400 });
  }

  let remainingNeeded = amount;
  const createdIds: string[] = [];
  const createdAt = new Date().toISOString();

  for (const r of openReceipts) {
    if (remainingNeeded <= 0.001) break;
    const spendFromThis = Math.min(r.remaining, remainingNeeded);
    const id = newId("APP");
    await appendRow("Applications", {
      id,
      movementId: r.movement.id,
      orderId,
      amount: spendFromThis,
      active: true,
      reversedReason: "",
      createdAt,
    });
    createdIds.push(id);
    remainingNeeded -= spendFromThis;
  }

  return NextResponse.json({ id: createdIds[0], ids: createdIds });
});
