import { NextResponse } from "next/server";
import { getAllData } from "@/lib/data";
import { orderSummary } from "@/lib/ledger";
import { withErrors } from "@/lib/api";

export const GET = withErrors(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const d = await getAllData();
  const order = d.orders.find((o) => o.id === id);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const items = d.orderItems.filter((i) => i.orderId === id);
  const vendor = d.contacts.find((c) => c.id === order.vendorId);
  return NextResponse.json({ ...order, vendorName: vendor?.name ?? order.vendorId, items, ...orderSummary(order, d) });
});
