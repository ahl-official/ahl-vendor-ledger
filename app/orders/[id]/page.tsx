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

type CreditNoteItem = {
  id: string;
  date: string;
  amount: number;
  currency: string;
  reason: string;
  createdAt: string;
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
  proofUrl?: string;
  items: OrderItem[];
  appliedPayments?: AppliedPayment[];
  creditNotes?: CreditNoteItem[];
  creditNotesTotal?: number;
  netCost?: number;
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

  // Credit note state
  const [showCreditNoteForm, setShowCreditNoteForm] = useState(false);
  const [cnAmount, setCnAmount] = useState("");
  const [cnDate, setCnDate] = useState("");
  const [cnReason, setCnReason] = useState("");
  const [cnSaving, setCnSaving] = useState(false);
  const [cnDeletingId, setCnDeletingId] = useState<string | null>(null);

  const loadOrder = () => {
    fetch(`/api/orders/${id}`)
      .then(async (r) => {
        if (!r.ok) return setError((await r.json()).error ?? "Not found");
        setOrder(await r.json());
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    setCnDate(new Date().toISOString().slice(0, 10));
  }, []);

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

  const handleCreateCreditNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order) return;
    const amountNum = Number(cnAmount);
    if (!amountNum || amountNum <= 0) {
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
          orderId: order.id,
          amount: amountNum,
          date: cnDate,
          reason: cnReason.trim() || "Order return / credit",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create credit note");
      setCnAmount("");
      setCnReason("");
      setShowCreditNoteForm(false);
      loadOrder();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to create credit note");
    } finally {
      setCnSaving(false);
    }
  };

  const handleDeleteCreditNote = async (cn: CreditNoteItem) => {
    if (
      !window.confirm(
        `Are you sure you want to delete this credit note of ${cn.currency} ${cn.amount.toFixed(2)}?\n\nThis will remove the credit from ${order?.vendorName || "the vendor"}'s held balance and restore the order's net cost.`
      )
    ) {
      return;
    }

    setCnDeletingId(cn.id);
    setActionError("");
    try {
      const res = await fetch(`/api/credit-notes/${cn.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete credit note");
      loadOrder();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to delete credit note");
    } finally {
      setCnDeletingId(null);
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
  const creditNotes = order.creditNotes ?? [];
  const cnTotal = order.creditNotesTotal ?? 0;
  const canDeleteOrder = order.paid <= 0 && cnTotal <= 0;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{order.vendorName}</h1>
          <p className="muted">{order.invoiceRef || "No invoice ref"} · {order.date}</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            className="btn"
            style={{ background: "#059669", borderColor: "#059669", color: "#fff" }}
            onClick={() => {
              setShowCreditNoteForm(!showCreditNoteForm);
              setActionError("");
            }}
          >
            {showCreditNoteForm ? "Cancel Credit Note" : "+ Issue Credit Note"}
          </button>
          <Link href={`/orders/${order.id}/edit`} className="btn secondary">
            Edit Order
          </Link>
          {canDeleteOrder && (
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

      {showCreditNoteForm && (
        <form onSubmit={handleCreateCreditNote} className="card" style={{ marginBottom: 16, borderLeft: "4px solid #059669" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Issue Credit Note / Order Return</h2>
            <span className="badge ok">Credits back to {order.vendorName}&apos;s Held Balance</span>
          </div>
          <p className="muted" style={{ marginTop: 0, marginBottom: 16, fontSize: 13 }}>
            Use this when an order or item was unsatisfactory or returned. The vendor agrees to credit this amount back to your held balance for future purchases without any bank transfer, reducing the net cost of this order.
          </p>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 2fr auto", gap: 12, alignItems: "end" }}>
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
              <label className="field-label">Credit Amount ({order.currency})</label>
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
              <label className="field-label">Reason / Unsatisfactory Items</label>
              <input
                type="text"
                placeholder="e.g. 2 pcs defective / vendor credited RMB 800"
                value={cnReason}
                onChange={(e) => setCnReason(e.target.value)}
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="btn" disabled={cnSaving}>
                {cnSaving ? "Saving..." : "Credit Held Balance"}
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() => setShowCreditNoteForm(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
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

      <div className="grid" style={{ gridTemplateColumns: cnTotal > 0 ? "repeat(5, 1fr)" : "repeat(4, 1fr)", marginBottom: 16 }}>
        <div className="card">
          <div className="field-label">Total</div>
          <strong>{order.currency} {order.total.toFixed(2)}</strong>
        </div>
        {cnTotal > 0 && (
          <div className="card" style={{ borderColor: "#059669" }}>
            <div className="field-label">Credit Notes</div>
            <strong style={{ color: "#059669" }}>+{order.currency} {cnTotal.toFixed(2)}</strong>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Credited to held balance</div>
          </div>
        )}
        <div className="card">
          <div className="field-label">{cnTotal > 0 ? "Net Cost" : "Paid"}</div>
          <strong>
            {order.currency} {(cnTotal > 0 ? (order.netCost ?? order.total) : order.paid).toFixed(2)}
          </strong>
        </div>
        {cnTotal > 0 && (
          <div className="card">
            <div className="field-label">Paid</div>
            <strong>{order.currency} {order.paid.toFixed(2)}</strong>
          </div>
        )}
        <div className="card">
          <div className="field-label">Due</div>
          <span className={`badge ${order.due <= 0 ? "ok" : "hold"}`}>{order.currency} {order.due.toFixed(2)}</span>
        </div>
      </div>

      {/* Credit Notes / Returns Section */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2 style={{ margin: 0 }}>Credit Notes / Order Returns</h2>
            {creditNotes.length > 0 && (
              <span className="badge ok" style={{ fontSize: 12 }}>
                +{order.currency} {cnTotal.toFixed(2)} credited back to {order.vendorName}&apos;s held balance
              </span>
            )}
          </div>
          <button
            type="button"
            className="btn secondary"
            style={{ fontSize: 12, padding: "4px 10px" }}
            onClick={() => setShowCreditNoteForm(true)}
          >
            + Issue Credit Note
          </button>
        </div>

        {creditNotes.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Reason / Description</th>
                <th>Credited to Vendor</th>
                <th style={{ textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {creditNotes.map((cn) => (
                <tr key={cn.id}>
                  <td>{cn.date}</td>
                  <td>{cn.reason || "Credit back to held balance"}</td>
                  <td><strong style={{ color: "#059669" }}>+{cn.currency} {cn.amount.toFixed(2)}</strong></td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      className="btn secondary"
                      style={{ fontSize: 12, padding: "4px 8px", color: "var(--danger)", borderColor: "var(--danger)" }}
                      disabled={cnDeletingId === cn.id}
                      onClick={() => handleDeleteCreditNote(cn)}
                    >
                      {cnDeletingId === cn.id ? "Deleting..." : "Delete / Reverse"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            No credit notes for this order. If an order was unsatisfactory or items were returned, click <strong>+ Issue Credit Note</strong> above to add the credited amount back into {order.vendorName}&apos;s held balance.
          </p>
        )}
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
            This order has no active payments.
          </p>
        )}
      </div>

      {order.proofUrl && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="field-label">Actual invoice</div>
          <a href={order.proofUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "underline" }}>View uploaded invoice</a>
        </div>
      )}

      {order.notes && (
        <div className="card">
          <div className="field-label">Notes</div>
          <p style={{ margin: 0 }}>{order.notes}</p>
        </div>
      )}
    </div>
  );
}
