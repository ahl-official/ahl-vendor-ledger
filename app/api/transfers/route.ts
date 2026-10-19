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
  if (!fromVendorId) {
    return NextResponse.json({ error: "Source vendor is required" }, { status: 400 });
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
    orderId = String(body.receivingOrderId);
    appliedAmount = amount;
  }

  const d = await getAllData();
  const sourceMovement = sourceMovementId ? d.movements.find((m) => m.id === sourceMovementId) : null;
  const currency = body.currency ?? sourceMovement?.currency ?? "USD";

  if (orderId) {
    const order = d.orders.find((o) => o.id === orderId);
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    const { due } = orderSummary(order, d);
    if (appliedAmount - due > 0.01) {
      return NextResponse.json({ error: `Order only has ${due} due — can't apply more than that` }, { status: 400 });
    }
  }

  const toContactId = purpose === "Refund" ? (body.toContactId ?? "") : body.toContactId;
  const createdAt = new Date().toISOString();

  // If specific movement was selected
  if (sourceMovementId) {
    const remaining = movementRemaining(sourceMovementId, d);
    if (amount - remaining > 0.01) {
      return NextResponse.json({ error: `Only ${remaining.toFixed(2)} is still held from this receipt` }, { status: 400 });
    }
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
  }

  // If spending from total held balance FIFO across open receipts
  const { vendorHeld, vendorOpenReceipts } = await import("@/lib/ledger");
  const totalHeld = vendorHeld(fromVendorId, currency, d);
  if (amount - totalHeld > 0.01) {
    return NextResponse.json({ error: `Vendor only holds ${currency} ${totalHeld.toFixed(2)} in total balance` }, { status: 400 });
  }

  const openReceipts = vendorOpenReceipts(fromVendorId, d).filter((r) => r.movement.currency === currency);
  if (openReceipts.length === 0) {
    return NextResponse.json({ error: `Vendor has no open balance in ${currency}` }, { status: 400 });
  }

  // vendorHeld() (checked above) includes money that arrived via a vendor-to-vendor
  // Transfer-in or a Credit Note, which have no movementId of their own and so are
  // invisible to vendorOpenReceipts() below -- only original AgentToVendor receipts can
  // actually be drawn from here. Without this check, a vendor whose held balance is
  // partly non-receipt money could pass the totalHeld check above but the FIFO loop
  // below would run out of receipts partway through, silently creating Transfer rows
  // that sum to LESS than the requested amount while still reporting success. Fail
  // loudly instead, before writing anything.
  const receiptsAvailable = openReceipts.reduce((s, r) => s + r.remaining, 0);
  if (amount - receiptsAvailable > 0.01) {
    return NextResponse.json({
      error: `Only ${currency} ${receiptsAvailable.toFixed(2)} of the ${currency} ${totalHeld.toFixed(2)} total held is available to spend this way — the rest arrived via a vendor-to-vendor transfer or credit note, which can't be re-spent through this screen yet.`,
    }, { status: 400 });
  }

  let remainingNeeded = amount;
  let remainingAppliedNeeded = appliedAmount;
  const ids: string[] = [];

  for (const r of openReceipts) {
    if (remainingNeeded <= 0.001) break;
    const spendFromThis = Math.min(r.remaining, remainingNeeded);
    const base = { fromVendorId, sourceMovementId: r.movement.id, toContactId, purpose, currency, proofUrl: body.proofUrl ?? "", note: body.note ?? "", reversed: false, reversedReason: "", createdAt };

    let toApply = 0;
    if (remainingAppliedNeeded > 0) {
      toApply = Math.min(spendFromThis, remainingAppliedNeeded);
      remainingAppliedNeeded -= toApply;
    }
    const toOnAccount = spendFromThis - toApply;

    if (toApply > 0.001 && orderId) {
      const id = newId("TRF");
      await appendRow("Transfers", { id, ...base, amount: toApply, receivingOrderId: orderId });
      ids.push(id);
    }
    if (toOnAccount > 0.001) {
      const id = newId("TRF");
      await appendRow("Transfers", { id, ...base, amount: toOnAccount, receivingOrderId: "" });
      ids.push(id);
    }

    remainingNeeded -= spendFromThis;
  }

  return NextResponse.json({ id: ids[0] });
});
