// Voids a movement (for editing, or a straight mistake) -- never deletes or overwrites it.
// The row stays in the sheet with reversed=true so it's still visible as history.
import { NextResponse } from "next/server";
import { updateRow } from "@/lib/sheets";
import { withErrors } from "@/lib/api";

export const PATCH = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await req.json();
  const reason = String(body.reason ?? "Edited");
  await updateRow("Money_Movements", id, { reversed: true, reversedReason: reason });
  return NextResponse.json({ id });
});
