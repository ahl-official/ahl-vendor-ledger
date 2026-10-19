import { voidGuard } from "@/lib/void-guard";
import { getAllData } from "@/lib/data";
import { NextResponse } from "next/server";
import { updateRow } from "@/lib/sheets";
import { withErrors } from "@/lib/api";

// Voids a transfer/pay-supplier/refund row -- never deletes it. This is the ONLY
// correction path; see docs/ARCHITECTURE.md rule 1 for why DELETE was removed from here.
export const PATCH = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await req.json();
  const reason = String(body.reason ?? "Edited");
  const guardData = await getAllData();
  const guard = voidGuard(id, guardData);
  if (guard) return NextResponse.json({ error: guard }, { status: 409 });
  await updateRow("Transfers", id, { reversed: true, reversedReason: reason });
  return NextResponse.json({ id });
});
