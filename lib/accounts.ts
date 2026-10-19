import { balanceSource, contactName, orderSummary, vendorHeld, type LedgerData } from "./ledger.ts";

export interface StatementEvent {
  id: string; kind: "movement" | "transfer" | "application" | "credit_note";
  date: string; createdAt: string; label: string; currency: string; credited: number; debited: number;
  balance: number; reversed: boolean; note: string; proofUrl: string; legacy: boolean;
}

/** A statement of actual held funds. Orders/expenses are separate commitments, not cash. */
export function vendorAccount(vendorId: string, d: LedgerData) {
  const name = (id: string) => contactName(id, d.contacts);
  const orders = d.orders.filter(o => o.vendorId === vendorId).map(o => ({ ...o, ...orderSummary(o, d) }));
  const events: StatementEvent[] = [];
  for (const m of d.movements.filter(m => m.payeeId === vendorId && (m.type === "AgentToVendor" || m.type === "LegacyCompanyToVendor"))) {
    events.push({ id: m.id, kind: "movement", date: m.date, createdAt: m.createdAt, label: `Received from ${name(m.payerId)}`, currency: m.currency, credited: m.amount, debited: 0, balance: 0, reversed: m.reversed, note: m.note, proofUrl: m.proofUrl, legacy: !!m.legacyId });
  }
  for (const t of d.transfers.filter(t => t.fromVendorId === vendorId || (t.purpose === "Transfer" && t.toContactId === vendorId))) {
    const incoming = t.fromVendorId !== vendorId;
    const order = orders.find(o => o.id === t.receivingOrderId);
    const label = incoming ? `Transfer from ${name(t.fromVendorId)}${order ? ` · paid ${order.invoiceRef || order.id}` : " · on account"}` : `${t.purpose === "PaySupplier" ? "Supplier payment to" : t.purpose === "Refund" ? "Refund to" : "Transfer to"} ${name(t.toContactId)}`;
    events.push({ id: t.id, kind: "transfer", date: t.date ?? t.createdAt.slice(0, 10), createdAt: t.createdAt, label, currency: t.currency, credited: incoming ? t.amount : 0, debited: !incoming || t.receivingOrderId ? t.amount : 0, balance: 0, reversed: t.reversed, note: t.note, proofUrl: t.proofUrl, legacy: !!t.legacyId });
  }
  for (const a of d.applications) {
    // Include voided receipt history as well as applications of incoming transfers/credits.
    const source = balanceSource(a.movementId, d);
    const receipt = d.movements.find(m => m.id === a.movementId && m.payeeId === vendorId);
    if (source?.payeeId !== vendorId && !receipt) continue;
    const order = orders.find(o => o.id === a.orderId);
    events.push({ id: a.id, kind: "application", date: a.date ?? a.createdAt.slice(0, 10), createdAt: a.createdAt, label: `Applied to order ${order?.invoiceRef || a.orderId}`, currency: source?.currency ?? receipt?.currency ?? order?.currency ?? "", credited: 0, debited: a.amount, balance: 0, reversed: !a.active || !!receipt?.reversed, note: a.reversedReason || "", proofUrl: receipt?.proofUrl ?? "", legacy: !!a.legacyId });
  }
  for (const c of (d.creditNotes ?? []).filter(c => c.vendorId === vendorId)) {
    events.push({ id: c.id, kind: "credit_note", date: c.date, createdAt: c.createdAt, label: `Credit note · ${orders.find(o => o.id === c.orderId)?.invoiceRef || c.orderId}`, currency: c.currency, credited: c.amount, debited: 0, balance: 0, reversed: c.reversed, note: c.reason, proofUrl: "", legacy: false });
  }
  const priority = (e: StatementEvent) => e.kind === "movement" || (e.kind === "transfer" && e.credited) ? 0 : 1;
  events.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || priority(a) - priority(b) || a.id.localeCompare(b.id));
  const running: Record<string, number> = {};
  for (const e of events) { running[e.currency] = (running[e.currency] ?? 0) + (e.reversed ? 0 : e.credited - e.debited); e.balance = running[e.currency]; }
  const records = (d.legacyRecords ?? []).filter(r => r.vendorId === vendorId);
  const currencies = [...new Set([...events.map(e => e.currency), ...orders.map(o => o.currency), ...records.map(r => r.currency)])].filter(Boolean).sort();
  const balances = currencies.map(currency => {
    const rows = events.filter(e => e.currency === currency && !e.reversed);
    const activeOrders = orders.filter(o => o.currency === currency && o.status !== "Cancelled");
    const due = activeOrders.filter(o => o.totalKnown).reduce((s, o) => s + o.due, 0);
    const expenses = records.filter(r => r.kind === "Expense" && r.currency === currency && r.status === "Open").reduce((s, r) => s + r.amount, 0);
    const held = vendorHeld(vendorId, currency, d);
    return { currency, received: rows.reduce((s, e) => s + e.credited, 0), used: rows.reduce((s, e) => s + e.debited, 0), held, due, expenses, afterCommitments: held - due - expenses, unknownOrders: activeOrders.filter(o => !o.totalKnown).length };
  });
  return { orders, events: events.reverse(), balances, records };
}
