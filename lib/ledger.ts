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

/** Whether `rate` naturally means "units of `from` per 1 unit of `to`" (so converting divides)
 *  vs "units of `to` per 1 unit of `from`" (so converting multiplies). Matches how people in
 *  this business actually quote each pair: INR is always quoted as INR-per-other-currency
 *  (~15 INR/RMB, ~83 INR/USD), so a rate FROM INR divides and a rate INTO INR multiplies; when
 *  INR isn't involved, RMB/USD is quoted as RMB-per-USD (~7.2), so FROM USD multiplies and FROM
 *  RMB (into USD) divides. Shared by the Record Money form and the auto-conversion in
 *  agentPosition/agentStatement so a saved rate is always interpreted the same way it was
 *  entered. */
function rateDividesFromSource(from: string, to: string): boolean {
  return from === "INR" || (from === "RMB" && to === "USD");
}

/** Converts `amount` (in `from`) into `to` using `rate`, applying the same auto-detect-
 *  orientation heuristic as the original single-pair (INR/USD → RMB) version: if the rate
 *  wasn't entered in the expected orientation (e.g. someone typed the inverse by mistake), a
 *  rate under 1 flips which operation is used. */
export function convertByRate(amount: number, rate: number, from: string, to: string): number {
  const divides = rateDividesFromSource(from, to);
  if (divides) return rate > 1 ? amount / rate : amount * rate;
  return rate > 1 ? amount * rate : amount / rate;
}

/** Inverse of convertByRate: given a known converted amount, back out what the rate must have
 *  been, in the same orientation convertByRate expects to read it back in. */
export function deriveRateFromConverted(amount: number, converted: number, from: string, to: string): number {
  return rateDividesFromSource(from, to) ? amount / converted : converted / amount;
}

/** Real money only ever has cents. Shared by every route that accepts a typed amount, so the
 *  rule (and its 0.001 float-safety margin) is defined once instead of copy-pasted per route. */
export function isValidMoneyAmount(amount: number): boolean {
  return Number.isFinite(amount) && amount > 0 && Math.abs(amount * 100 - Math.round(amount * 100)) <= 0.001;
}
export const INVALID_AMOUNT_ERROR = "Enter a positive amount with at most two decimals";

/** Walks `sources` (already filtered/sorted FIFO by the caller) drawing up to `amount`,
 *  rounding each step to cents so split amounts never drift. Returns one entry per source
 *  actually drawn from. Shared by Applications and Transfers (see their route.ts), which both
 *  FIFO-split a spend across a vendor's open receipts the same way -- the only difference is
 *  what each does with a draw afterward (one row for Applications; possibly two, split across
 *  order/on-account, for Transfers). Throws if the sources can't cover the full amount --
 *  callers are expected to have already checked that against vendorHeld before calling this. */
