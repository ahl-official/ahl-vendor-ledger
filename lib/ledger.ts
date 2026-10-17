import type { Application, Contact, CreditNote, FxConversion, MoneyMovement, Order, OrderItem, Transfer } from "./schema";

export interface LedgerData {
  contacts: Contact[];
  orders: Order[];
  orderItems: OrderItem[];
  movements: MoneyMovement[];
  applications: Application[];
  transfers: Transfer[];
  fxConversions: FxConversion[];
  creditNotes?: CreditNote[];
}

export function orderTotal(order: Order, items: OrderItem[]): number {
  const itemsTotal = items.filter((i) => i.orderId === order.id).reduce((s, i) => s + i.lineTotal, 0);
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
  return !m.reversed && m.type === "AgentToVendor";
}

/** How much of a receipt's amount is still unapplied / untransferred — what "Use Vendor Balance" can spend. */
export function movementRemaining(movementId: string, d: LedgerData): number {
  const movement = d.movements.find((m) => m.id === movementId);
  if (!movement) return 0;
  const applied = d.applications
    .filter((a) => a.movementId === movementId && a.active)
    .reduce((s, a) => s + a.amount, 0);
  const transferredOut = d.transfers
    .filter((t) => t.sourceMovementId === movementId && !t.reversed)
    .reduce((s, t) => s + t.amount, 0);
  return movement.amount - applied - transferredOut;
}

/** Every receipt a vendor has with money still sitting unused, per currency. */
export function vendorOpenReceipts(vendorId: string, d: LedgerData) {
  return d.movements
    .filter((m) => isReceipt(m) && m.payeeId === vendorId)
    .map((m) => ({ movement: m, remaining: movementRemaining(m.id, d) }))
    .filter((r) => r.remaining > 0.001);
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
    .filter((a) => d.movements.some((m) => m.id === a.movementId && m.payeeId === vendorId && m.currency === currency))
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
