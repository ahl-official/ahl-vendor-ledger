import { NextResponse } from "next/server";
import { getAllData } from "@/lib/data";
import { updateRow } from "@/lib/sheets";
import { withErrors } from "@/lib/api";

// Voids a movement -- never deletes or overwrites it. The row stays in the sheet with
// reversed=true so it's still visible as history. This is the ONLY correction path for
// Money_Movements; there is deliberately no DELETE here. See docs/ARCHITECTURE.md rule 1
// -- a prior change added a hard-delete endpoint here (and cascaded it into Applications
// and Transfers too), which destroyed the audit trail for rows that had already affected
// real balances. That was a bug, not a feature; don't re-add it.
export const PATCH = withErrors(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await req.json();
  const reason = String(body.reason ?? "Edited");
  await updateRow("Money_Movements", id, { reversed: true, reversedReason: reason });

  // Cascade-void (never delete) any still-active Applications built directly on this
  // movement -- otherwise an edit flow that voids this movement and creates a fresh one
  // with a fresh Application would double-count: the old Application stays active AND
  // the new one is active, both counting toward the same order's paid total. Sequential,
  // not Promise.all -- parallel appends/updates to the same tab have raced before (see
  // docs/DECISIONS.md, 2026-10-17 incident).
  const { applications } = await getAllData();
  const linked = applications.filter((a) => a.movementId === id && a.active);
  for (const a of linked) {
    await updateRow("Applications", a.id, { active: false, reversedReason: `Source movement ${id} was voided: ${reason}` });
  }

  return NextResponse.json({ id });
});