export function drawFifo<T extends { movement: { id: string }; remaining: number }>(
  sources: T[], amount: number
): { source: T; used: number }[] {
  let needed = Math.round(amount * 100) / 100;
  const draws: { source: T; used: number }[] = [];
  for (const source of sources) {
    const used = Math.round(Math.min(needed, source.remaining) * 100) / 100;
    if (used <= 0) break;
    draws.push({ source, used });
    needed = Math.round((needed - used) * 100) / 100;
  }
  if (needed > 0.001) throw new Error("Balance sources did not cover the full amount");
  return draws;
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

/** Vendor funding sources, including import-only historical receipts and balance carried forward.
 * OpeningBalance has no payer and does not represent a new cash payment or agent spend. */
export function isReceipt(m: MoneyMovement): boolean {
  return !m.reversed && (m.type === "AgentToVendor" || m.type === "CompanyToVendor" || m.type === "LegacyCompanyToVendor" || m.type === "OpeningBalance");
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
  if (m) {
    const target = d.contacts.find(c => c.id === m.payeeId)?.displayCurrency || "";
    const rate = m.quotedRate ?? m.actualRate;
    if (target && m.currency !== target && rate && rate > 0 && m.rateCurrency === target) {
      return { id: m.id, payeeId: m.payeeId, currency: target, amount: Math.round(convertByRate(m.amount, rate, m.currency, target) * 100) / 100, date: m.date, createdAt: m.createdAt, kind: "Receipt" };
    }
    return { ...m, kind: "Receipt" };
  }
  const t = d.transfers.find(t => t.id === id && !t.reversed && t.purpose === "Transfer" && !t.receivingOrderId);
  if (t) {
    const target = d.contacts.find(c => c.id === t.toContactId)?.displayCurrency || "";
    if (target && t.currency !== target && t.rate && t.rate > 0 && t.rateCurrency === target) {
      return { id: t.id, payeeId: t.toContactId, currency: target, amount: Math.round(convertByRate(t.amount, t.rate, t.currency, target) * 100) / 100, date: t.date ?? t.createdAt.slice(0, 10), createdAt: t.createdAt, kind: "Transfer" };
    }
    return { id: t.id, payeeId: t.toContactId, currency: t.currency, amount: t.amount, date: t.date ?? t.createdAt.slice(0, 10), createdAt: t.createdAt, kind: "Transfer" };
  }
  const c = d.creditNotes?.find(c => c.id === id && !c.reversed);
  if (c) return { id: c.id, payeeId: c.vendorId, currency: c.currency, amount: c.amount, date: c.date, createdAt: c.createdAt, kind: "CreditNote" };
}

/** All spendable sources. Imported pooled transfers are reserved FIFO without inventing events. */
export function vendorOpenReceipts(vendorId: string, d: LedgerData) {
  const target = d.contacts.find(c => c.id === vendorId)?.displayCurrency || "";
  const sources = [...d.movements.map(x => x.id), ...d.transfers.map(x => x.id), ...(d.creditNotes ?? []).map(x => x.id)]
    .map(id => balanceSource(id, d)).filter((s): s is BalanceSource => !!s && s.payeeId === vendorId)
    .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.id.localeCompare(b.id));
  const pooled: Record<string, number> = {};
  for (const t of d.transfers.filter(t => !t.reversed && t.fromVendorId === vendorId && !t.sourceMovementId)) {
    let curr = t.currency;
    let amt = t.amount;
    if (target && t.currency !== target && t.rate && t.rate > 0 && t.rateCurrency === target) {
      curr = target;
      amt = Math.round(convertByRate(t.amount, t.rate, t.currency, target) * 100) / 100;
    }
    pooled[curr] = (pooled[curr] ?? 0) + amt;
  }
  return sources.map(movement => {
    const direct = d.applications.filter(a => a.active && a.movementId === movement.id).reduce((s, a) => s + a.amount, 0)
      + d.transfers.filter(t => !t.reversed && t.sourceMovementId === movement.id).map(t => {
        if (target && t.currency !== target && t.rate && t.rate > 0 && t.rateCurrency === target) {
          return Math.round(convertByRate(t.amount, t.rate, t.currency, target) * 100) / 100;
        }
        return t.amount;
      }).reduce((s, a) => s + a, 0);
    const available = Math.max(0, movement.amount - direct);
    const reserved = Math.min(available, pooled[movement.currency] ?? 0);
    pooled[movement.currency] = Math.max(0, (pooled[movement.currency] ?? 0) - reserved);
    return { movement, remaining: available - reserved };
  }).filter(r => r.remaining > 0.001);
}

