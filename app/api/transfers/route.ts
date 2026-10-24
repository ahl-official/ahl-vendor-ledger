import { NextResponse } from "next/server";
import { getAllData } from "@/lib/data";
import { drawFifo, INVALID_AMOUNT_ERROR, isValidMoneyAmount, orderSummary, vendorHeld, vendorOpenReceipts } from "@/lib/ledger";
import { appendRowsAtomic, newId } from "@/lib/sheets";
import { withErrors } from "@/lib/api";

export const POST = withErrors(async (req: Request) => {
  const body = await req.json();
  const amount = Number(body.amount);
  const purpose = String(body.purpose);
  const d = await getAllData();
  // The source vendor is NOT required to be active -- deleting a contact (see app/api/contacts/[id]/route.ts)
  // must still let their existing held balance be spent down, not trap it. The recipient IS
  // required to be active: you shouldn't be able to send new money to a deleted contact.
  const from = d.contacts.find(c => c.id === body.fromVendorId && c.roles.includes("Vendor"));
  const to = d.contacts.find(c => c.id === body.toContactId && c.active);
  if (!from || !["Transfer", "PaySupplier", "Refund", "Expense"].includes(purpose)) return NextResponse.json({ error: "Choose a valid source vendor and purpose" }, { status: 400 });
  if (!to || to.id === from.id || (purpose === "Transfer" && !to.roles.includes("Vendor")) || (purpose === "PaySupplier" && !to.roles.includes("Supplier")) || (purpose === "Refund" && !to.roles.includes("Company"))) return NextResponse.json({ error: "Choose a valid recipient for this type of payment" }, { status: 400 });
  if (!isValidMoneyAmount(amount)) return NextResponse.json({ error: INVALID_AMOUNT_ERROR }, { status: 400 });
  const allSources = vendorOpenReceipts(from.id, d);
  const currency = String(body.currency || allSources.find(r => r.movement.id === body.sourceMovementId)?.movement.currency || "RMB");
  const paymentUse = String(body.paymentUse || "");
  if (paymentUse && !["OrderOnly", "OnAccountOnly", "OrderPlusOnAccount"].includes(paymentUse)) return NextResponse.json({ error: "Choose a valid payment use" }, { status: 400 });
  const orderId = purpose === "Transfer" && paymentUse !== "OnAccountOnly" ? String(body.receivingOrderId || "") : "";
  const applied = orderId ? paymentUse === "OrderPlusOnAccount" ? Number(body.appliedAmount) : amount : 0;
  if (["OrderOnly", "OrderPlusOnAccount"].includes(paymentUse) && !orderId) return NextResponse.json({ error: "Choose the receiving order" }, { status: 400 });
  if (orderId) {
    const order = d.orders.find(o => o.id === orderId);
    if (!order || order.vendorId !== to.id || order.currency !== currency || order.totalKnown === false || order.status === "Cancelled") return NextResponse.json({ error: "Choose a confirmed order belonging to the recipient in the same currency" }, { status: 400 });
    if (!Number.isFinite(applied) || applied <= 0 || applied > amount || applied - orderSummary(order, d).due > 0.001) return NextResponse.json({ error: "Applied amount exceeds the transfer or order due" }, { status: 400 });
  }
  const sources = allSources.filter(r => r.movement.currency === currency && (!body.sourceMovementId || r.movement.id === body.sourceMovementId));
  if (amount - vendorHeld(from.id, currency, d) > 0.001 || amount - sources.reduce((s, r) => s + r.remaining, 0) > 0.001) return NextResponse.json({ error: "Available funds in this vendor/currency/source cannot cover the whole payment" }, { status: 400 });
  const createdAt = new Date().toISOString();
  const draws = drawFifo(sources, amount);
  let appliedNeeded = applied;
  const records = [];
  for (const { source, used } of draws) {
    const onOrder = Math.round(Math.min(used, appliedNeeded) * 100) / 100;
    const base = { fromVendorId: from.id, sourceMovementId: source.movement.id, toContactId: to.id, purpose, currency, proofUrl: String(body.proofUrl || ""), note: String(body.note || ""), reversed: false, reversedReason: "", createdAt, date: String(body.date || createdAt.slice(0, 10)), rate: body.rate ? Number(body.rate) : null, rateCurrency: String(body.rateCurrency || "") };
    if (onOrder > 0) records.push({ id: newId("TRF"), ...base, amount: onOrder, receivingOrderId: orderId });
    const held = Math.round((used - onOrder) * 100) / 100;
    if (held > 0) records.push({ id: newId("TRF"), ...base, amount: held, receivingOrderId: "" });
    appliedNeeded = Math.round((appliedNeeded - onOrder) * 100) / 100;
  }
  if (appliedNeeded > 0.001) throw Error("Balance sources did not cover the full payment");
  await appendRowsAtomic("Transfers", records);
  return NextResponse.json({ id: records[0].id, ids: records.map(r => r.id) });
});
