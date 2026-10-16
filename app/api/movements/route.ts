import { NextResponse } from "next/server";
import { getAllData } from "@/lib/data";
import { orderSummary } from "@/lib/ledger";
import type { MovementType, PaymentUse } from "@/lib/schema";
import { appendRow, newId } from "@/lib/sheets";
import { withErrors } from "@/lib/api";

export const GET = withErrors(async () => {
  const { movements, contacts } = await getAllData();
  return NextResponse.json({ movements, contacts });
});

export const POST = withErrors(async (req: Request) => {
  const body = await req.json();
  const type = body.type as MovementType;
  const amount = Number(body.amount);
  if (!type) return NextResponse.json({ error: "Movement type is required" }, { status: 400 });
  if (!body.payerId || !body.payeeId) return NextResponse.json({ error: "Payer and payee are required" }, { status: 400 });
  if (!amount || amount <= 0) return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });

  const isVendorReceipt = type === "CompanyToVendor" || type === "AgentToVendor";
  const paymentUse = (isVendorReceipt ? (body.paymentUse as PaymentUse) : "") || "";
  if (isVendorReceipt && !paymentUse) {
    return NextResponse.json({ error: "Choose Order only / On-account only / Order + on-account" }, { status: 400 });
  }

  let orderId = "";
  let appliedAmount = 0;
  if (paymentUse === "OrderOnly" || paymentUse === "OrderPlusOnAccount") {
    orderId = String(body.orderId ?? "");
    appliedAmount = Number(body.appliedAmount ?? 0);
    if (!orderId) return NextResponse.json({ error: "Choose the order being paid" }, { status: 400 });
    if (!appliedAmount || appliedAmount <= 0) {
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

  return NextResponse.json({ id });
});
