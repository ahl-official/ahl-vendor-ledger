// Voids an agent FX conversion link (for editing, or a straight mistake).
import { NextResponse } from "next/server";
import { getAllData } from "@/lib/data";
import { updateRow } from "@/lib/sheets";
import { withErrors } from "@/lib/api";

export const GET = withErrors(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const d = await getAllData();
  const c = d.fxConversions.find((x) => x.id === id);
  if (!c) return NextResponse.json({ error: "Conversion not found" }, { status: 404 });
  return NextResponse.json(c);
});

export const PATCH = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await req.json();
  const reason = String(body.reason ?? "Edited");
  await updateRow("FX_Conversions", id, { reversed: true, reversedReason: reason });
  return NextResponse.json({ id });
});
