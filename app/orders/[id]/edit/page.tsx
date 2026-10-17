"use client";
import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { Contact, OrderItem } from "@/lib/schema";
import { fetchJson } from "@/lib/fetchJson";
import { Loading } from "@/app/components/Loading";

interface Line {
  id?: string;
  description: string;
  sku: string;
  qty: string;
  unit: string;
  unitPrice: string;
}

const blankLine = (): Line => ({ description: "", sku: "", qty: "1", unit: "", unitPrice: "" });

type OrderDetail = {
  id: string;
  vendorId: string;
  vendorName: string;
  invoiceRef: string;
  date: string;
  currency: string;
  shippingFee: number;
  adjustment: number;
  notes: string;
  items: OrderItem[];
  total: number;
  paid: number;
  due: number;
};

export default function EditOrderPage() {
  return (
    <Suspense fallback={<Loading label="Loading order" />}>
      <EditOrderContent />
    </Suspense>
  );
}

function EditOrderContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [vendors, setVendors] = useState<Contact[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [date, setDate] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [shippingFee, setShippingFee] = useState("0");
  const [adjustment, setAdjustment] = useState("0");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [paidAmount, setPaidAmount] = useState(0);

  useEffect(() => {
    Promise.all([
      fetchJson<OrderDetail>(`/api/orders/${id}`),
      fetchJson<Contact[]>("/api/contacts"),
    ])
      .then(([ord, c]) => {
        setVendors(c.filter((x) => x.roles.includes("Vendor")));
        setVendorId(ord.vendorId);
        setInvoiceRef(ord.invoiceRef || "");
        setDate(ord.date || "");
        setCurrency(ord.currency || "USD");
        setShippingFee(String(ord.shippingFee ?? 0));
        setAdjustment(String(ord.adjustment ?? 0));
        setNotes(ord.notes || "");
        setPaidAmount(ord.paid || 0);
        if (ord.items && ord.items.length > 0) {
          setLines(
            ord.items.map((i) => ({
              id: i.id,
              description: i.description || "",
              sku: i.sku || "",
              qty: String(i.qty),
              unit: i.unit || "",
              unitPrice: String(i.unitPrice),
            }))
          );
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const lineTotal = (l: Line) => (Number(l.qty) || 0) * (Number(l.unitPrice) || 0);
  const itemsTotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const orderTotal = itemsTotal + (Number(shippingFee) || 0) + (Number(adjustment) || 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const items = lines.filter((l) => l.description.trim());
    if (!vendorId) return setError("Choose a vendor");
    if (!items.length) return setError("Add at least one product line");

    setSaving(true);
    const res = await fetch(`/api/orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendorId,
        invoiceRef,
        date,
        currency,
        shippingFee: Number(shippingFee) || 0,
        adjustment: Number(adjustment) || 0,
        notes,
        items: items.map((l) => ({ ...l, qty: Number(l.qty) || 0, unitPrice: Number(l.unitPrice) || 0 })),
      }),
    });
    setSaving(false);
    if (!res.ok) return setError((await res.json()).error ?? "Failed to save changes");
    router.push(`/orders/${id}`);
  };

  if (loading) return <Loading label="Loading order" />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1>Edit Order: {invoiceRef || id}</h1>
        <Link href="/orders" className="btn secondary">Back to Orders</Link>
      </div>

      <form onSubmit={submit} style={{ display: "grid", gap: 16 }}>
        <div className="card grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <div>
            <label>Vendor</label>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} required>
              <option value="">Select...</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Invoice / PO ref</label>
            <input value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} />
          </div>
          <div>
            <label>Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label>Currency</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              disabled={paidAmount > 0}
              title={paidAmount > 0 ? "Currency locked: payments already applied" : ""}
            >
              <option>USD</option>
              <option>RMB</option>
              <option>INR</option>
            </select>
            {paidAmount > 0 && (
              <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                Locked: {currency} {paidAmount.toFixed(2)} paid
              </p>
            )}
          </div>
        </div>

        <div className="card">
          <h2 style={{ marginBottom: 12 }}>Product lines</h2>
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th>SKU</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Unit price</th>
                <th>Line total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <input
                      value={l.description}
                      onChange={(e) => setLine(i, { description: e.target.value })}
                      placeholder="Tape Hair, body wave 10A 20in..."
                      required
                    />
                  </td>
                  <td>
                    <input value={l.sku} onChange={(e) => setLine(i, { sku: e.target.value })} />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="any"
                      value={l.qty}
                      onChange={(e) => setLine(i, { qty: e.target.value })}
                      style={{ width: 70 }}
                      required
                    />
                  </td>
                  <td>
                    <input
                      value={l.unit}
                      onChange={(e) => setLine(i, { unit: e.target.value })}
                      placeholder="pcs / 100g"
                      style={{ width: 90 }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="any"
                      value={l.unitPrice}
                      onChange={(e) => setLine(i, { unitPrice: e.target.value })}
                      style={{ width: 90 }}
                      required
                    />
                  </td>
                  <td>{lineTotal(l).toFixed(2)}</td>
                  <td>
                    {lines.length > 1 && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}
                        title="Remove line"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="secondary"
            style={{ marginTop: 8 }}
            onClick={() => setLines((p) => [...p, blankLine()])}
          >
            + Add line
          </button>
        </div>

        <div className="card grid" style={{ gridTemplateColumns: "1fr 1fr", maxWidth: 500, marginLeft: "auto" }}>
          <div>
            <label>Shipping fee</label>
            <input
              type="number"
              step="any"
              value={shippingFee}
              onChange={(e) => setShippingFee(e.target.value)}
            />
          </div>
          <div>
            <label>Adjustment (+/-)</label>
            <input
              type="number"
              step="any"
              value={adjustment}
              onChange={(e) => setAdjustment(e.target.value)}
            />
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Anything not a line item or shipping — a discount, a bank/rounding fee, a credit. Negative lowers the total, positive raises it.
            </p>
          </div>
          <div style={{ gridColumn: "1 / -1", textAlign: "right", fontSize: 16, paddingTop: 8 }}>
            <strong>Order total: {currency} {orderTotal.toFixed(2)}</strong>
          </div>
        </div>

        <div className="card">
          <label>Notes / proof</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>

        {error && <p className="error-text">{error}</p>}
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button type="submit" disabled={saving}>
            {saving ? "Saving changes..." : "Save changes"}
          </button>
          <Link href={`/orders/${id}`} className="btn secondary">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
