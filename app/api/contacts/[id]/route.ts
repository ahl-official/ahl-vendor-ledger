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
    ...(body.active !== undefined ? { active: !!body.active } : {}),
  });
  return NextResponse.json({ id });
});

// "Delete" never removes a contact or any row that references it -- every past transaction,
// order, and balance stays exactly as it is (see docs/ARCHITECTURE.md rule 1, and the Ledger's
// own void-not-delete pattern). It only marks the contact inactive so it stops appearing as a
// choice for NEW transactions; its full history remains visible and correct in the Ledger.
export const DELETE = withErrors(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await updateRow("Contacts", id, { active: false });
  return NextResponse.json({ id });
});
