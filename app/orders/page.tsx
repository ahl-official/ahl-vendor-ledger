"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Contact, Order } from "@/lib/schema";
import { fetchJson } from "@/lib/fetchJson";
import { Loading } from "@/app/components/Loading";

type OrderRow = Order & { total: number; paid: number; due: number };

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    Promise.all([fetchJson<OrderRow[]>("/api/orders"), fetchJson<Contact[]>("/api/contacts")])
      .then(([o, c]) => {
        setOrders(o);
        setContacts(c);
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const vendorName = (id: string) => contacts.find((c) => c.id === id)?.name ?? id;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1>Orders</h1>
        <Link href="/orders/new" className="btn">+ New Order</Link>
      </div>
      {loading ? (
        <Loading label="Loading orders" />
      ) : loadError ? (
        <p className="error-text">{loadError}</p>
      ) : (
        <table>
          <thead>
            <tr><th>Date</th><th>Vendor</th><th>Invoice</th><th>Total</th><th>Paid</th><th>Due</th><th></th></tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>{o.date}</td>
                <td>{vendorName(o.vendorId)}</td>
                <td>{o.invoiceRef || "—"}</td>
                <td>{o.currency} {o.total.toFixed(2)}</td>
                <td>{o.currency} {o.paid.toFixed(2)}</td>
                <td>
                  <span className={`badge ${o.due <= 0 ? "ok" : "hold"}`}>{o.currency} {o.due.toFixed(2)}</span>
                </td>
                <td><Link href={`/orders/${o.id}`} className="muted">Open →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
