import { readRows, readRowsBatch } from "./sheets";
import type { Application, Contact, CreditNote, FxConversion, MoneyMovement, Order, OrderItem, Role, Transfer } from "./schema";

const bool = (v: string) => v === "TRUE" || v === "true";
const num = (v: string) => (v === "" ? 0 : Number(v));
const numOrNull = (v: string) => (v === "" ? null : Number(v));
type Row = Record<string, string>;

const parseContacts = (rows: Row[]): Contact[] =>
  rows.filter((r) => r.id).map((r) => ({
    id: r.id,
    name: r.name,
    roles: r.roles ? (r.roles.split(",").map((s) => s.trim()) as Role[]) : [],
    contact: r.contact,
    notes: r.notes,
    active: bool(r.active),
    legacyId: r.legacyId,
    createdAt: r.createdAt,
  })).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

const parseOrders = (rows: Row[]): Order[] =>
  rows.filter((r) => r.id).map((r) => ({
    id: r.id,
    vendorId: r.vendorId,
    invoiceRef: r.invoiceRef,
    date: r.date,
    currency: r.currency,
    shippingFee: num(r.shippingFee),
    adjustment: num(r.adjustment),
    notes: r.notes,
    proofUrl: r.proofUrl,
    createdAt: r.createdAt,
  }));

const parseOrderItems = (rows: Row[]): OrderItem[] =>
  rows.filter((r) => r.id).map((r) => ({
    id: r.id,
    orderId: r.orderId,
    description: r.description,
    sku: r.sku,
    qty: num(r.qty),
    unit: r.unit,
    unitPrice: num(r.unitPrice),
    lineTotal: num(r.lineTotal),
    createdAt: r.createdAt,
  }));

const parseMovements = (rows: Row[]): MoneyMovement[] =>
  rows.filter((r) => r.id).map((r) => ({
    id: r.id,
    date: r.date,
    type: r.type as MoneyMovement["type"],
    payerId: r.payerId,
    payeeId: r.payeeId,
    amount: num(r.amount),
    currency: r.currency,
    actualRate: numOrNull(r.actualRate),
    quotedRate: numOrNull(r.quotedRate),
    agentFee: numOrNull(r.agentFee),
    paymentUse: r.paymentUse as MoneyMovement["paymentUse"],
    method: r.method,
    reference: r.reference,
    proofUrl: r.proofUrl,
    note: r.note,
    reversed: bool(r.reversed),
    reversedReason: r.reversedReason,
    idempotencyKey: r.idempotencyKey,
    createdAt: r.createdAt,
    createdBy: r.createdBy,
  }));

const parseApplications = (rows: Row[]): Application[] =>
  rows.filter((r) => r.id).map((r) => ({
    id: r.id,
    movementId: r.movementId,
    orderId: r.orderId,
    amount: num(r.amount),
    active: bool(r.active),
    reversedReason: r.reversedReason,
    createdAt: r.createdAt,
  }));

const parseTransfers = (rows: Row[]): Transfer[] =>
  rows.filter((r) => r.id).map((r) => ({
    id: r.id,
    sourceMovementId: r.sourceMovementId,
    fromVendorId: r.fromVendorId,
    toContactId: r.toContactId,
    purpose: r.purpose as Transfer["purpose"],
    amount: num(r.amount),
    currency: r.currency,
    receivingOrderId: r.receivingOrderId,
    proofUrl: r.proofUrl,
    note: r.note,
    reversed: bool(r.reversed),
    reversedReason: r.reversedReason,
    createdAt: r.createdAt,
  }));

const parseFxConversions = (rows: Row[]): FxConversion[] =>
  rows.filter((r) => r.id).map((r) => ({
    id: r.id,
    agentId: r.agentId,
    fundingMovementId: r.fundingMovementId,
    spendMovementId: r.spendMovementId,
    fromCurrency: r.fromCurrency,
    fromAmount: num(r.fromAmount),
    toCurrency: r.toCurrency,
    toAmount: num(r.toAmount),
    note: r.note,
    reversed: bool(r.reversed),
    reversedReason: r.reversedReason,
    createdAt: r.createdAt,
  }));

const parseCreditNotes = (rows: Row[]): CreditNote[] =>
  rows.filter((r) => r.id).map((r) => ({
    id: r.id,
    orderId: r.orderId,
    vendorId: r.vendorId,
    date: r.date,
    amount: num(r.amount),
    currency: r.currency,
    reason: r.reason,
    reversed: bool(r.reversed),
    reversedReason: r.reversedReason,
    createdAt: r.createdAt,
  }));

export async function getContacts(): Promise<Contact[]> {
  return parseContacts(await readRows("Contacts"));
}
export async function getOrders(): Promise<Order[]> {
  return parseOrders(await readRows("Orders"));
}
export async function getOrderItems(): Promise<OrderItem[]> {
  return parseOrderItems(await readRows("Order_Items"));
}
export async function getMovements(): Promise<MoneyMovement[]> {
  return parseMovements(await readRows("Money_Movements"));
}
export async function getApplications(): Promise<Application[]> {
  return parseApplications(await readRows("Applications"));
}
export async function getTransfers(): Promise<Transfer[]> {
  return parseTransfers(await readRows("Transfers"));
}
export async function getFxConversions(): Promise<FxConversion[]> {
  return parseFxConversions(await readRows("FX_Conversions"));
}
export async function getCreditNotes(): Promise<CreditNote[]> {
  return parseCreditNotes(await readRows("Credit_Notes"));
}

export interface AllData {
  contacts: Contact[];
  orders: Order[];
  orderItems: OrderItem[];
  movements: MoneyMovement[];
  applications: Application[];
  transfers: Transfer[];
  fxConversions: FxConversion[];
  creditNotes: CreditNote[];
}

/** Everything a route needs, in ONE Sheets API call instead of up to seven. Use this whenever
 *  a handler touches more than one tab — see lib/sheets.ts readRowsBatch for why it matters. */
export async function getAllData(): Promise<AllData> {
  const [contacts, orders, orderItems, movements, applications, transfers, fxConversions, creditNotes] = await readRowsBatch([
    "Contacts", "Orders", "Order_Items", "Money_Movements", "Applications", "Transfers", "FX_Conversions", "Credit_Notes",
  ]);
  return {
    contacts: parseContacts(contacts),
    orders: parseOrders(orders),
    orderItems: parseOrderItems(orderItems),
    movements: parseMovements(movements),
    applications: parseApplications(applications),
    transfers: parseTransfers(transfers),
    fxConversions: parseFxConversions(fxConversions),
    creditNotes: parseCreditNotes(creditNotes),
  };
}
