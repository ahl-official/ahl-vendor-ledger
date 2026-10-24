// Sheet tab names and column headers. Order of fields = column order in the sheet.
// V1 scope decisions (see PRD.md): no separate FX_Deals/Audit_Log/Ledger_Summary tabs —
// FX fields live on the movement row itself, every table is append-only (reversed flag
// instead of edits) so the rows ARE the audit trail, and ledger totals are computed live
// from source rows instead of cached.

export const SHEETS = {
  Contacts: [
    "id", "name", "roles", "contact", "notes", "active", "legacyId", "createdAt", "region",
    // Vendor-only, opt-in: when set, the Ledger page shows this vendor's history/balance
    // converted into this currency wherever a rate was actually saved on the entry -- never
    // guessed. Off (blank) by default; must be turned on deliberately per vendor. Appended at
    // the end -- see the rateCurrency comment on Money_Movements for why.
    "displayCurrency",
  ],
  Orders: [
    "id", "vendorId", "invoiceRef", "date", "currency", "shippingFee", "adjustment",
    "notes", "proofUrl", "createdAt", "legacyTotal", "totalKnown", "status", "legacyId", "reviewNote",
  ],
  Order_Items: [
    "id", "orderId", "description", "sku", "qty", "unit", "unitPrice", "lineTotal", "createdAt",
  ],
  // AgentToVendor and CompanyToVendor receipts can fund orders or remain on account.
  // CompanyToAgent / AgentToCompany only change company-agent funding positions.
  Money_Movements: [
    "id", "date", "type", "payerId", "payeeId", "amount", "currency",
    "actualRate", "quotedRate", "agentFee",
    "paymentUse", // OrderOnly | OnAccountOnly | OrderPlusOnAccount | "" (non-vendor movement)
    "method", "reference", "proofUrl", "note",
    "reversed", "reversedReason", "idempotencyKey", "createdAt", "createdBy", "legacyId",
    "rateCurrency", // what actualRate/quotedRate convert INTO; defaults to RMB when blank. Appended
    // at the end, not inserted among the older columns -- columns here are positional (see
    // lib/sheets.ts), so a column added anywhere but last would misalign every column after it
    // against rows the live sheet already has.
  ],
  // Spends part (or all) of a vendor receipt against an order.
  Applications: [
    "id", "movementId", "orderId", "amount", "active", "reversedReason", "createdAt", "date", "legacyId",
    // Appended at the end, same reason as Transfers' rate/rateCurrency below: only set on an
    // advance application (empty movementId), so existing rows stay valid with these blank.
    "vendorId", "currency",
  ],
  // Spends part (or all) of a vendor's held balance on something other than "its own order":
  // another vendor, an external supplier, or a refund back out of the system.
  Transfers: [
    "id", "sourceMovementId", "fromVendorId", "toContactId", "purpose",
    "amount", "currency", "receivingOrderId", "proofUrl", "note",
    "reversed", "reversedReason", "createdAt", "date", "legacyId",
    // Set when this transfer was entered via "Spend in" a different currency than the sender's
    // real balance (see app/vendor-balance/page.tsx) -- lets a vendor's Ledger page convert
    // this specific entry if displayCurrency is on. Appended at the end, same reason as above.
    "rate", "rateCurrency",
  ],
  // Explicitly links an agent's INR funding (a CompanyToAgent movement) to the RMB (or
  // other-currency) payout it paid for (an AgentToVendor/AgentToCompany movement). Never
  // auto-created — the agent position stays two separate currency lines until someone
  // confirms "this funding is what paid for that payout." See lib/ledger.ts agentPosition.
  FX_Conversions: [
    "id", "agentId", "fundingMovementId", "spendMovementId",
    "fromCurrency", "fromAmount", "toCurrency", "toAmount",
    "note", "reversed", "reversedReason", "createdAt", "legacyId",
  ],
  // Credit note / return issued by a vendor for an unsatisfactory or returned order.
  // Credits the amount back to the vendor's held balance for future use, and reduces order net cost.
  Credit_Notes: [
    "id", "orderId", "vendorId", "date", "amount", "currency",
    "reason", "reversed", "reversedReason", "createdAt",
  ],
  // Remembers every free-typed "Other" value for Reference/Method so it becomes a normal
  // dropdown option from then on, for everyone -- never typed twice. See lib/options.ts.
  Custom_Options: ["id", "field", "value", "createdAt"],
  // Historical obligations and source history. Pending/open rows are not cash movements.
  Legacy_Records: [
    "id", "kind", "vendorId", "toContactId", "orderId", "date", "currency", "amount",
    "status", "description", "proofUrl", "sourceTab", "sourceId", "sourceData",
  ],
} as const;

