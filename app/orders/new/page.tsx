"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Contact } from "@/lib/schema";
import { fetchJson } from "@/lib/fetchJson";

interface Line { description: string; sku: string; qty: string; unit: string; unitPrice: string }
const blankLine = (): Line => ({ description: "", sku: "", qty: "1", unit: "", unitPrice: "" });

export default function NewOrderPage() {
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
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDate(new Date().toISOString().slice(0, 10));
    fetchJson<Contact[]>("/api/contacts")
      .then((c) => setVendors(c.filter((x) => x.roles.includes("Vendor"))))
      .catch((e) => setError(e.message));
  }, []);

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
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendorId, invoiceRef, date, currency,
        shippingFee: Number(shippingFee) || 0,
        adjustment: Number(adjustment) || 0,
        notes,
        items: items.map((l) => ({ ...l, qty: Number(l.qty) || 0, unitPrice: Number(l.unitPrice) || 0 })),
      }),
    });
    setSaving(false);
    if (!res.ok) return setError((await res.json()).error ?? "Failed to save");
    const { id } = await res.json();
    router.push(`/orders/${id}`);
  };

  return (
    <div>
      <h1 style={{ marginBottom: 24 }}>New Order</h1>
      <form onSubmit={submit} style={{ display: "grid", gap: 16 }}>
        <div className="card grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <div>
            <label>Vendor</label>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} required>
              <option value="">Select...</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
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
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option>USD</option><option>RMB</option><option>INR</option>
            </select>
          </div>
        </div>

        <div className="card">
          <h2 style={{ marginBottom: 12 }}>Product lines</h2>
          <table>
            <thead>
              <tr><th>Description</th><th>SKU</th><th>Qty</th><th>Unit</th><th>Unit price</th><th>Line total</th><th></th></tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td><input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="Tape Hair, body wave 10A 20in..." /></td>
                  <td><input value={l.sku} onChange={(e) => setLine(i, { sku: e.target.value })} /></td>
                  <td><input type="number" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} style={{ width: 70 }} /></td>
                  <td><input value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} placeholder="pcs / 100g" style={{ width: 90 }} /></td>
                  <td><input type="number" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} style={{ width: 90 }} /></td>
                  <td>{lineTotal(l).toFixed(2)}</td>
                  <td>
                    <button type="button" className="secondary" onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="secondary" style={{ marginTop: 8 }} onClick={() => setLines((p) => [...p, blankLine()])}>+ Add line</button>
        </div>

        <div className="card grid" style={{ gridTemplateColumns: "1fr 1fr", maxWidth: 500, marginLeft: "auto" }}>
          <div><label>Shipping fee</label><input type="number" value={shippingFee} onChange={(e) => setShippingFee(e.target.value)} /></div>
          <div><label>Adjustment (+/-)</label><input type="number" value={adjustment} onChange={(e) => setAdjustment(e.target.value)} /></div>
          <div style={{ gridColumn: "1 / -1", textAlign: "right", fontSize: 16, paddingTop: 8 }}>
            <strong>Order total: {currency} {orderTotal.toFixed(2)}</strong>
          </div>
        </div>

        <div className="card"><label>Notes / proof</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>

        {error && <p className="error-text">{error}</p>}
        <button type="submit" disabled={saving} style={{ justifySelf: "start" }}>{saving ? "Saving..." : "Save order"}</button>
      </form>
    </div>
  );
}
