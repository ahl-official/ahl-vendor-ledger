import { balanceSource, contactName, convertByRate, orderSummary, vendorHeld, type LedgerData } from "./ledger.ts";

export interface StatementEvent {
  id: string; kind: "movement" | "transfer" | "application" | "credit_note";
  date: string; createdAt: string; label: string; currency: string; credited: number; debited: number;
  balance: number; reversed: boolean; note: string; proofUrl: string; legacy: boolean;
  groupIds?: string[];
}

/** A single user action can write several rows of the same kind: one vendor-to-vendor transfer
 * can draw from several source receipts (see app/api/transfers/route.ts), and one "Apply to
 * Order" can likewise be split FIFO across several of the vendor's receipts (see
 * app/api/applications/route.ts). Shown separately they look like unrelated part-payments or
 * duplicate charges; merge rows written by the same action (same moment, same label/currency/
 * reversed state) back into one statement line, keeping every underlying id for void/edit.
 * `date` is part of the key too -- a single action always writes the same date to every row
 * it splits into, but a bulk historical import can share one `createdAt` (the import batch
 * moment) across many genuinely separate real-world transactions on different dates; without
 * `date` in the key those would wrongly merge into one. */
function mergeSplitEvents(events: StatementEvent[]): StatementEvent[] {
  const merged = new Map<string, StatementEvent>();
  const order: StatementEvent[] = [];
  for (const e of events) {
    const key = `${e.date}|${e.createdAt}|${e.label}|${e.currency}|${e.reversed}`;
    const existing = merged.get(key);
    if (existing) {
      existing.credited += e.credited;
      existing.debited += e.debited;
      existing.groupIds!.push(e.id);
    } else {
      const copy = { ...e, groupIds: [e.id] };
      merged.set(key, copy);
      order.push(copy);
    }
  }
  return order;
}

/** When a vendor has opted into a display currency, convert each movement/transfer event into
 *  it IF that specific entry was itself given a rate into that exact currency when it was
 *  recorded -- never a guessed or borrowed rate. Applications and credit notes have no rate
 *  field, so they're left in their native currency; so is any movement/transfer whose saved
 *  rate targets a different currency than the one chosen here. This only changes how the
 *  Ledger page/export DISPLAY this vendor's history -- vendorHeld/spending/order-matching are
 *  untouched, so it can never misstate what's actually spendable. */
function applyDisplayCurrency(events: StatementEvent[], vendorId: string, d: LedgerData) {
  const target = d.contacts.find(c => c.id === vendorId)?.displayCurrency || "";
  if (!target) return;
  for (const e of events) {
    if (e.currency === target) continue;
    let rate: number | null | undefined, rateCurrency: string | undefined;
    if (e.kind === "movement") {
      const m = d.movements.find(x => x.id === e.id);
      rate = m?.quotedRate ?? m?.actualRate;
      rateCurrency = m?.rateCurrency;
    } else if (e.kind === "transfer") {
      const ids = e.groupIds?.length ? e.groupIds : [e.id];
      const t = d.transfers.find(x => ids.includes(x.id) && x.rate && x.rateCurrency);
      rate = t?.rate;
      rateCurrency = t?.rateCurrency;
    }
    if (!rate || rate <= 0 || rateCurrency !== target) continue;
    const fromCurrency = e.currency;
    e.note = [e.note, `Converted @ ${rate}: ${fromCurrency} ${(e.credited || e.debited).toFixed(2)} → ${target}`].filter(Boolean).join("\n\n");
    if (e.credited) e.credited = convertByRate(e.credited, rate, fromCurrency, target);
    if (e.debited) e.debited = convertByRate(e.debited, rate, fromCurrency, target);
    e.currency = target;
  }
}

