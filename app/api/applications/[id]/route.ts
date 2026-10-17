// Voids an "apply held balance to order" row (for editing, or a straight mistake).
// Applications use `active` rather than `reversed` as their live/void flag.
import { NextResponse } from "next/server";
import { updateRow } from "@/lib/sheets";
import { withErrors } from "@/lib/api";

export const PATCH = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await req.json();
  const reason = String(body.reason ?? "Edited");
  await updateRow("Applications", id, { active: false, reversedReason: reason });
  return NextResponse.json({ id });
});
