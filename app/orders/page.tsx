"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Contact, Order } from "@/lib/schema";
import { fetchJson } from "@/lib/fetchJson";
import { Loading } from "@/app/components/Loading";

type OrderRow = Order & { total: number; paid: number; due: number };

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  const handleDelete = async (order: OrderRow) => {
    const label = order.invoiceRef ? `Invoice "${order.invoiceRef}"` : `Order "${order.id}"`;
    if (!window.confirm(`Are you sure you want to delete ${label}?\nThis action cannot be undone.`)) {
      return;
    }

    setActionError("");
    setDeletingId(order.id);
    try {
      const res = await fetch(`/api/orders/${order.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to delete order");
      }
      setOrders((prev) => prev.filter((o) => o.id !== order.id));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete order";
      setActionError(msg);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1>Orders</h1>
        <Link href="/orders/new" className="btn">+ New Order</Link>
      </div>

      {actionError && (
        <div className="card" style={{ background: "var(--err-bg)", borderColor: "var(--err-border)", marginBottom: 16 }}>
          <p className="error-text" style={{ margin: 0 }}>{actionError}</p>
        </div>
      )}

      {loading ? (
        <Loading label="Loading orders" />
      ) : loadError ? (
        <p className="error-text">{loadError}</p>
      ) : orders.length === 0 ? (
        <div className="card">
          <p className="muted">No orders found. Click "+ New Order" to create one.</p>
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Vendor</th>
              <th>Invoice</th>
              <th>Total</th>
              <th>Paid</th>
              <th>Due</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr
                key={o.id}
                onClick={() => router.push(`/orders/${o.id}`)}
                style={{ cursor: "pointer" }}
                title="Click to open order details"
              >
                <td>{o.date}</td>
                <td>{vendorName(o.vendorId)}</td>
                <td>{o.invoiceRef || "—"}</td>
                <td>{o.currency} {o.total.toFixed(2)}</td>
                <td>{o.currency} {o.paid.toFixed(2)}</td>
                <td>
                  <span className={`badge ${o.due <= 0 ? "ok" : "hold"}`}>{o.currency} {o.due.toFixed(2)}</span>
                </td>
                <td style={{ textAlign: "right" }}>
                  <div
                    style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="icon-btn edit-btn"
                      title="Edit order"
                      aria-label={`Edit order ${o.invoiceRef || o.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/orders/${o.id}/edit`);
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="icon-btn delete-btn"
                      title="Delete order"
                      aria-label={`Delete order ${o.invoiceRef || o.id}`}
                      disabled={deletingId === o.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(o);
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <line x1="10" y1="11" x2="10" y2="17" />
                        <line x1="14" y1="11" x2="14" y2="17" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
