// Voids a transfer/pay-supplier/refund row (for editing, or a straight mistake).
import { NextResponse } from "next/server";
import { updateRow } from "@/lib/sheets";
import { withErrors } from "@/lib/api";

export const PATCH = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await req.json();
  const reason = String(body.reason ?? "Edited");
  await updateRow("Transfers", id, { reversed: true, reversedReason: reason });
  return NextResponse.json({ id });
});
