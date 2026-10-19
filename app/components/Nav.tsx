"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/contacts", label: "Contacts" },
  { href: "/orders", label: "Orders" },
  { href: "/payments/new", label: "Record Money" },
  { href: "/vendor-balance", label: "Use Balance" },
  { href: "/ledger", label: "Ledger" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav style={{ display: "flex", gap: "16px" }}>
      {NAV.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} className={active ? "nav-link active" : "nav-link"}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