/** A statement of actual held funds. Orders/expenses are separate commitments, not cash. */
export function vendorAccount(vendorId: string, d: LedgerData) {
  const name = (id: string) => contactName(id, d.contacts);
  const orders = d.orders.filter(o => o.vendorId === vendorId).map(o => ({ ...o, ...orderSummary(o, d) }));
  const events: StatementEvent[] = [];
  const consumedApplicationIds = new Set<string>();
  for (const m of d.movements.filter(m => m.payeeId === vendorId && (m.type === "AgentToVendor" || m.type === "CompanyToVendor" || m.type === "LegacyCompanyToVendor" || m.type === "OpeningBalance"))) {
    // "Record Money Movement" can apply part (or all) of a receipt to an order in the very
    // same action (see app/api/movements/route.ts) -- always the same exact createdAt as
    // this movement, never a later, separate "Apply to Order" click (which would have its
    // own, different createdAt). Shown as two lines -- a credit, then a debit that
    // immediately cancels some or all of it -- they read as if money arrived and then
    // mysteriously left again; fold the matching application(s) back into this one line
    // instead. The net balance effect is identical (received minus applied = what's
    // actually still held) -- this only changes how many rows one real event takes.
    const paidNow = !m.reversed ? d.applications.filter(a => a.active && a.movementId === m.id && a.createdAt === m.createdAt) : [];
    paidNow.forEach(a => consumedApplicationIds.add(a.id));
    const appliedTotal = Math.round(paidNow.reduce((s, a) => s + a.amount, 0) * 100) / 100;
    const orderRefs = paidNow.map(a => orders.find(o => o.id === a.orderId)?.invoiceRef || a.orderId);
    const label = m.type === "OpeningBalance"
      ? "Opening balance carried forward"
      : `Received from ${name(m.payerId)}${orderRefs.length ? ` · paid ${orderRefs.join(", ")}` : ""}`;
    events.push({ id: m.id, kind: "movement", date: m.date, createdAt: m.createdAt, label, currency: m.currency, credited: m.amount, debited: appliedTotal, balance: 0, reversed: m.reversed, note: m.note, proofUrl: m.proofUrl, legacy: !!m.legacyId });
  }
  const transferEvents: StatementEvent[] = [];
  for (const t of d.transfers.filter(t => t.fromVendorId === vendorId || (t.purpose === "Transfer" && t.toContactId === vendorId))) {
    const incoming = t.fromVendorId !== vendorId;
    const order = orders.find(o => o.id === t.receivingOrderId);
    const label = incoming ? `Transfer from ${name(t.fromVendorId)}${order ? ` · paid ${order.invoiceRef || order.id}` : " · on account"}` : `${t.purpose === "PaySupplier" ? "Supplier payment to" : t.purpose === "Refund" ? "Refund to" : t.purpose === "Expense" ? "Expense — paid to" : "Transfer to"} ${name(t.toContactId)}`;
    // On the receiver's own ledger, show what they were actually credited -- toCurrency/
    // toAmount when the sender spent a different currency (see app/api/transfers/route.ts),
    // otherwise the same amount/currency the sender spent, as before.
    const receiverCurrency = t.toCurrency || t.currency;
    const receiverAmount = t.toAmount ?? t.amount;
    transferEvents.push({ id: t.id, kind: "transfer", date: t.date ?? t.createdAt.slice(0, 10), createdAt: t.createdAt, label, currency: incoming ? receiverCurrency : t.currency, credited: incoming ? receiverAmount : 0, debited: !incoming || t.receivingOrderId ? t.amount : 0, balance: 0, reversed: t.reversed, note: t.note, proofUrl: t.proofUrl, legacy: !!t.legacyId });
  }
  events.push(...mergeSplitEvents(transferEvents));
  const applicationEvents: StatementEvent[] = [];
  for (const a of d.applications) {
    if (consumedApplicationIds.has(a.id)) continue; // already folded into its source movement's own row above
    // Include voided receipt history as well as applications of incoming transfers/credits.
    // Legacy rows trace back to a specific movementId; current ones (see
    // app/api/applications/route.ts) carry vendorId/currency directly instead -- either way
    // works here, and a shortfall beyond what's held just shows up as a negative balance,
    // not a different kind of row.
    const source = a.movementId ? balanceSource(a.movementId, d) : undefined;
    const receipt = a.movementId ? d.movements.find(m => m.id === a.movementId && m.payeeId === vendorId) : undefined;
    const direct = !a.movementId && a.vendorId === vendorId;
    if (!direct && source?.payeeId !== vendorId && !receipt) continue;
    const order = orders.find(o => o.id === a.orderId);
    applicationEvents.push({ id: a.id, kind: "application", date: a.date ?? a.createdAt.slice(0, 10), createdAt: a.createdAt, label: `Applied to order ${order?.invoiceRef || a.orderId}`, currency: source?.currency ?? receipt?.currency ?? a.currency ?? order?.currency ?? "", credited: 0, debited: a.amount, balance: 0, reversed: !a.active || !!receipt?.reversed, note: a.reversedReason || "", proofUrl: receipt?.proofUrl ?? "", legacy: !!a.legacyId });
  }
  events.push(...mergeSplitEvents(applicationEvents));
  for (const c of (d.creditNotes ?? []).filter(c => c.vendorId === vendorId)) {
    events.push({ id: c.id, kind: "credit_note", date: c.date, createdAt: c.createdAt, label: c.orderId ? `Credit note · ${orders.find(o => o.id === c.orderId)?.invoiceRef || c.orderId}` : "Vendor credit on account", currency: c.currency, credited: c.amount, debited: 0, balance: 0, reversed: c.reversed, note: c.reason, proofUrl: "", legacy: false });
  }
  applyDisplayCurrency(events, vendorId, d);
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
