import type { Application, Contact, CreditNote, FxConversion, LegacyRecord, MoneyMovement, Order, OrderItem, Transfer } from "./schema.ts";

export interface LedgerData {
  contacts: Contact[];
  orders: Order[];
  orderItems: OrderItem[];
  movements: MoneyMovement[];
  applications: Application[];
  transfers: Transfer[];
  fxConversions: FxConversion[];
  creditNotes?: CreditNote[];
  legacyRecords?: LegacyRecord[];
}

export function orderTotal(order: Order, items: OrderItem[]): number {
  const lines = items.filter((i) => i.orderId === order.id);
  if (!lines.length && order.legacyTotal != null) return order.legacyTotal;
  const itemsTotal = lines.reduce((s, i) => s + i.lineTotal, 0);
  return itemsTotal + order.shippingFee + order.adjustment;
}

export function orderPaid(orderId: string, applications: Application[], transfers: Transfer[]): number {
  const fromApps = applications
    .filter((a) => a.orderId === orderId && a.active)
    .reduce((s, a) => s + a.amount, 0);
  // A vendor-to-vendor transfer can also fund the RECEIVING vendor's order.
  const fromTransfers = transfers
    .filter((t) => t.receivingOrderId === orderId && !t.reversed)
    .reduce((s, t) => s + t.amount, 0);
  return fromApps + fromTransfers;
}

export function orderSummary(order: Order, d: LedgerData) {
  const total = orderTotal(order, d.orderItems);
  const paid = orderPaid(order.id, d.applications, d.transfers);
  const creditNotes = (d.creditNotes ?? [])
    .filter((c) => c.orderId === order.id && !c.reversed)
    .reduce((s, c) => s + c.amount, 0);
  const netCost = Math.max(0, total - creditNotes);
  return {
    totalKnown: order.totalKnown !== false,
    total,
    paid,
    creditNotes,
    netCost,
    due: Math.max(0, total - creditNotes - paid),
  };
}

/** A "receipt" is a vendor-payee movement. The vendor is always paid through the agent, so this is
 *  just AgentToVendor -- there is no direct CompanyToVendor path. */
export function isReceipt(m: MoneyMovement): boolean {
  return !m.reversed && (m.type === "AgentToVendor" || m.type === "LegacyCompanyToVendor");
}

/** How much of a receipt's amount is still unapplied / untransferred — what "Use Vendor Balance" can spend. */
export function movementRemaining(movementId: string, d: LedgerData): number {
  const source = balanceSource(movementId, d);
  if (!source) return 0;
  return vendorOpenReceipts(source.payeeId, d).find(r => r.movement.id === movementId)?.remaining ?? 0;
}

export interface BalanceSource {
  id: string; payeeId: string; currency: string; amount: number; date: string; createdAt: string;
  kind: "Receipt" | "Transfer" | "CreditNote";
}

/** Source IDs remain the original movement/transfer/credit IDs, never synthetic cash. */
export function balanceSource(id: string, d: LedgerData): BalanceSource | undefined {
  const m = d.movements.find(m => m.id === id && isReceipt(m));
  if (m) return { ...m, kind: "Receipt" };
  const t = d.transfers.find(t => t.id === id && !t.reversed && t.purpose === "Transfer" && !t.receivingOrderId);
  if (t) return { id: t.id, payeeId: t.toContactId, currency: t.currency, amount: t.amount, date: t.date ?? t.createdAt.slice(0, 10), createdAt: t.createdAt, kind: "Transfer" };
  const c = d.creditNotes?.find(c => c.id === id && !c.reversed);
  if (c) return { id: c.id, payeeId: c.vendorId, currency: c.currency, amount: c.amount, date: c.date, createdAt: c.createdAt, kind: "CreditNote" };
}

/** All spendable sources. Imported pooled transfers are reserved FIFO without inventing events. */
export function vendorOpenReceipts(vendorId: string, d: LedgerData) {
  const sources = [...d.movements.map(x => x.id), ...d.transfers.map(x => x.id), ...(d.creditNotes ?? []).map(x => x.id)]
    .map(id => balanceSource(id, d)).filter((s): s is BalanceSource => !!s && s.payeeId === vendorId)
    .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.id.localeCompare(b.id));
  const pooled: Record<string, number> = {};
  for (const t of d.transfers.filter(t => !t.reversed && t.fromVendorId === vendorId && !t.sourceMovementId)) pooled[t.currency] = (pooled[t.currency] ?? 0) + t.amount;
  return sources.map(movement => {
    const direct = d.applications.filter(a => a.active && a.movementId === movement.id).reduce((s, a) => s + a.amount, 0)
      + d.transfers.filter(t => !t.reversed && t.sourceMovementId === movement.id).reduce((s, t) => s + t.amount, 0);
    const available = Math.max(0, movement.amount - direct);
    const reserved = Math.min(available, pooled[movement.currency] ?? 0);
    pooled[movement.currency] = Math.max(0, (pooled[movement.currency] ?? 0) - reserved);
    return { movement, remaining: available - reserved };
  }).filter(r => r.remaining > 0.001);
}

