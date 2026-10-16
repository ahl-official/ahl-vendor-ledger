import { NextResponse } from "next/server";
import { getContacts } from "@/lib/data";
import { appendRow, newId } from "@/lib/sheets";
import { withErrors } from "@/lib/api";
import type { Role } from "@/lib/schema";

export const GET = withErrors(async () => {
  const contacts = await getContacts();
  return NextResponse.json(contacts);
});

export const POST = withErrors(async (req: Request) => {
  const body = await req.json();
  const name = String(body.name ?? "").trim();
  const roles = (body.roles ?? []) as Role[];
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (!roles.length) return NextResponse.json({ error: "Pick at least one role" }, { status: 400 });

  const id = newId("ENT");
  await appendRow("Contacts", {
    id,
    name,
    roles: roles.join(","),
    contact: body.contact ?? "",
    notes: body.notes ?? "",
    active: true,
    legacyId: body.legacyId ?? "",
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ id });
});
