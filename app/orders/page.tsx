"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Contact, Order } from "@/lib/schema";
import { fetchJson } from "@/lib/fetchJson";
import { Loading } from "@/app/components/Loading";

type OrderRow = Order & {
  total: number;
  paid: number;
  due: number;
  creditNotes?: number;
  netCost?: number;
};

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Quick Credit Note state
  const [showCnModal, setShowCnModal] = useState(false);
  const [cnOrderId, setCnOrderId] = useState("");
  const [cnDate, setCnDate] = useState("");
  const [cnAmount, setCnAmount] = useState("");
  const [cnReason, setCnReason] = useState("");
  const [cnSaving, setCnSaving] = useState(false);

  const reloadOrders = () => {
    fetchJson<OrderRow[]>("/api/orders")
      .then(setOrders)
      .catch((e) => setLoadError(e.message));
  };

  useEffect(() => {
    setCnDate(new Date().toISOString().slice(0, 10));
  }, []);

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

  const handleSaveCreditNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cnOrderId) {
      setActionError("Please select an order for this credit note");
      return;
    }
    const amt = Number(cnAmount);
    if (!amt || amt <= 0) {
      setActionError("Please enter a valid credit amount");
      return;
    }
    setCnSaving(true);
    setActionError("");
    try {
      const res = await fetch("/api/credit-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: cnOrderId,
          amount: amt,
          date: cnDate,
          reason: cnReason.trim() || "Order return / credit",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save credit note");
      setShowCnModal(false);
      setCnOrderId("");
      setCnAmount("");
      setCnReason("");
      reloadOrders();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to save credit note");
    } finally {
      setCnSaving(false);
    }
  };

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
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="btn"
            style={{ background: "#059669", borderColor: "#059669", color: "#fff" }}
            onClick={() => {
              setShowCnModal(true);
              setActionError("");
            }}
          >
            + Issue Credit Note
          </button>
          <Link href="/orders/new" className="btn">+ New Order</Link>
        </div>
      </div>

      {actionError && (
        <div className="card" style={{ background: "var(--err-bg)", borderColor: "var(--err-border)", marginBottom: 16 }}>
          <p className="error-text" style={{ margin: 0 }}>{actionError}</p>
        </div>
      )}

      {showCnModal && (
        <form onSubmit={handleSaveCreditNote} className="card" style={{ marginBottom: 20, borderLeft: "4px solid #059669" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Issue Credit Note / Order Return</h2>
            <span className="badge ok">Credits back to Vendor Held Balance</span>
          </div>
          <p className="muted" style={{ marginTop: 0, marginBottom: 16, fontSize: 13 }}>
            Use this when an order was unsatisfactory or returned. The vendor credits this amount directly back to your held balance for future purchases, reducing the net cost of the selected order.
          </p>
          <div className="grid" style={{ gridTemplateColumns: "2fr 1fr 1fr 2fr auto", gap: 12, alignItems: "end" }}>
            <div>
              <label className="field-label">Select Order</label>
              <select
                required
                value={cnOrderId}
                onChange={(e) => setCnOrderId(e.target.value)}
              >
                <option value="">-- Choose Order --</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {vendorName(o.vendorId)} · Inv: {o.invoiceRef || o.id} ({o.date}) — {o.totalKnown === false ? "Total unknown" : `${o.currency} ${o.total.toFixed(2)}`}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Date</label>
              <input
                type="date"
                required
                value={cnDate}
                onChange={(e) => setCnDate(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label">
                Credit Amount {cnOrderId ? `(${orders.find((o) => o.id === cnOrderId)?.currency ?? "RMB"})` : ""}
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="e.g. 800.00"
                value={cnAmount}
                onChange={(e) => setCnAmount(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label">Reason / Return Details</label>
              <input
                type="text"
                placeholder="e.g. 2 pcs defective / vendor agreed RMB 800 credit"
                value={cnReason}
                onChange={(e) => setCnReason(e.target.value)}
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="btn" disabled={cnSaving}>
                {cnSaving ? "Saving..." : "Credit Vendor"}
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  setShowCnModal(false);
                  setCnOrderId("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
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
                <td>
                  <div>{o.totalKnown === false ? "Total unknown" : `${o.currency} ${o.total.toFixed(2)}`}</div>
                  {o.creditNotes && o.creditNotes > 0 ? (
                    <div style={{ fontSize: 11, color: "#059669", fontWeight: 500 }}>
                      Net: {o.currency} {(o.netCost ?? (o.total - o.creditNotes)).toFixed(2)}
                    </div>
                  ) : null}
                </td>
                <td>{o.currency} {o.paid.toFixed(2)}</td>
                <td>
                  <span className={`badge ${o.totalKnown === false || o.due > 0 ? "hold" : "ok"}`}>{o.totalKnown === false ? "Needs confirmation" : `${o.currency} ${o.due.toFixed(2)}`}</span>
                </td>
                <td style={{ textAlign: "right" }}>
                  <div
                    style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="icon-btn"
                      title="Issue credit note / order return"
                      aria-label={`Issue credit note for order ${o.invoiceRef || o.id}`}
                      style={{ color: "#059669" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setCnOrderId(o.id);
                        setShowCnModal(true);
                        setActionError("");
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 14 4 9 9 4" />
                        <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
                      </svg>
                    </button>
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
                      title={
                        o.paid > 0
                          ? "Cannot delete order with applied payments"
                          : (o.creditNotes ?? 0) > 0
                          ? "Cannot delete order with active credit notes"
                          : "Delete order"
                      }
                      aria-label={`Delete order ${o.invoiceRef || o.id}`}
                      disabled={deletingId === o.id || o.paid > 0 || (o.creditNotes ?? 0) > 0}
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
