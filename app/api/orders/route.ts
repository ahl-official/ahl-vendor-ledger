import { NextResponse } from "next/server";
import { getAllData } from "@/lib/data";
import { orderSummary } from "@/lib/ledger";
import { appendRow, newId } from "@/lib/sheets";
import { withErrors } from "@/lib/api";

export const GET = withErrors(async () => {
  const d = await getAllData();
  const withTotals = d.orders.filter(o => o.status !== "Cancelled").map((o) => ({ ...o, ...orderSummary(o, d) }));
  return NextResponse.json(withTotals);
});

interface ItemInput {
  description: string;
  sku?: string;
  qty: number;
  unit: string;
  unitPrice: number;
}

export const POST = withErrors(async (req: Request) => {
  const body = await req.json();
  const vendorId = String(body.vendorId ?? "");
  const items = (body.items ?? []) as ItemInput[];
  if (!vendorId) return NextResponse.json({ error: "Vendor is required" }, { status: 400 });
  if (!items.length) return NextResponse.json({ error: "Add at least one product line" }, { status: 400 });

  const orderId = newId("ORD");
  const createdAt = new Date().toISOString();
  await appendRow("Orders", {
    id: orderId,
    vendorId,
    invoiceRef: body.invoiceRef ?? "",
    date: body.date ?? createdAt.slice(0, 10),
    currency: body.currency ?? "USD",
    shippingFee: Number(body.shippingFee ?? 0),
    adjustment: Number(body.adjustment ?? 0),
    notes: body.notes ?? "",
    proofUrl: body.proofUrl ?? "",
    createdAt,
  });

  for (const item of items) {
    const qty = Number(item.qty) || 0;
    const unitPrice = Number(item.unitPrice) || 0;
    await appendRow("Order_Items", {
      id: newId("ITM"),
      orderId,
      description: item.description ?? "",
      sku: item.sku ?? "",
      qty,
      unit: item.unit ?? "",
      unitPrice,
      lineTotal: qty * unitPrice,
      createdAt,
    });
  }

  return NextResponse.json({ id: orderId });
});
