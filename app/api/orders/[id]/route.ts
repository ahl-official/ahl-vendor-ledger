import { NextResponse } from "next/server";
import { getAllData } from "@/lib/data";
import { orderPaid, orderSummary } from "@/lib/ledger";
import { appendRow, deleteRowsByField, newId, updateRow } from "@/lib/sheets";
import { withErrors } from "@/lib/api";

export const GET = withErrors(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const d = await getAllData();
  const order = d.orders.find((o) => o.id === id);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const items = d.orderItems.filter((i) => i.orderId === id);
  const vendor = d.contacts.find((c) => c.id === order.vendorId);
  const appliedPayments = d.applications
    .filter((a) => a.orderId === id && a.active)
    .map((a) => {
      const mov = d.movements.find((m) => m.id === a.movementId);
      const payer = d.contacts.find((c) => c.id === mov?.payerId);
      return {
        id: a.id,
        movementId: a.movementId,
        amount: a.amount,
        createdAt: a.createdAt,
        date: mov?.date ?? a.createdAt.slice(0, 10),
        currency: mov?.currency ?? order.currency,
        method: mov?.method ?? "",
        reference: mov?.reference ?? "",
        payerName: payer?.name ?? mov?.payerId ?? "Payer",
      };
    });

  const creditNotes = (d.creditNotes ?? [])
    .filter((c) => c.orderId === id && !c.reversed)
    .map((c) => ({
      id: c.id,
      date: c.date,
      amount: c.amount,
      currency: c.currency,
      reason: c.reason,
      createdAt: c.createdAt,
    }));

  const summary = orderSummary(order, d);
  return NextResponse.json({
    ...order,
    vendorName: vendor?.name ?? order.vendorId,
    items,
    appliedPayments,
    creditNotes,
    creditNotesTotal: summary.creditNotes,
    total: summary.total,
    paid: summary.paid,
    netCost: summary.netCost,
    due: summary.due,
  });
});

interface ItemInput {
  description: string;
  sku?: string;
  qty: number;
  unit: string;
  unitPrice: number;
}

export const PATCH = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await req.json();
  const d = await getAllData();
  const order = d.orders.find((o) => o.id === id);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const paid = orderPaid(order.id, d.applications, d.transfers);
  if (paid > 0 && body.currency && body.currency !== order.currency) {
    return NextResponse.json(
      { error: `Cannot change currency while payments are applied (${order.currency} ${paid.toFixed(2)} applied). Reverse payments first.` },
      { status: 400 }
    );
  }

  const patch: Record<string, string | number | boolean | null> = {};
  if (body.vendorId !== undefined) patch.vendorId = String(body.vendorId);
  if (body.invoiceRef !== undefined) patch.invoiceRef = String(body.invoiceRef);
  if (body.date !== undefined) patch.date = String(body.date);
  if (body.currency !== undefined) patch.currency = String(body.currency);
  if (body.shippingFee !== undefined) patch.shippingFee = Number(body.shippingFee) || 0;
  if (body.adjustment !== undefined) patch.adjustment = Number(body.adjustment) || 0;
  if (body.notes !== undefined) patch.notes = String(body.notes);
  if (body.proofUrl !== undefined) patch.proofUrl = String(body.proofUrl);

  if (Object.keys(patch).length > 0) {
    await updateRow("Orders", id, patch);
  }

  if (Array.isArray(body.items)) {
    const items = body.items as ItemInput[];
    await deleteRowsByField("Order_Items", "orderId", id);
    const createdAt = new Date().toISOString();
    for (const item of items) {
      const qty = Number(item.qty) || 0;
      const unitPrice = Number(item.unitPrice) || 0;
      await appendRow("Order_Items", {
        id: newId("ITM"),
        orderId: id,
        description: item.description ?? "",
        sku: item.sku ?? "",
        qty,
        unit: item.unit ?? "",
        unitPrice,
        lineTotal: qty * unitPrice,
        createdAt,
      });
    }
  }

  return NextResponse.json({ success: true, id });
});

export const DELETE = withErrors(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const d = await getAllData();
  const order = d.orders.find((o) => o.id === id);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const paid = orderPaid(order.id, d.applications, d.transfers);
  if (paid > 0) {
    return NextResponse.json(
      { error: `Cannot delete order ${order.invoiceRef || order.id} because ${order.currency} ${paid.toFixed(2)} in payments has been applied. Reverse payments first.` },
      { status: 400 }
    );
  }

  const activeCreditNotes = (d.creditNotes ?? []).filter((c) => c.orderId === id && !c.reversed);
  if (activeCreditNotes.length > 0) {
    const cnTotal = activeCreditNotes.reduce((s, c) => s + c.amount, 0);
    return NextResponse.json(
      { error: `Cannot delete order ${order.invoiceRef || order.id} because it has ${activeCreditNotes.length} active credit note(s) totaling ${order.currency} ${cnTotal.toFixed(2)}. Delete credit notes first.` },
      { status: 400 }
    );
  }

  await deleteRowsByField("Orders", "id", id);
  await deleteRowsByField("Order_Items", "orderId", id);
  await deleteRowsByField("Credit_Notes", "orderId", id);

  return NextResponse.json({ success: true, id });
});
