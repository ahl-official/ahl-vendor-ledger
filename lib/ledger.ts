import type { Application, Contact, MoneyMovement, Order, OrderItem, Transfer } from "./schema";

export interface LedgerData {
  contacts: Contact[];
  orders: Order[];
  orderItems: OrderItem[];
  movements: MoneyMovement[];
  applications: Application[];
  transfers: Transfer[];
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
  return { total, paid, due: Math.max(0, total - paid) };
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
  // counting it here would cancel out its own transfersOut below.
  const transfersIn = d.transfers
    .filter((t) => t.purpose === "Transfer" && t.toContactId === vendorId && !t.reversed && t.currency === currency)
    .reduce((s, t) => s + t.amount, 0);
  const appliedOut = d.applications
    .filter((a) => a.active)
    .filter((a) => d.movements.some((m) => m.id === a.movementId && m.payeeId === vendorId && m.currency === currency))
    .reduce((s, a) => s + a.amount, 0);
  const transfersOut = d.transfers
    .filter((t) => t.fromVendorId === vendorId && !t.reversed && t.currency === currency)
    .reduce((s, t) => s + t.amount, 0);
  return receivedIn + transfersIn - appliedOut - transfersOut;
}

/** Per-currency running position for an agent: positive = agent still holds company funding,
 *  negative = agent spent/returned more than funded, i.e. company owes the agent. */
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
  return byCurrency;
}

export function contactName(id: string, contacts: Contact[]): string {
  return contacts.find((c) => c.id === id)?.name ?? id;
}
