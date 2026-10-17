"use client";
import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { OrderItem } from "@/lib/schema";
import { Loading } from "@/app/components/Loading";

type AppliedPayment = {
  id: string;
  movementId: string;
  amount: number;
  date: string;
  currency: string;
  method: string;
  reference: string;
  payerName: string;
};

type OrderDetail = {
  id: string;
  vendorName: string;
  invoiceRef: string;
  date: string;
  currency: string;
  shippingFee: number;
  adjustment: number;
  notes: string;
  items: OrderItem[];
  appliedPayments?: AppliedPayment[];
  total: number;
  paid: number;
  due: number;
};

export default function OrderDetailPage() {
  return (
    <Suspense fallback={<Loading label="Loading order" />}>
      <OrderDetailContent />
    </Suspense>
  );
}

function OrderDetailContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadOrder = () => {
    fetch(`/api/orders/${id}`)
      .then(async (r) => {
        if (!r.ok) return setError((await r.json()).error ?? "Not found");
        setOrder(await r.json());
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    loadOrder();
  }, [id]);

  const handleUnlinkPayment = async (payment: AppliedPayment) => {
    if (
      !window.confirm(
        `Are you sure you want to unlink payment of ${payment.currency} ${payment.amount.toFixed(2)}?\n\nThis will remove the payment from this order and return the funds to the vendor's held balance.`
      )
    ) {
      return;
    }

    setUnlinkingId(payment.id);
    setActionError("");
    try {
      const res = await fetch(`/api/applications/${payment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Unlinked from order" }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to unlink payment");
      }
      loadOrder();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to unlink payment";
      setActionError(msg);
    } finally {
      setUnlinkingId(null);
    }
  };

  const handleDeleteOrder = async () => {
    if (!order) return;
    const label = order.invoiceRef ? `Invoice "${order.invoiceRef}"` : `Order "${order.id}"`;
    if (!window.confirm(`Are you sure you want to delete ${label}?\nThis action cannot be undone.`)) {
      return;
    }

    setDeleting(true);
    setActionError("");
    try {
      const res = await fetch(`/api/orders/${order.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to delete order");
      }
      router.push("/orders");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete order";
      setActionError(msg);
      setDeleting(false);
    }
  };

  if (error) return <p className="error-text">{error}</p>;
  if (!order) return <Loading label="Loading order" />;

  const payments = order.appliedPayments ?? [];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{order.vendorName}</h1>
          <p className="muted">{order.invoiceRef || "No invoice ref"} · {order.date}</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href={`/orders/${order.id}/edit`} className="btn">
            Edit Order
          </Link>
          {order.paid <= 0 && (
            <button
              type="button"
              className="btn secondary"
              style={{ color: "var(--danger)", borderColor: "var(--danger)" }}
              disabled={deleting}
              onClick={handleDeleteOrder}
            >
              {deleting ? "Deleting..." : "Delete Order"}
            </button>
          )}
          <Link href="/orders" className="btn secondary">
            Back to Orders
          </Link>
        </div>
      </div>

      {actionError && (
        <div className="card" style={{ background: "var(--err-bg)", borderColor: "var(--err-border)", marginBottom: 16 }}>
          <p className="error-text" style={{ margin: 0 }}>{actionError}</p>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginBottom: 12 }}>Items</h2>
        <table>
          <thead>
            <tr><th>Description</th><th>SKU</th><th>Qty</th><th>Unit</th><th>Unit price</th><th>Line total</th></tr>
          </thead>
          <tbody>
            {order.items.map((i) => (
              <tr key={i.id}>
                <td>{i.description}</td><td>{i.sku || "—"}</td><td>{i.qty}</td><td>{i.unit || "—"}</td>
                <td>{i.unitPrice.toFixed(2)}</td><td>{i.lineTotal.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 16 }}>
        <div className="card"><div className="field-label">Total</div><strong>{order.currency} {order.total.toFixed(2)}</strong></div>
        <div className="card"><div className="field-label">Paid</div><strong>{order.currency} {order.paid.toFixed(2)}</strong></div>
        <div className="card"><div className="field-label">Due</div><span className={`badge ${order.due <= 0 ? "ok" : "hold"}`}>{order.currency} {order.due.toFixed(2)}</span></div>
        <div className="card"><div className="field-label">Shipping / Adj.</div><strong>{order.shippingFee.toFixed(2)} / {order.adjustment.toFixed(2)}</strong></div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Applied Payments</h2>
          {payments.length === 0 && <span className="muted">No payments applied</span>}
        </div>

        {payments.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Payer</th>
                <th>Method</th>
                <th>Reference</th>
                <th>Amount Applied</th>
                <th style={{ textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{p.date}</td>
                  <td>{p.payerName}</td>
                  <td>{p.method || "—"}</td>
                  <td>{p.reference || "—"}</td>
                  <td><strong>{p.currency} {p.amount.toFixed(2)}</strong></td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      className="btn secondary"
                      style={{ fontSize: 12, padding: "4px 8px" }}
                      disabled={unlinkingId === p.id}
                      onClick={() => handleUnlinkPayment(p)}
                    >
                      {unlinkingId === p.id ? "Unlinking..." : "Unlink / Reverse"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            This order has no active payments. It can be safely deleted or edited.
          </p>
        )}
      </div>

      {order.notes && (
        <div className="card">
          <div className="field-label">Notes</div>
          <p style={{ margin: 0 }}>{order.notes}</p>
        </div>
      )}
    </div>
  );
}
