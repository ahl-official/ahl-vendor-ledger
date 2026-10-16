// Spends part of a vendor's held balance on something other than its own order:
// Transfer (to another vendor), PaySupplier (external, no held balance created), or Refund.
import { NextResponse } from "next/server";
import { getAllData } from "@/lib/data";
import { movementRemaining, orderSummary } from "@/lib/ledger";
import type { TransferPurpose } from "@/lib/schema";
import { appendRow, newId } from "@/lib/sheets";
import { withErrors } from "@/lib/api";

export const POST = withErrors(async (req: Request) => {
  const body = await req.json();
  const purpose = body.purpose as TransferPurpose;
  const sourceMovementId = String(body.sourceMovementId ?? "");
  const fromVendorId = String(body.fromVendorId ?? "");
  const amount = Number(body.amount);
  if (!purpose) return NextResponse.json({ error: "Purpose is required" }, { status: 400 });
  if (!sourceMovementId || !fromVendorId) {
    return NextResponse.json({ error: "Source balance is required" }, { status: 400 });
  }
  if (!amount || amount <= 0) return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });
  if (purpose !== "Refund" && !body.toContactId) {
    return NextResponse.json({ error: "Recipient is required" }, { status: 400 });
  }

  // A vendor-to-vendor transfer can be split the same three ways a vendor receipt can: all to
  // one order, all held on the receiving vendor's account, or part of each in one action.
  const paymentUse = purpose === "Transfer" ? (body.paymentUse as string | undefined) : undefined;
  let appliedAmount = 0;
  let orderId = "";
  if (paymentUse === "OrderOnly" || paymentUse === "OrderPlusOnAccount") {
    orderId = String(body.receivingOrderId ?? "");
    appliedAmount = paymentUse === "OrderOnly" ? amount : Number(body.appliedAmount ?? 0);
    if (!orderId) return NextResponse.json({ error: "Choose the order being paid" }, { status: 400 });
    if (!appliedAmount || appliedAmount <= 0) {
      return NextResponse.json({ error: "Enter how much of this transfer applies to the order" }, { status: 400 });
    }
    if (appliedAmount > amount) {
      return NextResponse.json({ error: "Applied amount can't exceed the transfer amount" }, { status: 400 });
    }
  } else if (!paymentUse && body.receivingOrderId) {
    // Older callers (PaySupplier/Refund never set this; a plain Transfer without paymentUse
    // still supports the original single receivingOrderId shape for backward compatibility).
    orderId = String(body.receivingOrderId);
    appliedAmount = amount;
  }

  const d = await getAllData();
  const remaining = movementRemaining(sourceMovementId, d);
  if (amount - remaining > 0.01) {
    return NextResponse.json({ error: `Only ${remaining} is still held from this receipt` }, { status: 400 });
  }
  if (orderId) {
    const order = d.orders.find((o) => o.id === orderId);
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    const { due } = orderSummary(order, d);
    if (appliedAmount - due > 0.01) {
      return NextResponse.json({ error: `Order only has ${due} due — can't apply more than that` }, { status: 400 });
    }
  }

  const sourceMovement = d.movements.find((m) => m.id === sourceMovementId);
  const currency = body.currency ?? sourceMovement?.currency ?? "USD";
  // A refund's recipient (e.g. the company that gets the money back) is informational
  // only — never the vendor itself, or vendorHeld() would read it as a transfer back in.
  const toContactId = purpose === "Refund" ? (body.toContactId ?? "") : body.toContactId;
  const createdAt = new Date().toISOString();
  const base = { fromVendorId, sourceMovementId, toContactId, purpose, currency, proofUrl: body.proofUrl ?? "", note: body.note ?? "", reversed: false, reversedReason: "", createdAt };

  const onAccountAmount = orderId ? amount - appliedAmount : amount;
  const ids: string[] = [];
  if (orderId) {
    const id = newId("TRF");
    await appendRow("Transfers", { id, ...base, amount: appliedAmount, receivingOrderId: orderId });
    ids.push(id);
  }
  if (onAccountAmount > 0.01) {
    const id = newId("TRF");
    await appendRow("Transfers", { id, ...base, amount: onAccountAmount, receivingOrderId: "" });
    ids.push(id);
  }
  return NextResponse.json({ id: ids[0] });
});
