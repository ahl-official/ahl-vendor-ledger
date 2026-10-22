import ExcelJS from "exceljs";
import { getAllData } from "@/lib/data";
import { agentPosition, contactName, isReceipt, orderSummary, receiptEffective, vendorHeld } from "@/lib/ledger";
import { withErrors } from "@/lib/api";

// Matches the app's own palette (see app/globals.css :root) so the export looks like
// part of the same product instead of a generic spreadsheet.
const INK = "FF1C1C1A";
const PAPER = "FFF6F5F1";
const ACCENT = "FF8A5A1F";
const SOFT = "FFEEECE3";
const ERR_BG = "FFFDE8E8";
const WHITE = "FFFFFFFF";

const headerFill = (sheet: ExcelJS.Worksheet) => {
  const row = sheet.getRow(1);
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: PAPER } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    cell.alignment = { vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: INK } } };
  });
  row.height = 20;
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(sheet.rowCount, 1), column: sheet.columnCount } };
};

const zebraAndBorders = (sheet: ExcelJS.Worksheet, reversedCol?: number) => {
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const isReversed = reversedCol ? String(row.getCell(reversedCol).value ?? "") === "Yes" : false;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = { bottom: { style: "hair", color: { argb: "FFDAD7CC" } } };
      cell.fill = {
        type: "pattern", pattern: "solid",
        fgColor: { argb: isReversed ? ERR_BG : rowNumber % 2 === 0 ? SOFT : WHITE },
      };
    });
  });
};

const moneyFormat = (sheet: ExcelJS.Worksheet, cols: number[]) => {
  for (const c of cols) sheet.getColumn(c).numFmt = "#,##0.00";
};