export function vendorHeld(vendorId: string, currency: string, d: LedgerData): number {
  const receivedIn = d.movements
    .filter((m) => isReceipt(m) && m.payeeId === vendorId && m.currency === currency)
    .reduce((s, m) => s + m.amount, 0);
  // Only purpose "Transfer" (vendor-to-vendor) is a real incoming balance for the recipient.
  // A refund's toContactId is just where the money went, not a vendor gaining held funds —
  // counting it here would cancel out its own transfersOut below. A transfer sent straight to
  // one of the recipient's orders (receivingOrderId set) was spent on arrival -- orderPaid()
  // already counts it there, so it must NOT also inflate held balance here, or that amount
  // would be counted as both "paid" and "still available" at once.
  const transfersIn = d.transfers
    .filter((t) => t.purpose === "Transfer" && t.toContactId === vendorId && !t.reversed && t.currency === currency && !t.receivingOrderId)
    .reduce((s, t) => s + t.amount, 0);
  const creditNotesIn = (d.creditNotes ?? [])
    .filter((c) => c.vendorId === vendorId && !c.reversed && c.currency === currency)
    .reduce((s, c) => s + c.amount, 0);
  const appliedOut = d.applications
    .filter((a) => a.active)
    .filter((a) => { const s = balanceSource(a.movementId, d); return s?.payeeId === vendorId && s.currency === currency; })
    .reduce((s, a) => s + a.amount, 0);
  const transfersOut = d.transfers
    .filter((t) => t.fromVendorId === vendorId && !t.reversed && t.currency === currency)
    .reduce((s, t) => s + t.amount, 0);
  return receivedIn + transfersIn + creditNotesIn - appliedOut - transfersOut;
}

/** How much of a CompanyToAgent funding movement is still unlinked to any FX conversion. */
export function fundingRemaining(movementId: string, d: LedgerData): number {
  const movement = d.movements.find((m) => m.id === movementId);
  if (!movement) return 0;
  const consumed = d.fxConversions
    .filter((c) => c.fundingMovementId === movementId && !c.reversed)
    .reduce((s, c) => s + c.fromAmount, 0);
  return movement.amount - consumed;
}

/** How much of an AgentToVendor/AgentToCompany spend is still unbacked by any FX conversion
 *  — i.e. still showing as "company owes" on the agent's position in that currency. */
export function spendUnbacked(movementId: string, d: LedgerData): number {
  const movement = d.movements.find((m) => m.id === movementId);
  if (!movement) return 0;
  const backed = d.fxConversions
    .filter((c) => c.spendMovementId === movementId && !c.reversed)
    .reduce((s, c) => s + c.toAmount, 0);
  return movement.amount - backed;
}

/** Every CompanyToAgent funding for this agent with unconverted INR (or whatever currency) left. */
export function agentOpenFundings(agentId: string, d: LedgerData) {
  return d.movements
    .filter((m) => !m.reversed && m.type === "CompanyToAgent" && m.payeeId === agentId)
    .map((m) => ({ movement: m, remaining: fundingRemaining(m.id, d) }))
    .filter((r) => r.remaining > 0.001);
}

/** Every AgentToVendor/AgentToCompany spend for this agent still showing as unbacked. */
export function agentOpenSpends(agentId: string, d: LedgerData) {
  return d.movements
    .filter((m) => !m.reversed && (m.type === "AgentToVendor" || m.type === "AgentToCompany") && m.payerId === agentId)
    .map((m) => ({ movement: m, remaining: spendUnbacked(m.id, d) }))
    .filter((r) => r.remaining > 0.001);
}

/** Per-currency running position for an agent: positive = agent still holds company funding,
 *  negative = agent spent/returned more than funded, i.e. company owes the agent. An FX
 *  conversion explicitly ties a funding to a spend across currencies: it consumes the
 *  funding (reduces that currency's position) and backs the spend (restores the other
 *  currency's position by the same confirmed amount) — nothing here is automatic. */
export function agentPosition(agentId: string, d: LedgerData): Record<string, number> {
  const byCurrency: Record<string, number> = {};
  const add = (currency: string, delta: number) => {
    byCurrency[currency] = (byCurrency[currency] ?? 0) + delta;
  };
  for (const m of d.movements) {
    if (m.reversed) continue;
    if (m.type === "CompanyToAgent" && m.payeeId === agentId) add(m.currency, m.amount);
    if (m.type === "AgentToVendor" && m.payerId === agentId) add(m.currency, -m.amount);
    if (m.type === "AgentToCompany" && m.payerId === agentId) add(m.currency, -m.amount);
  }
  for (const c of d.fxConversions) {
    if (c.reversed || c.agentId !== agentId) continue;
    // Defend against an orphaned conversion (its funding/spend row was cleared, e.g. by
    // npm run clear:test-activity) still silently skewing the position.
    const fundingExists = d.movements.some((m) => m.id === c.fundingMovementId);
    const spendExists = d.movements.some((m) => m.id === c.spendMovementId);
    if (!fundingExists || !spendExists) continue;
    add(c.fromCurrency, -c.fromAmount);
    add(c.toCurrency, c.toAmount);
  }
  return byCurrency;
}

export function contactName(id: string, contacts: Contact[]): string {
  return contacts.find((c) => c.id === id)?.name ?? id;
}
