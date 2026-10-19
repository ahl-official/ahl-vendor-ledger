import { NextResponse } from "next/server";
import { orderSummary } from "@/lib/ledger";
import { getAllData } from "@/lib/data";
import { appendRow, newId } from "@/lib/sheets";
import { withErrors } from "@/lib/api";

export const GET = withErrors(async () => {
  const d = await getAllData();
  return NextResponse.json({ creditNotes: d.creditNotes ?? [] });
});

export const POST = withErrors(async (req: Request) => {
  const body = await req.json();
  const orderId = String(body.orderId ?? "").trim();
  const amount = Number(body.amount);
  const date = String(body.date ?? new Date().toISOString().slice(0, 10)).trim();
  const reason = String(body.reason ?? "").trim();

  if (!orderId) {
    return NextResponse.json({ error: "Order is required" }, { status: 400 });
  }
  if (!amount || amount <= 0) {
    return NextResponse.json({ error: "Credit amount must be greater than 0" }, { status: 400 });
  }

  const d = await getAllData();
  const order = d.orders.find((o) => o.id === orderId);
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.status === "Cancelled" || order.totalKnown === false || amount - orderSummary(order, d).netCost > 0.001 || !Number.isFinite(amount)) return NextResponse.json({ error: "Credit exceeds the confirmed order's remaining net value" }, { status: 400 });
  const id = newId("CN");
  const createdAt = new Date().toISOString();

  await appendRow("Credit_Notes", {
    id,
    orderId,
    vendorId: order.vendorId,
    date,
    amount,
    currency: order.currency,
    reason: reason || "Vendor credit / order return",
    reversed: false,
    reversedReason: "",
    createdAt,
  });

  return NextResponse.json({ id });
});
