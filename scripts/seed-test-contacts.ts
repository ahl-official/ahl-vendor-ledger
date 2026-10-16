// Adds dedicated TEST-prefixed contacts so manual testing never has to use a real vendor
// or agent name (the old app's own Vendors tab had the same convention — see
// THEME_AND_CONTACT_SEED.txt "E2E-TEST-..." entries). Safe to run again; it just appends
// more rows, so don't run it repeatedly without clearing first.
// Run with: npm run seed:test-contacts
import { appendRow, newId } from "../lib/sheets.ts";

const ROWS = [
  { name: "TEST Vendor", roles: "Vendor", notes: "QA/testing only — not a real vendor. Safe to use for any test payment or order." },
  { name: "TEST Agent", roles: "Agent", notes: "QA/testing only — not a real agent. Safe to use for any test money movement." },
  { name: "TEST Supplier", roles: "Supplier", notes: "QA/testing only — not a real supplier. Safe to use for Pay Supplier tests." },
];

async function main() {
  const createdAt = new Date().toISOString();
  for (const r of ROWS) {
    await appendRow("Contacts", {
      id: newId("TEST"), name: r.name, roles: r.roles, contact: "", notes: r.notes,
      active: true, legacyId: "", createdAt,
    });
    console.log("Added", r.name, `(${r.roles})`);
  }
  console.log(`\nDone — ${ROWS.length} test contacts added. Vinitt Company (role Company) already exists for the payer side.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
