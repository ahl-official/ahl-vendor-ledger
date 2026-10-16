// Prefills the approved contact list from THEME_AND_CONTACT_SEED.txt — regular vendors,
// the one external supplier, and the three agents only. Skips test contacts and the
// "needs confirmation" / "review separately" names on purpose (see that file, section 2).
// Run with: npm run seed:contacts
import { appendRow, newId } from "../lib/sheets.ts";

const VENDORS = [
  "Nancy (Lord Hair)", "Harry", "Mao Nini (Sally Pu / Saili)", "Starrose", "TR (T.R.)", "Linda",
  "Drew Silli (Dhruv / Sillee)", "Zyron", "Chau (Yan)", "Sritan", "Jifa", "Accessories2",
  "Rachel Runiyasi", "Sunny", "Jenny Tenlon", "Anne", "FSM", "Vlight", "Hi-MO", "Ya Xuan",
  "Huang (uniforms)", "Atop (scissors)", "Yanny (pedicure)", "Bao Cheng (trolley/dryers/mirrors/TV)",
  "Ling Ling (bedsheets)", "Emida",
];
const SUPPLIERS = ["Mr. Lucas Zhang"];
const AGENTS = ["HARNI", "RAKESH", "AMIT"];

async function main() {
  const createdAt = new Date().toISOString();
  const rows = [
    ...VENDORS.map((name) => ({ name, roles: "Vendor" })),
    ...SUPPLIERS.map((name) => ({ name, roles: "Supplier" })),
    ...AGENTS.map((name) => ({ name, roles: "Agent" })),
  ];
  for (const r of rows) {
    await appendRow("Contacts", {
      id: newId("ENT"), name: r.name, roles: r.roles, contact: "", notes: "",
      active: true, legacyId: "", createdAt,
    });
    console.log("Added", r.name, `(${r.roles})`);
  }
  console.log(`\nDone — ${rows.length} contacts added.`);
  console.log("Not seeded (needs manual review first): Faye, MS DU, MS Huang, 润驰耐丝, Kevin, Vinitt Company.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
