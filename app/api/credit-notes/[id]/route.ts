import { NextResponse } from "next/server";
import { updateRow } from "@/lib/sheets";
import { withErrors } from "@/lib/api";

// Reverses a credit note -- never deletes it. This is the ONLY correction path; see
// docs/ARCHITECTURE.md rule 1 for why DELETE was removed from here. orderSummary() and
// vendorHeld() both filter on !reversed, so this correctly drops the credit from the
// order's net cost and the vendor's held balance the moment it's set, and is idempotent
// (setting reversed=true twice is harmless).
export const PATCH = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await req.json();
  const reason = String(body.reason ?? "Reversed");
  await updateRow("Credit_Notes", id, { reversed: true, reversedReason: reason });
  return NextResponse.json({ success: true, id });
});