export const GET = withErrors(async (req: Request) => {
  const contactId = new URL(req.url).searchParams.get("contactId") ?? "";
  const d = await getAllData();
  const { contacts, orders: allOrders, orderItems, movements: allMovements, applications: allApplications, transfers: allTransfers } = d;
  const name = (id: string) => contactName(id, contacts);
  const filterContact = contactId ? contacts.find((c) => c.id === contactId) : undefined;
  const isVendor = !contactId || filterContact?.roles.includes("Vendor");
  const isAgent = !contactId || filterContact?.roles.includes("Agent");

  const orders = contactId ? allOrders.filter((o) => o.vendorId === contactId) : allOrders;
  const orderById = new Map(allOrders.map((o) => [o.id, o]));
  const orderIds = new Set(orders.map((o) => o.id));
  const movements = contactId ? allMovements.filter((m) => m.payerId === contactId || m.payeeId === contactId) : allMovements;
  const transfers = contactId ? allTransfers.filter((t) => t.fromVendorId === contactId || t.toContactId === contactId) : allTransfers;
  const applications = contactId ? allApplications.filter((a) => orderIds.has(a.orderId)) : allApplications;

  const wb = new ExcelJS.Workbook();
  wb.creator = "AHL Vendor Ledger";
  wb.created = new Date();

  // --- Cover sheet ---
  const cover = wb.addWorksheet("Report");
  cover.getColumn(1).width = 26;
  cover.getColumn(2).width = 40;
  cover.mergeCells("A1:B1");
  const title = cover.getCell("A1");
  title.value = "AHL Vendor Ledger — Export Report";
  title.font = { bold: true, size: 16, color: { argb: PAPER } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
  title.alignment = { vertical: "middle" };
  cover.getRow(1).height = 28;
  cover.addRow([]);
  cover.addRow(["Scope", filterContact ? `${filterContact.name} only` : "All vendors, agents, and companies"]);
  cover.addRow(["Generated", new Date().toISOString().slice(0, 10)]);
  for (let r = 3; r <= 4; r++) cover.getCell(`A${r}`).font = { bold: true, color: { argb: INK } };

  // --- Orders ---
  if (isVendor) {
    const ordersSheet = wb.addWorksheet("Orders");
    ordersSheet.columns = [
      { header: "Date", key: "date", width: 12 },
      { header: "Vendor", key: "vendor", width: 28 },
      { header: "Invoice Ref", key: "invoiceRef", width: 24 },
      { header: "Currency", key: "currency", width: 10 },
      { header: "Total", key: "total", width: 14 },
      { header: "Paid", key: "paid", width: 14 },
      { header: "Due", key: "due", width: 14 },
      { header: "Status", key: "status", width: 14 },
    ];
    for (const o of orders) {
      const s = orderSummary(o, d);
      ordersSheet.addRow({
        date: o.date, vendor: name(o.vendorId), invoiceRef: o.invoiceRef,
        currency: o.currency, total: s.total, paid: s.paid, due: s.due, status: o.status,
      });
    }
    headerFill(ordersSheet);
    moneyFormat(ordersSheet, [5, 6, 7]);
    zebraAndBorders(ordersSheet);

    // --- Order Items ---
    const itemsSheet = wb.addWorksheet("Order Items");
    itemsSheet.columns = [
      { header: "Invoice Ref", key: "invoiceRef", width: 24 },
      { header: "Vendor", key: "vendor", width: 28 },
      { header: "Product", key: "description", width: 32 },
      { header: "Qty", key: "qty", width: 8 },
      { header: "Unit Price", key: "unitPrice", width: 12 },
      { header: "Line Total", key: "lineTotal", width: 14 },
    ];
    for (const item of orderItems) {
      const order = orderById.get(item.orderId);
      if (!order || !orderIds.has(order.id)) continue;
      itemsSheet.addRow({
        invoiceRef: order.invoiceRef || order.id, vendor: name(order.vendorId),
        description: item.description, qty: item.qty, unitPrice: item.unitPrice, lineTotal: item.lineTotal,
      });
    }
    headerFill(itemsSheet);
    moneyFormat(itemsSheet, [5, 6]);
    zebraAndBorders(itemsSheet);
  }

  // --- Transactions (every money movement, in plain English) ---
  const txSheet = wb.addWorksheet("Transactions");
  txSheet.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Type", key: "type", width: 28 },
    { header: "From", key: "from", width: 24 },
    { header: "To", key: "to", width: 24 },
    { header: "Amount", key: "amount", width: 14 },
    { header: "Currency", key: "currency", width: 10 },
    { header: "Note", key: "note", width: 40 },
    { header: "Reversed", key: "reversed", width: 10 },
  ];
  const typeLabel: Record<string, string> = {
    CompanyToAgent: "Company funded Agent", AgentToCompany: "Agent returned to Company",
    AgentToVendor: "Agent paid Vendor", CompanyToVendor: "Company paid Vendor",
    LegacyCompanyToVendor: "Company paid Vendor (historical)", OpeningBalance: "Opening balance",
  };
  const transferTypeLabel: Record<string, string> = {
    Transfer: "Transfer to Vendor", PaySupplier: "Pay Supplier", Refund: "Refund", Expense: "Expense",
  };
  type TxRow = { date: string; type: string; from: string; to: string; amount: number; currency: string; note: string; reversed: string };
  const txRows: TxRow[] = [];
  for (const m of movements) {
    const eff = isReceipt(m) ? receiptEffective(m) : { currency: m.currency, amount: m.amount };
    txRows.push({
      date: m.date, type: typeLabel[m.type] ?? m.type, from: m.payerId ? name(m.payerId) : "",
      to: name(m.payeeId), amount: eff.amount, currency: eff.currency, note: m.note, reversed: m.reversed ? "Yes" : "",
    });
  }
  for (const t of transfers) {
    txRows.push({
      date: t.date ?? t.createdAt.slice(0, 10), type: transferTypeLabel[t.purpose] ?? t.purpose,
      from: name(t.fromVendorId), to: name(t.toContactId), amount: t.amount, currency: t.currency,
      note: t.note, reversed: t.reversed ? "Yes" : "",
    });
  }
  for (const a of applications) {
    const order = orderById.get(a.orderId);
    txRows.push({
      date: a.date ?? a.createdAt.slice(0, 10), type: "Applied to Order",
      from: "", to: order ? `${name(order.vendorId)} — ${order.invoiceRef || order.id}` : a.orderId,
      amount: a.amount, currency: order?.currency ?? "", note: a.reversedReason,
      reversed: a.active ? "" : "Yes",
    });
  }
  txRows.sort((r1, r2) => r1.date.localeCompare(r2.date));
  txSheet.addRows(txRows);
  headerFill(txSheet);
  moneyFormat(txSheet, [5]);
  zebraAndBorders(txSheet, 8);

  // --- Vendor Balances ---
  if (isVendor) {
    const vendorSheet = wb.addWorksheet("Vendor Balances");
    vendorSheet.columns = [
      { header: "Vendor", key: "vendor", width: 28 },
      { header: "Currency", key: "currency", width: 10 },
      { header: "Held", key: "held", width: 14 },
    ];
    const currencies = Array.from(new Set([...allOrders.map((o) => o.currency), ...allMovements.map((m) => m.currency)]));
    const vendorList = contactId ? contacts.filter((c) => c.id === contactId) : contacts.filter((c) => c.roles.includes("Vendor"));
    for (const v of vendorList) {
      for (const cur of currencies) {
        const held = vendorHeld(v.id, cur, d);
        if (Math.abs(held) > 0.001) vendorSheet.addRow({ vendor: v.name, currency: cur, held });
      }
    }
    headerFill(vendorSheet);
    moneyFormat(vendorSheet, [3]);
    zebraAndBorders(vendorSheet);
  }

  // --- Agent Positions ---
  if (isAgent) {
    const agentSheet = wb.addWorksheet("Agent Positions");
    agentSheet.columns = [
      { header: "Agent", key: "agent", width: 28 },
      { header: "Currency", key: "currency", width: 10 },
      { header: "Position", key: "position", width: 14 },
    ];
    const agentList = contactId ? contacts.filter((c) => c.id === contactId) : contacts.filter((c) => c.roles.includes("Agent"));
    for (const a of agentList) {
      const pos = agentPosition(a.id, d);
      for (const [cur, amt] of Object.entries(pos)) {
        if (Math.abs(amt) > 0.001) agentSheet.addRow({ agent: a.name, currency: cur, position: amt });
      }
    }
    headerFill(agentSheet);
    moneyFormat(agentSheet, [3]);
    zebraAndBorders(agentSheet);
  }

  const buffer = await wb.xlsx.writeBuffer();
  const fileScope = filterContact ? `-${filterContact.name.replace(/[^a-z0-9]+/gi, "-")}` : "";
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="AHL-Vendor-Ledger-Export${fileScope}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
});
