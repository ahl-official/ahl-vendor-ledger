// Adds the "review separately" names from THEME_AND_CONTACT_SEED.txt now that the owner
// said to add them. Faye and the two possible-duplicate vendors get Vendor role (they
// receive/forward vendor-side payments); Kevin gets "Other" since he owes the company
// (a receivable) — a direction this V1 doesn't track yet.
// Run with: npm run seed:review-contacts
import { appendRow, newId } from "../lib/sheets.ts";

const ROWS = [
  { name: "Faye", roles: "Vendor", notes: "Taking over Nancy's account for small payments; not yet confirmed as a full standing vendor. Contact: 8615763948517" },
  { name: "MS DU", roles: "Vendor", notes: "Needs confirmation — appears in Sally ledger at RMB 3,400; may duplicate Harry. Do not post a second payment until confirmed." },
  { name: "MS Huang", roles: "Vendor", notes: "Needs confirmation — may be Huang (uniforms) or Chau (Yan). Identity must be confirmed before merging." },
  { name: "润驰耐丝", roles: "Vendor", notes: "Needs confirmation — appears in Sally ledger with RMB 8,000 paid on 2026-09-02; goods/order details unknown." },
  { name: "Kevin", roles: "Other", notes: "Receivable — Kevin owes Vinitt Company, opposite direction from vendor payments. Exact balance and the shoes order are still unknown. V1 has no receivables tracking yet." },
];

async function main() {
  const createdAt = new Date().toISOString();
  for (const r of ROWS) {
    await appendRow("Contacts", {
      id: newId("ENT"), name: r.name, roles: r.roles, contact: "", notes: r.notes,
      active: true, legacyId: "", createdAt,
    });
    console.log("Added", r.name, `(${r.roles})`);
  }
  console.log(`\nDone — ${ROWS.length} contacts added.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
