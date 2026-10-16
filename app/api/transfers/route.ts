// Spends part of a vendor's held balance on something other than its own order:
// Transfer (to another vendor), PaySupplier (external, no held balance created), or Refund.
import { NextResponse } from "next/server";
import { getAllData } from "@/lib/data";
import { movementRemaining } from "@/lib/ledger";
import type { TransferPurpose } from "@/lib/schema";
import { appendRow, newId } from "@/lib/sheets";
import { withErrors } from "@/lib/api";

export const POST = withErrors(async (req: Request) => {
  const body = await req.json();
  const purpose = body.purpose as TransferPurpose;
  const sourceMovementId = String(body.sourceMovementId ?? "");
  const fromVendorId = String(body.fromVendorId ?? "");
  const amount = Number(body.amount);
  if (!purpose) return NextResponse.json({ error: "Purpose is required" }, { status: 400 });
  if (!sourceMovementId || !fromVendorId) {
    return NextResponse.json({ error: "Source balance is required" }, { status: 400 });
  }
  if (!amount || amount <= 0) return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });
  if (purpose !== "Refund" && !body.toContactId) {
    return NextResponse.json({ error: "Recipient is required" }, { status: 400 });
  }

  const d = await getAllData();
  const remaining = movementRemaining(sourceMovementId, d);
  if (amount - remaining > 0.01) {
    return NextResponse.json({ error: `Only ${remaining} is still held from this receipt` }, { status: 400 });
  }

  const sourceMovement = d.movements.find((m) => m.id === sourceMovementId);
  const id = newId("TRF");
  await appendRow("Transfers", {
    id,
    sourceMovementId,
    fromVendorId,
    // A refund's recipient (e.g. the company that gets the money back) is informational
    // only — never the vendor itself, or vendorHeld() would read it as a transfer back in.
    toContactId: purpose === "Refund" ? (body.toContactId ?? "") : body.toContactId,
    purpose,
    amount,
    currency: body.currency ?? sourceMovement?.currency ?? "USD",
    receivingOrderId: body.receivingOrderId ?? "",
    proofUrl: body.proofUrl ?? "",
    note: body.note ?? "",
    reversed: false,
    reversedReason: "",
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ id });
});