export function vendorHeld(vendorId: string, currency: string, d: LedgerData): number {
  const target = d.contacts.find(c => c.id === vendorId)?.displayCurrency || "";

  const receivedIn = d.movements
    .filter((m) => isReceipt(m) && m.payeeId === vendorId)
    .map((m) => {
      const rate = m.quotedRate ?? m.actualRate;
      if (target && m.currency !== target && rate && rate > 0 && m.rateCurrency === target) {
        return { currency: target, amount: Math.round(convertByRate(m.amount, rate, m.currency, target) * 100) / 100 };
      }
      return { currency: m.currency, amount: m.amount };
    })
    .filter((r) => r.currency === currency)
    .reduce((s, r) => s + r.amount, 0);

  // Only purpose "Transfer" (vendor-to-vendor) is a real incoming balance for the recipient.
  // A refund's toContactId is just where the money went, not a vendor gaining held funds —
  // counting it here would cancel out its own transfersOut below. A transfer sent straight to
  // one of the recipient's orders (receivingOrderId set) was spent on arrival -- orderPaid()
  // already counts it there, so it must NOT also inflate held balance here, or that amount
  // would be counted as both "paid" and "still available" at once.
  const transfersIn = d.transfers
    .filter((t) => t.purpose === "Transfer" && t.toContactId === vendorId && !t.reversed && !t.receivingOrderId)
    .map((t) => {
      if (target && t.currency !== target && t.rate && t.rate > 0 && t.rateCurrency === target) {
        return { currency: target, amount: Math.round(convertByRate(t.amount, t.rate, t.currency, target) * 100) / 100 };
      }
      return { currency: t.currency, amount: t.amount };
    })
    .filter((r) => r.currency === currency)
    .reduce((s, r) => s + r.amount, 0);

  const creditNotesIn = (d.creditNotes ?? [])
    .filter((c) => c.vendorId === vendorId && !c.reversed && c.currency === currency)
    .reduce((s, c) => s + c.amount, 0);

  const appliedOut = d.applications
    .filter((a) => a.active)
    .filter((a) => { const s = balanceSource(a.movementId, d); return s?.payeeId === vendorId && s.currency === currency; })
    .reduce((s, a) => s + a.amount, 0);

  const transfersOut = d.transfers
    .filter((t) => t.fromVendorId === vendorId && !t.reversed)
    .map((t) => {
      if (target && t.currency !== target && t.rate && t.rate > 0 && t.rateCurrency === target) {
        return { currency: target, amount: Math.round(convertByRate(t.amount, t.rate, t.currency, target) * 100) / 100 };
      }
      return { currency: t.currency, amount: t.amount };
    })
    .filter((r) => r.currency === currency)
    .reduce((s, r) => s + r.amount, 0);

  return Math.round((receivedIn + transfersIn + creditNotesIn - appliedOut - transfersOut) * 100) / 100;
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

/** Whether and how a CompanyToAgent funding movement should be auto-converted using its own
 *  saved rate (quotedRate/actualRate, into rateCurrency), when not explicitly linked via an FX
 *  conversion -- null if it's not that type, isn't actually converting (same currency), or has
 *  no usable rate. Shared by agentPosition and agentStatement (lib/agent-statement.ts), which
 *  both apply this exact rule -- one of them used to duplicate it independently. */
export function fundingAutoConversion(m: MoneyMovement): { target: string; rate: number; amount: number } | null {
  if (m.type !== "CompanyToAgent") return null;
  const target = m.rateCurrency || "RMB";
  if (m.currency === target) return null;
  const rate = m.quotedRate ?? m.actualRate;
  if (!rate || rate <= 0) return null;
  return { target, rate, amount: convertByRate(m.amount, rate, m.currency, target) };
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
  const convertedFundings = new Set<string>();
  for (const c of d.fxConversions) {
    if (c.reversed || c.agentId !== agentId) continue;
    // Defend against an orphaned conversion (its funding/spend row was cleared, e.g. by
    // npm run clear:test-activity) still silently skewing the position.
    const fundingExists = d.movements.some((m) => m.id === c.fundingMovementId);
    const spendExists = d.movements.some((m) => m.id === c.spendMovementId);
    if (!fundingExists || !spendExists) continue;
    convertedFundings.add(c.fundingMovementId);
    add(c.fromCurrency, -c.fromAmount);
    add(c.toCurrency, c.toAmount);
  }
  // If a funding movement has a quoted or actual rate and no explicit FX conversion, convert it
  // into whatever currency that rate was recorded for (rateCurrency; defaults to RMB).
  for (const m of d.movements) {
    if (m.reversed || m.payeeId !== agentId || convertedFundings.has(m.id)) continue;
    const conv = fundingAutoConversion(m);
    if (conv) {
      add(m.currency, -m.amount);
      add(conv.target, conv.amount);
    }
  }
  return byCurrency;
}

export function contactName(id: string, contacts: Contact[]): string {
  return contacts.find((c) => c.id === id)?.name ?? id;
}
