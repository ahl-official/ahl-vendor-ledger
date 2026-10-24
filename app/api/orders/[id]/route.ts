import { NextResponse } from "next/server";
import { getAllData } from "@/lib/data";
import { balanceSource, orderPaid, orderSummary } from "@/lib/ledger";
import { appendRow, deleteRowsByField, newId, updateRow } from "@/lib/sheets";
import { withErrors } from "@/lib/api";

type Payment = {
  id: string; kind: string; legacy: boolean; movementId: string; amount: number;
  createdAt: string; date: string; currency: string; method: string; reference: string; payerName: string;
  // When this apply/transfer action itself happened -- NOT the same as `date` above, which (for
  // an Application) deliberately shows the underlying RECEIPT's date for display. Merging must
  // group by when the apply/transfer action happened, or applications drawn from receipts dated
  // months apart would wrongly end up in the same group just because they both applied to this
  // order around the same moment.
  actionDate: string;
};

/** One "Apply to Order" or vendor-to-vendor Transfer can write several rows FIFO-split across
 *  a vendor's open receipts (see app/api/applications/route.ts and app/api/transfers/route.ts
 *  drawFifo). Shown separately they look like unrelated part-payments; merge rows written by
 *  the same action (same moment, same payer/currency) back into one line, keeping every
 *  underlying id so unlinking affects the whole group -- same approach the Ledger page's
 *  vendorAccount() uses (lib/accounts.ts mergeSplitEvents), applied here to this page's own
 *  payment shape since it isn't built from vendorAccount's event list. */
function mergePayments(payments: Payment[]): (Payment & { ids: string[] })[] {
  const merged = new Map<string, Payment & { ids: string[] }>();
  const order: (Payment & { ids: string[] })[] = [];
  for (const p of payments) {
    const key = `${p.kind}|${p.actionDate}|${p.createdAt}|${p.payerName}|${p.currency}`;
    const existing = merged.get(key);
    if (existing) {
      existing.amount += p.amount;
      existing.ids.push(p.id);
    } else {
      const copy = { ...p, ids: [p.id] };
      merged.set(key, copy);
      order.push(copy);
    }
  }
  return order;
}

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
      const source = balanceSource(a.movementId, d);
      const incoming = d.transfers.find(t => t.id === a.movementId);
      const payer = d.contacts.find((c) => c.id === (mov?.payerId || incoming?.fromVendorId || source?.payeeId));
      return {
        id: a.id,
        kind: "application",
        legacy: !!a.legacyId,
        movementId: a.movementId,
        amount: a.amount,
        createdAt: a.createdAt,
        date: mov?.date ?? a.createdAt.slice(0, 10),
        actionDate: a.date ?? a.createdAt.slice(0, 10),
        currency: mov?.currency ?? order.currency,
        method: mov?.method ?? "",
        reference: mov?.reference ?? "",
        payerName: payer?.name ?? mov?.payerId ?? "Payer",
      };
    });

  appliedPayments.push(...d.transfers.filter(t => !t.reversed && t.receivingOrderId === id).map(t => ({
    id: t.id, kind: "transfer", legacy: !!t.legacyId, movementId: t.sourceMovementId, amount: t.amount, createdAt: t.createdAt,
    date: t.date ?? t.createdAt.slice(0, 10), actionDate: t.date ?? t.createdAt.slice(0, 10), currency: t.currency, method: "Vendor transfer", reference: t.legacyId || t.id,
    payerName: d.contacts.find(c => c.id === t.fromVendorId)?.name || t.fromVendorId,
  })));
  const mergedPayments = mergePayments(appliedPayments);
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
    appliedPayments: mergedPayments,
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
  if (order.status === "Cancelled") return NextResponse.json({ error: "Cancelled historical order is read-only" }, { status: 409 });
  if (body.vendorId && body.vendorId !== order.vendorId && d.applications.some(a => a.orderId === id)) return NextResponse.json({ error: "An order with payment history cannot change vendor" }, { status: 400 });
  if (Array.isArray(body.items)) {
    const values = body.items as ItemInput[];
    if (!values.length || values.some(i => !i.description?.trim() || !Number.isFinite(Number(i.qty)) || Number(i.qty) <= 0 || !Number.isFinite(Number(i.unitPrice)) || Number(i.unitPrice) < 0)) return NextResponse.json({ error: "Provide valid confirmed item quantities and prices" }, { status: 400 });
    const total = values.reduce((sum, i) => sum + Number(i.qty) * Number(i.unitPrice), 0) + Number(body.shippingFee ?? order.shippingFee) + Number(body.adjustment ?? order.adjustment);
    if (!Number.isFinite(total) || total <= 0 || total + (d.creditNotes ?? []).filter(c => !c.reversed && c.orderId === id).reduce((sum, c) => sum + c.amount, 0) < paid - 0.01) return NextResponse.json({ error: "Confirmed total cannot be less than payments already applied" }, { status: 400 });
  }
  if (paid > 0 && body.currency && body.currency !== order.currency) {
    return NextResponse.json(
      { error: `Cannot change currency while payments are applied (${order.currency} ${paid.toFixed(2)} applied). Reverse payments first.` },
      { status: 400 }
    );
  }

  const patch: Record<string, string | number | boolean | null> = {};
  if (Array.isArray(body.items)) { patch.legacyTotal = null; patch.totalKnown = true; }
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

  if (order.legacyId || d.applications.some(a => a.orderId === id) || d.transfers.some(t => t.receivingOrderId === id) || d.creditNotes.some(c => c.orderId === id)) return NextResponse.json({ error: "Orders with imported or financial history cannot be deleted" }, { status: 409 });
  const paid = orderPaid(order.id, d.applications, d.transfers);
  if (paid > 0) {
    return NextResponse.json(
      { error: `Cannot delete order ${order.invoiceRef || order.id} because ${order.currency} ${paid.toFixed(2)} in payments has been applied. Reverse payments first.` },
      { status: 400 }
    );
  }

  // Credit notes (active or reversed) are already ruled out by the guard above -- there's
  // nothing left in Credit_Notes for this order to clean up here.
  await deleteRowsByField("Orders", "id", id);
  await deleteRowsByField("Order_Items", "orderId", id);

  return NextResponse.json({ success: true, id });
});
