import { NextResponse } from "next/server";
import { updateRow } from "@/lib/sheets";
import { withErrors } from "@/lib/api";

// Voids an "apply held balance to order" row -- never deletes it. Applications use
// `active` rather than `reversed` as their live/void flag. This is the ONLY correction
// path; see docs/ARCHITECTURE.md rule 1 for why DELETE was removed from here.
export const PATCH = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await req.json();
  const reason = String(body.reason ?? "Edited");
  await updateRow("Applications", id, { active: false, reversedReason: reason });
  return NextResponse.json({ id });
});
