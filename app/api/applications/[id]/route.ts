import { NextResponse } from "next/server";
import { deleteRowsByField, updateRow } from "@/lib/sheets";
import { withErrors } from "@/lib/api";

export const PATCH = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await req.json();
  const reason = String(body.reason ?? "Edited");
  await updateRow("Applications", id, { active: false, reversedReason: reason });
  return NextResponse.json({ id });
});

export const DELETE = withErrors(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await deleteRowsByField("Applications", "id", id);
  return NextResponse.json({ success: true, id });
});