export type SheetName = keyof typeof SHEETS;

// "Other" is for directory-only contacts that don't fit a money-flow role yet —
// e.g. Kevin, who owes the company money (a receivable); V1 has no receivables flow,
// so he's just a reference entry until that's built.
export const ROLES = ["Vendor", "Supplier", "Agent", "Company", "Other"] as const;
export type Role = (typeof ROLES)[number];

export const MOVEMENT_TYPES = [
  "CompanyToAgent", "AgentToCompany", "AgentToVendor", "CompanyToVendor",
] as const;
// Import-only: not offered by the normal Record Money form or accepted on POST.
export type MovementType = (typeof MOVEMENT_TYPES)[number] | "LegacyCompanyToVendor" | "OpeningBalance";

export const PAYMENT_USES = ["OrderOnly", "OnAccountOnly", "OrderPlusOnAccount"] as const;
export type PaymentUse = (typeof PAYMENT_USES)[number];

export const TRANSFER_PURPOSES = ["Transfer", "PaySupplier", "Refund", "Expense"] as const;
export type TransferPurpose = (typeof TRANSFER_PURPOSES)[number];

export interface Contact {
  id: string; name: string; roles: Role[]; contact: string; notes: string;
  active: boolean; legacyId: string; createdAt: string; region?: string;
  displayCurrency?: string;
}

export interface Order {
  id: string; vendorId: string; invoiceRef: string; date: string; currency: string;
  shippingFee: number; adjustment: number; notes: string; proofUrl: string; createdAt: string;
  legacyTotal?: number | null; totalKnown?: boolean; status?: string; legacyId?: string; reviewNote?: string;
}

export interface OrderItem {
  id: string; orderId: string; description: string; sku: string;
  qty: number; unit: string; unitPrice: number; lineTotal: number; createdAt: string;
}

export interface MoneyMovement {
  id: string; date: string; type: MovementType; payerId: string; payeeId: string;
  amount: number; currency: string;
  actualRate: number | null; quotedRate: number | null; agentFee: number | null;
  rateCurrency: string;
  paymentUse: PaymentUse | "";
  method: string; reference: string; proofUrl: string; note: string;
  reversed: boolean; reversedReason: string; idempotencyKey: string;
  createdAt: string; createdBy: string;
  legacyId?: string;
}

export interface Application {
  id: string; movementId: string; orderId: string; amount: number;
  active: boolean; reversedReason: string; createdAt: string;
  date?: string; legacyId?: string;
  // Set only on an "advance" application -- movementId is empty because no real receipt
  // backs it (the vendor's held balance didn't cover the order). Normal applications derive
  // vendor/currency from their movementId via balanceSource() and leave these blank.
  vendorId?: string; currency?: string;
}

export interface Transfer {
  id: string; sourceMovementId: string; fromVendorId: string; toContactId: string;
  purpose: TransferPurpose; amount: number; currency: string;
  receivingOrderId: string; proofUrl: string; note: string;
  reversed: boolean; reversedReason: string; createdAt: string;
  date?: string; legacyId?: string;
  rate?: number | null; rateCurrency?: string;
}

export interface FxConversion {
  id: string; agentId: string; fundingMovementId: string; spendMovementId: string;
  fromCurrency: string; fromAmount: number; toCurrency: string; toAmount: number; legacyId?: string;
  note: string; reversed: boolean; reversedReason: string; createdAt: string;
}

export interface CreditNote {
  id: string; orderId: string; vendorId: string; date: string; amount: number; currency: string;
  reason: string; reversed: boolean; reversedReason: string; createdAt: string;
}

export const OPTION_FIELDS = ["reference", "method"] as const;
export type OptionField = (typeof OPTION_FIELDS)[number];

export interface CustomOption {
  id: string; field: OptionField; value: string; createdAt: string;
}

export interface LegacyRecord {
  id: string; kind: string; vendorId: string; toContactId: string; orderId: string;
  date: string; currency: string; amount: number; status: string; description: string;
  proofUrl: string; sourceTab: string; sourceId: string; sourceData: string;
}

// Starting choices for the Reference and Method dropdowns. Whatever someone types under
// "Other" gets remembered (see lib/options.ts) and joins this list for everyone, forever.
export const REFERENCE_DEFAULTS = ["Vinitt Desai", "WhatsApp Group"];
export const METHOD_DEFAULTS = ["Cash", "Bank", "Ali Pay"];
