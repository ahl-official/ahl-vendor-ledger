import type { LedgerData } from "./ledger";

export function voidGuard(id: string, d: LedgerData): string | null {
  if (d.transfers.some(t => !t.reversed && t.sourceMovementId === id)) return "This balance has paid another entry. Reverse the dependent spending first.";
  if (d.fxConversions.some(c => !c.reversed && (c.fundingMovementId === id || c.spendMovementId === id))) return "Reverse the related FX link before voiding this movement.";
  // Movement corrections cascade their applications. Transfers/credit notes cannot disappear
  // while their incoming funds have been applied to a later order.
  if (!d.movements.some(m => m.id === id) && d.applications.some(a => a.active && a.movementId === id)) return "This balance has paid an order. Unlink the application first.";
  return null;
}
