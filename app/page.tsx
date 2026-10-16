import Link from "next/link";

const ACTIONS = [
  { href: "/orders/new", title: "New Order", desc: "Vendor, product lines, totals" },
  { href: "/payments/new", title: "Record Money Movement", desc: "Company↔Agent↔Vendor payments" },
  { href: "/vendor-balance", title: "Use Vendor Balance", desc: "Apply, transfer, pay supplier, refund" },
  { href: "/ledger", title: "View Ledger", desc: "Vendor, order and agent balances" },
];

export default function Home() {
  return (
    <div>
      <h1 style={{ marginBottom: 24 }}>AHL Vendor Ledger</h1>
      <div className="grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        {ACTIONS.map((a) => (
          <Link key={a.href} href={a.href} className="card" style={{ display: "block" }}>
            <h2 style={{ color: "var(--accent)", marginBottom: 6 }}>{a.title}</h2>
            <p className="muted">{a.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
