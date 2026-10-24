import { contactName, fundingAutoConversion, type LedgerData } from "./ledger.ts";

/** Display the agent's passbook, converting quoted/actual rates or confirmed FX conversions into RMB. */
export function agentStatement(agentId: string, d: LedgerData) {
  const rows = d.movements.filter(m => !m.reversed && (
    (m.type === "CompanyToAgent" && m.payeeId === agentId) ||
    ((m.type === "AgentToVendor" || m.type === "AgentToCompany") && m.payerId === agentId)
  )).map(m => {
    const amount = m.type === "CompanyToAgent" ? m.amount : -m.amount;
    return {
      movement: m, amount,
      label: m.type === "CompanyToAgent" ? "Received from Company" : m.type === "AgentToCompany" ? "Returned to Company" : `Paid vendor ${contactName(m.payeeId, d.contacts)}`,
      changes: { [m.currency]: amount } as Record<string, number>,
      conversions: [] as string[],
      balances: {} as Record<string, number>,
    };
  });
  const convertedFundings = new Set<string>();
  for (const c of d.fxConversions) {
    if (c.reversed || c.agentId !== agentId) continue;
    if (!d.movements.some(m => m.id === c.fundingMovementId) || !d.movements.some(m => m.id === c.spendMovementId)) continue;
    const funding = rows.find(r => r.movement.id === c.fundingMovementId);
    if (!funding) continue;
    convertedFundings.add(c.fundingMovementId);
    // Attribute only the confirmed conversion to its funding, including partial links.
    funding.changes[c.fromCurrency] = (funding.changes[c.fromCurrency] ?? 0) - c.fromAmount;
    funding.changes[c.toCurrency] = (funding.changes[c.toCurrency] ?? 0) + c.toAmount;
    funding.conversions.push(`Confirmed conversion: ${c.fromCurrency} ${c.fromAmount.toFixed(2)} → ${c.toCurrency} ${c.toAmount.toFixed(2)}.`);
  }

  // Auto-convert funding movements that have a rate and are not explicitly linked via FX
  // conversion -- into whatever currency that rate was recorded for (rateCurrency; defaults
  // to RMB, matching the original INR-funding-to-RMB behavior when nothing else is picked).
  for (const row of rows) {
    const m = row.movement;
    if (convertedFundings.has(m.id)) continue;
    const conv = fundingAutoConversion(m);
    if (conv) {
      row.changes[m.currency] = (row.changes[m.currency] ?? 0) - m.amount;
      row.changes[conv.target] = (row.changes[conv.target] ?? 0) + conv.amount;
      row.conversions.push(`Converted @ ${conv.rate.toFixed(2)}: ${m.currency} ${m.amount.toFixed(2)} → ${conv.target} ${conv.amount.toFixed(2)}.`);
    }
  }

  rows.sort((a, b) => a.movement.date.localeCompare(b.movement.date) || a.movement.createdAt.localeCompare(b.movement.createdAt) || a.movement.id.localeCompare(b.movement.id));
  const running: Record<string, number> = {};
  for (const row of rows) {
    for (const [currency, amount] of Object.entries(row.changes)) running[currency] = (running[currency] ?? 0) + amount;
    row.balances = { ...running };
  }
  return rows.reverse().map(row => ({
    id: row.movement.id, date: row.movement.date, createdAt: row.movement.createdAt,
    label: row.label, amount: row.amount, currency: row.movement.currency,
    note: [row.movement.note, ...row.conversions].filter(Boolean).join("\n\n"),
    rate: row.movement.quotedRate ?? row.movement.actualRate,
    inrAmount: row.movement.currency === "INR" ? row.amount : null,
    rmbAmount: row.changes.RMB ?? null,
    balanceRmb: row.balances.RMB ?? 0,
    balances: row.balances,
    conversionIncluded: row.conversions.length > 0,
  }));
}
