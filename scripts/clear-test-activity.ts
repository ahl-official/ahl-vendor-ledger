// Wipes every transactional row (orders, items, movements, applications, transfers, fx
// conversions, credit notes) from the live Sheet — everything currently in those tabs is
// test data from development. Contacts (and Custom_Options) are left alone.
// Run with: npm run clear:test-activity
import { clearRows } from "../lib/sheets.ts";

const TABS = ["Orders", "Order_Items", "Money_Movements", "Applications", "Transfers", "FX_Conversions", "Credit_Notes"] as const;

async function main() {
  for (const tab of TABS) {
    await clearRows(tab);
    console.log("Cleared", tab);
  }
  console.log("\nDone — all transactional tabs are empty. Contacts were left untouched.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
