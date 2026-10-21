# AHL Vendor Ledger — Project State & Context Handoff

> **Last Updated:** October 21, 2026  
> **Repository:** `https://github.com/ahl-official/ahl-vendor-ledger.git` (branch: `main`)  
> **Local Workspace:** `c:\Users\HP\Desktop\Mexico\ahl-vendor-ledger`  
> **Dev Server:** `http://localhost:3000` / `http://localhost:3001` / `http://localhost:3002` (`npx next dev -p 3002`)

---

## 1. Executive Summary & Core Rules
This application is a specialized vendor-payment, order-tracking, and agent ledger system built for American Hairline (AHL) for China and Mexico vendors.

### Core Business Rules & Financial Model
1. **Vendor Held Balance**:
   $$\text{Vendor Held} = \text{Received In} + \text{Transfers In} + \mathbf{Credit Notes In} - \text{Applied Out} - \text{Transfers Out}$$
   - Any money sent to a vendor stays in that vendor's "Held Balance" until spent.
   - When an order is unsatisfactory or returned, the vendor issues a **Credit Note**. The credited amount returns directly to the vendor's held balance for future purchases. No cash leaves or enters company accounts.
2. **Order Financials**:
   - $\text{Order Total} = \sum (\text{Qty} \times \text{Unit Price}) + \text{Shipping} + \text{Adjustment}$
   - $\text{Credit Notes} = \sum \text{Active Credit Notes linked to the order}$
   - $\text{Net Cost} = \max(0, \text{Order Total} - \text{Credit Notes})$
   - $\text{Order Due} = \max(0, \text{Order Total} - \text{Credit Notes} - \text{Paid})$
3. **Vendor Balance Usage (`/vendor-balance`)**:
   - Displays **Total Balance Held by Vendor** (clean single aggregate, not separate confusing lines).
   - Supported Actions:
     1. **Apply to Order** (spend held balance on an existing order)
     2. **Transfer to Vendor** (move held balance to another vendor)
     3. **Pay Supplier** (pay a third-party supplier from held balance)
   - **Refund** has been **completely removed** from this screen.
4. **Vendor Ledger Passbook (`/ledger`)**:
   - Structured like a **Bank Passbook**:
     - Columns: `Date | Reference | Description | Credited (+) | Debited (-) | Total Balance | Actions`
     - Latest transactions appear on top (reverse chronological).
     - Running position shows only the current status: **Held** or **Owes** (reflecting latest transaction).
     - Action icons: Clean Edit (pencil) and Delete (trash) icons.
     - Edit safety: Navigating back from the edit screen without changes does **not** delete or alter the transaction.
5. **Agent Ledger & Statement (`/ledger`)**:
   - INR fundings sent to an agent with a quoted or actual rate automatically convert to RMB in the agent statement and agent position calculations without requiring manual FX conversion linking.
   - Dual INR/RMB columns track the exact running balances.
6. **Record Money Movement (`/payments/new`)**:
   - Displays real-time live preview of the converted RMB amount based on quoted/actual rate.
   - Converted RMB amount is directly editable on screen, auto-calculating and synchronizing with the agent's quoted rate bidirectionally.

---

## 2. Credit Note / Order Return Architecture

### Google Sheets Integration
- Sheet Tab: `Credit_Notes`
- Columns: `["id", "orderId", "vendorId", "date", "amount", "currency", "reason", "reversed", "reversedReason", "createdAt"]`
- Auto-healing in `lib/sheets.ts`: If the `Credit_Notes` tab is absent in the Google Spreadsheet, `ensureTab()` automatically creates it and writes the header row without failing requests.

### Access Points
1. **Orders List (`/orders`)**:
   - Top Header: Green **`+ Issue Credit Note`** button opens a quick modal with an Order selector dropdown, date, credit amount, and reason.
   - Row Action: Each order row has a green **Return / Undo** icon ($\curvearrowleft$) opening the credit note modal pre-filled for that specific order.
   - Total Column: If an order has credit notes, it shows the net cost below the total (e.g., `Net: RMB 200.00 (-800.00 credit)`).
2. **Order Details Page (`/orders/[id]`)**:
   - Top Header: Green **`+ Issue Credit Note`** button.
   - Summary Cards: Displays **Order Total**, **Credit Notes** (`+RMB 800.00` green card), **Net Cost** (`RMB 200.00`), **Paid** (`RMB 1,000.00`), and **Due** (`RMB 0.00`).
   - Dedicated Section: **Credit Notes / Order Returns** table with Date, Reason, Amount Credited, and a **Delete / Reverse** button.
   - Order Delete Protection: An order cannot be deleted if active credit notes exist until they are reversed first.
3. **Vendor Ledger (`/ledger`)**:
   - Appears in the Vendor passbook under the **Credited** column (`+¥800.00`), increasing the running total held balance with reference `Credit Note — Order {invoiceRef || id} ({reason})`.

---

## 3. Key Files & Responsibilities

| File Path | Description |
|---|---|
| `lib/schema.ts` | Type definitions and Google Sheets table schemas, including `Credit_Notes` and `CreditNote`. |
| `lib/sheets.ts` | Google Sheets API v4 connector, batch reading, `ensureTab` auto-creation, append/update/delete. |
| `lib/data.ts` | Data caching and parsers for contacts, orders, movements, applications, transfers, credit notes. |
| `lib/ledger.ts` | Accounting business logic: `vendorHeld`, `orderSummary`, `agentPosition`, `isReceipt`. |
| `app/api/credit-notes/route.ts` | `GET` (list credit notes) and `POST` (create new credit note linked to order & vendor). |
| `app/api/credit-notes/[id]/route.ts` | `DELETE` (delete/void credit note) and `PATCH` (reverse with reason). |
| `app/api/orders/route.ts` | Lists orders enriched with `orderSummary` (`total, paid, creditNotes, netCost, due`). |
| `app/api/orders/[id]/route.ts` | Single order details with `items`, `appliedPayments`, `creditNotes`, summary, and delete safety checks. |
| `app/orders/page.tsx` | Orders table with Net Cost subtext, `+ Issue Credit Note` header button & row icon, and modal form. |
| `app/orders/[id]/page.tsx` | Order details view, credit note issuing form, credit notes table with delete actions. |
| `app/vendor-balance/page.tsx` | Use Vendor Balance screen with aggregate held balance and Refund removed. |
| `app/ledger/page.tsx` | Bank passbook vendor ledger, agent INR/RMB dual columns, running held/owes status banner. |
| `app/components/Nav.tsx` | Main top navigation bar. |

---

## 4. Git History (Recent Key Commits)
- `d6879d9`: Add Issue Credit Note button and quick modal directly on Orders page
- `dab9b67`: Add Credit Note order return feature credited to vendor held balance and remove Refund from vendor balance
- `0bcca11`: Bank passbook style vendor ledger, dual INR/RMB agent columns, running held/owes status

---

## 5. Verification Status
- Production build: `npm run build` succeeds with 0 errors across all 22 static and dynamic routes.
- TypeScript: Type check passed cleanly with strict mode.
- Git Status: Working tree clean, synced with `origin/main`.
