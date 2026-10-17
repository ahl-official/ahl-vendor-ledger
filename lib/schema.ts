// Sheet tab names and column headers. Order of fields = column order in the sheet.
// V1 scope decisions (see PRD.md): no separate FX_Deals/Audit_Log/Ledger_Summary tabs —
// FX fields live on the movement row itself, every table is append-only (reversed flag
// instead of edits) so the rows ARE the audit trail, and ledger totals are computed live
// from source rows instead of cached.

export const SHEETS = {
  Contacts: [
    "id", "name", "roles", "contact", "notes", "active", "legacyId", "createdAt",
  ],
  Orders: [
    "id", "vendorId", "invoiceRef", "date", "currency", "shippingFee", "adjustment",
    "notes", "proofUrl", "createdAt",
  ],
  Order_Items: [
    "id", "orderId", "description", "sku", "qty", "unit", "unitPrice", "lineTotal", "createdAt",
  ],
  // A "receipt" movement is AgentToVendor -- the only type a vendor can apply to an order
  // or hold on-account. CompanyToAgent / AgentToCompany are pure funding events between
  // company and agent and are never applied to an order. There is no CompanyToVendor: the
  // vendor is always paid through the agent (confirmed business rule, 16 Oct 2026).
  Money_Movements: [
    "id", "date", "type", "payerId", "payeeId", "amount", "currency",
    "actualRate", "quotedRate", "agentFee",
    "paymentUse", // OrderOnly | OnAccountOnly | OrderPlusOnAccount | "" (non-vendor movement)
    "method", "reference", "proofUrl", "note",
    "reversed", "reversedReason", "idempotencyKey", "createdAt", "createdBy",
  ],
  // Spends part (or all) of a vendor receipt against an order.
  Applications: [
    "id", "movementId", "orderId", "amount", "active", "reversedReason", "createdAt",
  ],
  // Spends part (or all) of a vendor's held balance on something other than "its own order":
  // another vendor, an external supplier, or a refund back out of the system.
  Transfers: [
    "id", "sourceMovementId", "fromVendorId", "toContactId", "purpose",
    "amount", "currency", "receivingOrderId", "proofUrl", "note",
    "reversed", "reversedReason", "createdAt",
  ],
  // Explicitly links an agent's INR funding (a CompanyToAgent movement) to the RMB (or
  // other-currency) payout it paid for (an AgentToVendor/AgentToCompany movement). Never
  // auto-created — the agent position stays two separate currency lines until someone
  // confirms "this funding is what paid for that payout." See lib/ledger.ts agentPosition.
  FX_Conversions: [
    "id", "agentId", "fundingMovementId", "spendMovementId",
    "fromCurrency", "fromAmount", "toCurrency", "toAmount",
    "note", "reversed", "reversedReason", "createdAt",
  ],
} as const;

export type SheetName = keyof typeof SHEETS;

// "Other" is for directory-only contacts that don't fit a money-flow role yet —
// e.g. Kevin, who owes the company money (a receivable); V1 has no receivables flow,
// so he's just a reference entry until that's built.
export const ROLES = ["Vendor", "Supplier", "Agent", "Company", "Other"] as const;
export type Role = (typeof ROLES)[number];

export const MOVEMENT_TYPES = [
  "CompanyToAgent", "AgentToCompany", "AgentToVendor",
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const PAYMENT_USES = ["OrderOnly", "OnAccountOnly", "OrderPlusOnAccount"] as const;
export type PaymentUse = (typeof PAYMENT_USES)[number];

export const TRANSFER_PURPOSES = ["Transfer", "PaySupplier", "Refund"] as const;
export type TransferPurpose = (typeof TRANSFER_PURPOSES)[number];

export interface Contact {
  id: string; name: string; roles: Role[]; contact: string; notes: string;
  active: boolean; legacyId: string; createdAt: string;
}

export interface Order {
  id: string; vendorId: string; invoiceRef: string; date: string; currency: string;
  shippingFee: number; adjustment: number; notes: string; proofUrl: string; createdAt: string;
}

export interface OrderItem {
  id: string; orderId: string; description: string; sku: string;
  qty: number; unit: string; unitPrice: number; lineTotal: number; createdAt: string;
}

export interface MoneyMovement {
  id: string; date: string; type: MovementType; payerId: string; payeeId: string;
  amount: number; currency: string;
  actualRate: number | null; quotedRate: number | null; agentFee: number | null;
  paymentUse: PaymentUse | "";
  method: string; reference: string; proofUrl: string; note: string;
  reversed: boolean; reversedReason: string; idempotencyKey: string;
  createdAt: string; createdBy: string;
}

export interface Application {
  id: string; movementId: string; orderId: string; amount: number;
  active: boolean; reversedReason: string; createdAt: string;
}

export interface Transfer {
  id: string; sourceMovementId: string; fromVendorId: string; toContactId: string;
  purpose: TransferPurpose; amount: number; currency: string;
  receivingOrderId: string; proofUrl: string; note: string;
  reversed: boolean; reversedReason: string; createdAt: string;
}

export interface FxConversion {
  id: string; agentId: string; fundingMovementId: string; spendMovementId: string;
  fromCurrency: string; fromAmount: number; toCurrency: string; toAmount: number;
  note: string; reversed: boolean; reversedReason: string; createdAt: string;
}
