import { NextResponse } from "next/server";
import { updateRow } from "@/lib/sheets";
import { withErrors } from "@/lib/api";
import type { Role } from "@/lib/schema";

export const PATCH = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await req.json();
  const name = String(body.name ?? "").trim();
  const roles = (body.roles ?? []) as Role[];
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (!roles.length) return NextResponse.json({ error: "Pick at least one role" }, { status: 400 });

  await updateRow("Contacts", id, {
    name,
    roles: roles.join(","),
    contact: body.contact ?? "",
    notes: body.notes ?? "",
    ...(body.displayCurrency !== undefined ? { displayCurrency: body.displayCurrency } : {}),
  });
  return NextResponse.json({ id });
});
