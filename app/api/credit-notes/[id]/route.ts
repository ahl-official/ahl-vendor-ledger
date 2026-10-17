import { NextResponse } from "next/server";
import { deleteRowsByField, updateRow } from "@/lib/sheets";
import { withErrors } from "@/lib/api";

export const DELETE = withErrors(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await deleteRowsByField("Credit_Notes", "id", id);
  return NextResponse.json({ success: true, id });
});

export const PATCH = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await req.json();
  const reason = String(body.reason ?? "Reversed");
  await updateRow("Credit_Notes", id, { reversed: true, reversedReason: reason });
  return NextResponse.json({ success: true, id });
});
