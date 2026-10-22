import { NextResponse } from "next/server";
import { getAllData } from "@/lib/data";
import { orderSummary } from "@/lib/ledger";
import { MOVEMENT_TYPES, PAYMENT_USES, type MovementType, type PaymentUse } from "@/lib/schema";
import { appendRow, newId } from "@/lib/sheets";
import { registerOptionIfNew } from "@/lib/options";
import { withErrors } from "@/lib/api";

export const GET = withErrors(async () => {
  const { movements, contacts } = await getAllData();
  return NextResponse.json({ movements, contacts });
});

export const POST = withErrors(async (req: Request) => {
  const body = await req.json();
  const type = body.type as MovementType;
  const amount = Number(body.amount);
  if (!MOVEMENT_TYPES.includes(type as typeof MOVEMENT_TYPES[number]) && !(type === "LegacyCompanyToVendor" && body.editId)) return NextResponse.json({ error: "Movement type is required" }, { status: 400 });
  if (!body.payerId || !body.payeeId) return NextResponse.json({ error: "Payer and payee are required" }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });

  const d = await getAllData();
  const payer = d.contacts.find(c => c.id === body.payerId && c.active);
  const payee = d.contacts.find(c => c.id === body.payeeId && c.active);
  if (type === "LegacyCompanyToVendor" && !d.movements.some(m => m.id === body.editId && m.type === "LegacyCompanyToVendor")) return NextResponse.json({ error: "Historical flow is only for correcting an imported payment" }, { status: 400 });
  const roles = type === "CompanyToAgent" ? ["Company", "Agent"] : type === "AgentToCompany" ? ["Agent", "Company"] : type === "CompanyToVendor" || type === "LegacyCompanyToVendor" ? ["Company", "Vendor"] : ["Agent", "Vendor"];
  if (!payer || !payee || payer.id === payee.id || !payer.roles.some(r => r === roles[0]) || !payee.roles.some(r => r === roles[1])) return NextResponse.json({ error: "Payer and recipient must match the selected money flow" }, { status: 400 });
  const isVendorReceipt = type === "AgentToVendor" || type === "CompanyToVendor" || type === "LegacyCompanyToVendor";
  const paymentUse = (isVendorReceipt ? (body.paymentUse as PaymentUse) : "") || "";
  if (isVendorReceipt && !PAYMENT_USES.includes(paymentUse as PaymentUse)) {
    return NextResponse.json({ error: "Choose Order only / On-account only / Order + on-account" }, { status: 400 });
  }

  let orderId = "";
  let appliedAmount = 0;
  if (paymentUse === "OrderOnly" || paymentUse === "OrderPlusOnAccount") {
    orderId = String(body.orderId ?? "");
    appliedAmount = Number(body.appliedAmount ?? 0);
    if (!orderId) return NextResponse.json({ error: "Choose the order being paid" }, { status: 400 });
    if (!Number.isFinite(appliedAmount) || appliedAmount <= 0) {
      return NextResponse.json({ error: "Enter how much of this payment applies to the order" }, { status: 400 });
    }
    if (appliedAmount > amount) {
      return NextResponse.json({ error: "Applied amount can't exceed the payment amount" }, { status: 400 });
    }
    if (paymentUse === "OrderOnly" && Math.abs(appliedAmount - amount) > 0.01) {
      return NextResponse.json({ error: "Order-only payments apply the full amount to the order" }, { status: 400 });
    }
    const d = await getAllData();
    const order = d.orders.find((o) => o.id === orderId);
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (order.vendorId !== body.payeeId || order.currency !== (body.currency || "USD") || order.status === "Cancelled" || order.totalKnown === false) return NextResponse.json({ error: "Choose a confirmed order for this vendor in the same currency" }, { status: 400 });
    const { due } = orderSummary(order, d);
    if (appliedAmount - due > 0.01) {
      return NextResponse.json({ error: `Order only has ${due} due — can't apply more than that` }, { status: 400 });
    }
  }

  const id = newId("MOV");
  const createdAt = new Date().toISOString();
  await appendRow("Money_Movements", {
    id,
    date: body.date ?? createdAt.slice(0, 10),
    type,
    payerId: body.payerId,
    payeeId: body.payeeId,
    amount,
    currency: body.currency ?? "USD",
    actualRate: body.actualRate ? Number(body.actualRate) : null,
    quotedRate: body.quotedRate ? Number(body.quotedRate) : null,
    agentFee: body.agentFee ? Number(body.agentFee) : null,
    paymentUse,
    method: body.method ?? "",
    reference: body.reference ?? "",
    proofUrl: body.proofUrl ?? "",
    note: body.note ?? "",
    reversed: false,
    reversedReason: "",
    idempotencyKey: body.idempotencyKey ?? id,
    createdAt,
    createdBy: body.createdBy ?? "",
    rateCurrency: body.rateCurrency || "RMB",
  });

  if (orderId && appliedAmount > 0) {
    await appendRow("Applications", {
      id: newId("APP"),
      movementId: id,
      orderId,
      amount: appliedAmount,
      active: true,
      reversedReason: "",
      createdAt,
    });
  }

  // A typed "Other" value is remembered so it's a normal dropdown choice from now on.
  // Sequential, not Promise.all: two concurrent appends to the same sheet tab can race
  // and silently drop one (Sheets API has no cross-call locking) -- this happened in
  // testing, losing a reference value when both ran in parallel.
  await registerOptionIfNew("reference", body.reference ?? "");
  await registerOptionIfNew("method", body.method ?? "");

  return NextResponse.json({ id });
});
