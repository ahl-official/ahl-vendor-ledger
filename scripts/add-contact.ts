// Adds one contact. Reusable for one-off additions outside the bulk seed scripts.
// Run with: npm run add:contact -- "Name" Vendor[,Agent,...]
import { appendRow, newId } from "../lib/sheets.ts";

async function main() {
  const name = process.argv[2];
  const roles = (process.argv[3] ?? "Vendor").split(",");
  if (!name) throw new Error('Usage: npm run add:contact -- "Name" Role1[,Role2]');

  await appendRow("Contacts", {
    id: newId("ENT"), name, roles: roles.join(","), contact: "", notes: "",
    active: true, legacyId: "", createdAt: new Date().toISOString(),
  });
  console.log("Added", name, `(${roles.join(", ")})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
