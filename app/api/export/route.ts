import ExcelJS from "exceljs";
import { getAllData } from "@/lib/data";
import { agentPosition, contactName, orderSummary, vendorHeld } from "@/lib/ledger";
import { withErrors } from "@/lib/api";

export const GET = withErrors(async () => {
  const d = await getAllData();
  const { contacts, orders, orderItems, movements, applications, transfers } = d;
  const name = (id: string) => contactName(id, contacts);

  const wb = new ExcelJS.Workbook();
  wb.creator = "AHL Vendor Ledger";
  wb.created = new Date();

  // --- Orders ---
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
  ordersSheet.getRow(1).font = { bold: true };

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
  const orderById = new Map(orders.map((o) => [o.id, o]));
  for (const item of orderItems) {
    const order = orderById.get(item.orderId);
    if (!order) continue;
    itemsSheet.addRow({
      invoiceRef: order.invoiceRef || order.id, vendor: name(order.vendorId),
      description: item.description, qty: item.qty, unitPrice: item.unitPrice, lineTotal: item.lineTotal,
    });
  }
  itemsSheet.getRow(1).font = { bold: true };

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
  for (const m of movements) {
    txSheet.addRow({
      date: m.date, type: typeLabel[m.type] ?? m.type, from: m.payerId ? name(m.payerId) : "",
      to: name(m.payeeId), amount: m.amount, currency: m.currency, note: m.note, reversed: m.reversed ? "Yes" : "",
    });
  }
  const transferTypeLabel: Record<string, string> = {
    Transfer: "Transfer to Vendor", PaySupplier: "Pay Supplier", Refund: "Refund", Expense: "Expense",
  };
  for (const t of transfers) {
    txSheet.addRow({
      date: t.date ?? t.createdAt.slice(0, 10), type: transferTypeLabel[t.purpose] ?? t.purpose,
      from: name(t.fromVendorId), to: name(t.toContactId), amount: t.amount, currency: t.currency,
      note: t.note, reversed: t.reversed ? "Yes" : "",
    });
  }
  for (const a of applications) {
    const order = orderById.get(a.orderId);
    txSheet.addRow({
      date: a.date ?? a.createdAt.slice(0, 10), type: "Applied to Order",
      from: "", to: order ? `${name(order.vendorId)} — ${order.invoiceRef || order.id}` : a.orderId,
      amount: a.amount, currency: order?.currency ?? "", note: a.reversedReason,
      reversed: a.active ? "" : "Yes",
    });
  }
  txSheet.getRow(1).font = { bold: true };

  // --- Vendor Balances ---
  const vendorSheet = wb.addWorksheet("Vendor Balances");
  vendorSheet.columns = [
    { header: "Vendor", key: "vendor", width: 28 },
    { header: "Currency", key: "currency", width: 10 },
    { header: "Held", key: "held", width: 14 },
  ];
  const currencies = Array.from(new Set([...orders.map((o) => o.currency), ...movements.map((m) => m.currency)]));
  for (const v of contacts.filter((c) => c.roles.includes("Vendor"))) {
    for (const cur of currencies) {
      const held = vendorHeld(v.id, cur, d);
      if (Math.abs(held) > 0.001) vendorSheet.addRow({ vendor: v.name, currency: cur, held });
    }
  }
  vendorSheet.getRow(1).font = { bold: true };

  // --- Agent Positions ---
  const agentSheet = wb.addWorksheet("Agent Positions");
  agentSheet.columns = [
    { header: "Agent", key: "agent", width: 28 },
    { header: "Currency", key: "currency", width: 10 },
    { header: "Position", key: "position", width: 14 },
  ];
  for (const a of contacts.filter((c) => c.roles.includes("Agent"))) {
    const pos = agentPosition(a.id, d);
    for (const [cur, amt] of Object.entries(pos)) {
      if (Math.abs(amt) > 0.001) agentSheet.addRow({ agent: a.name, currency: cur, position: amt });
    }
  }
  agentSheet.getRow(1).font = { bold: true };

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="AHL-Vendor-Ledger-Export-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
});
