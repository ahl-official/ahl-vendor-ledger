"use client";
import { useEffect, useMemo, useState } from "react";
import type { Contact } from "@/lib/schema";
import { fetchJson } from "@/lib/fetchJson";

type Receipt = { movementId: string; date: string; currency: string; remaining: number };
type VendorLedger = Contact & { held: Record<string, number>; openReceipts: Receipt[] };
type OrderRow = { id: string; vendorId: string; invoiceRef: string; currency: string; due: number };

const ACTIONS = [
  { value: "apply", label: "Apply to Order" },
  { value: "Transfer", label: "Transfer to Vendor" },
  { value: "PaySupplier", label: "Pay Supplier" },
  { value: "Refund", label: "Refund" },
] as const;

export default function VendorBalancePage() {
  const [vendors, setVendors] = useState<VendorLedger[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [movementId, setMovementId] = useState("");
  const [action, setAction] = useState<(typeof ACTIONS)[number]["value"]>("apply");
  const [amount, setAmount] = useState("");
  const [orderId, setOrderId] = useState("");
  const [toContactId, setToContactId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const load = () => {
    fetchJson<{ vendors: VendorLedger[] }>("/api/ledger").then((d) => setVendors(d.vendors)).catch((e) => setError(e.message));
    fetchJson<Contact[]>("/api/contacts").then(setContacts).catch((e) => setError(e.message));
    fetchJson<OrderRow[]>("/api/orders").then(setOrders).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const vendor = vendors.find((v) => v.id === vendorId);
  const receipt = vendor?.openReceipts.find((r) => r.movementId === movementId);
  const recipients = action === "Transfer" ? contacts.filter((c) => c.roles.includes("Vendor") && c.id !== vendorId)
    : action === "PaySupplier" ? contacts.filter((c) => c.roles.includes("Supplier"))
    : [];
  const targetOrders = useMemo(
    () => orders.filter((o) => o.vendorId === (action === "apply" ? vendorId : toContactId) && o.currency === receipt?.currency && o.due > 0.01),
    [orders, vendorId, toContactId, action, receipt]
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const amt = Number(amount);
    if (!receipt) return setError("Choose a held balance to spend");
    if (!amt || amt <= 0) return setError("Amount must be greater than 0");
    setSaving(true);
    const res = action === "apply"
      ? await fetch("/api/applications", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ movementId, orderId, amount: amt }),
        })
      : await fetch("/api/transfers", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceMovementId: movementId, fromVendorId: vendorId, purpose: action,
            toContactId: action === "Refund" ? "" : toContactId,
            amount: amt, currency: receipt.currency, receivingOrderId: orderId, note,
          }),
        });
    setSaving(false);
    if (!res.ok) return setError((await res.json()).error ?? "Failed to save");
    setDone(true);
    load();
  };

  if (done) {
    return (
      <div className="card" style={{ maxWidth: 480 }}>
        <p className="badge ok" style={{ marginBottom: 12 }}>Saved</p>
        <button onClick={() => { setDone(false); setAmount(""); setMovementId(""); }}>Do another</button>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ marginBottom: 24 }}>Use Vendor Balance</h1>
      <form onSubmit={submit} className="card grid" style={{ gap: 16, maxWidth: 640 }}>
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label>Vendor</label>
            <select value={vendorId} onChange={(e) => { setVendorId(e.target.value); setMovementId(""); }} required>
              <option value="">Select...</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <label>Held balance to spend</label>
            <select value={movementId} onChange={(e) => setMovementId(e.target.value)} required disabled={!vendor}>
              <option value="">Select...</option>
              {vendor?.openReceipts.map((r) => (
                <option key={r.movementId} value={r.movementId}>{r.date} — {r.currency} {r.remaining.toFixed(2)} held</option>
              ))}
            </select>
          </div>
        </div>

        {vendor && (
          <p className="muted" style={{ fontSize: 13 }}>
            Currently held by {vendor.name}: {Object.entries(vendor.held).filter(([, v]) => v !== 0).map(([c, v]) => `${c} ${v.toFixed(2)}`).join(" · ") || "nothing"}
          </p>
        )}

        <div>
          <label>Action</label>
          <select value={action} onChange={(e) => { setAction(e.target.value as any); setOrderId(""); setToContactId(""); }}>
            {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </div>

        {(action === "Transfer" || action === "PaySupplier") && (
          <div>
            <label>{action === "Transfer" ? "Transfer to vendor" : "Pay supplier"}</label>
            <select value={toContactId} onChange={(e) => setToContactId(e.target.value)} required>
              <option value="">Select...</option>
              {recipients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        {(action === "apply" || (action === "Transfer" && toContactId)) && (
          <div>
            <label>{action === "apply" ? "Order" : "Receiving vendor's order (optional)"}</label>
            <select value={orderId} onChange={(e) => setOrderId(e.target.value)} required={action === "apply"}>
              <option value="">{action === "apply" ? "Select..." : "No order — just add to held balance"}</option>
              {targetOrders.map((o) => <option key={o.id} value={o.id}>{o.invoiceRef || o.id} — due {o.due.toFixed(2)}</option>)}
            </select>
          </div>
        )}

        <div>
          <label>Amount {receipt && `(max ${receipt.currency} ${receipt.remaining.toFixed(2)})`}</label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>

        {receipt && amount && (
          <p className="muted" style={{ fontSize: 13 }}>
            Before → Change → After: {receipt.currency} {receipt.remaining.toFixed(2)} → -{Number(amount).toFixed(2)} → {(receipt.remaining - Number(amount)).toFixed(2)} left on this receipt
          </p>
        )}

        {action !== "apply" && <div><label>Note / proof</label><input value={note} onChange={(e) => setNote(e.target.value)} /></div>}

        {error && <p className="error-text">{error}</p>}
        <button type="submit" disabled={saving} style={{ justifySelf: "start" }}>{saving ? "Saving..." : "Save"}</button>
      </form>
    </div>
  );
}
