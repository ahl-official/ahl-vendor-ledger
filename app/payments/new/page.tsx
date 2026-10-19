"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Application, Contact, MoneyMovement, MovementType, PaymentUse } from "@/lib/schema";
import { METHOD_DEFAULTS, REFERENCE_DEFAULTS } from "@/lib/schema";
import { fetchJson } from "@/lib/fetchJson";
import { ProofUpload } from "@/app/components/ProofUpload";

// Company can pay a vendor directly or fund an agent who pays the vendor.
// Agent funding and payout can be recorded in either order.
const TYPE_OPTIONS: { value: MovementType; label: string; payerRole: string; payeeRole: string }[] = [
  { value: "CompanyToAgent", label: "Company → Agent  (INR funding sent)", payerRole: "Company", payeeRole: "Agent" },
  { value: "AgentToCompany", label: "Agent → Company  (RMB returned)", payerRole: "Agent", payeeRole: "Company" },
  { value: "AgentToVendor", label: "Agent → Vendor  (agent pays vendor)", payerRole: "Agent", payeeRole: "Vendor" },
  { value: "CompanyToVendor", label: "Company → Vendor  (direct payment)", payerRole: "Company", payeeRole: "Vendor" },
];

type OrderRow = { id: string; vendorId: string; invoiceRef: string; currency: string; due: number };

export default function RecordMovementPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <RecordMovementContent />
    </Suspense>
  );
}

function RecordMovementContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [type, setType] = useState<MovementType>("CompanyToAgent");
  const [payerId, setPayerId] = useState("");
  const [payeeId, setPayeeId] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [proofUrl, setProofUrl] = useState("");
  const [date, setDate] = useState("");
  const [actualRate, setActualRate] = useState("");
  const [quotedRate, setQuotedRate] = useState("");
  const [agentFee, setAgentFee] = useState("");
  const [method, setMethod] = useState("");
  const [methodChoice, setMethodChoice] = useState("");
  const [reference, setReference] = useState("");
  const [referenceChoice, setReferenceChoice] = useState("");
  const [optionLists, setOptionLists] = useState<{ reference: string[]; method: string[] }>({
    reference: REFERENCE_DEFAULTS, method: METHOD_DEFAULTS,
  });
  const [note, setNote] = useState("");
  const [paymentUse, setPaymentUse] = useState<PaymentUse | "">("");
  const [orderId, setOrderId] = useState("");
  const [appliedAmount, setAppliedAmount] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [editLoaded, setEditLoaded] = useState(!editId);
  const [originalAppliedAmount, setOriginalAppliedAmount] = useState(0);

  useEffect(() => {
    setDate(new Date().toISOString().slice(0, 10));
    fetchJson<Contact[]>("/api/contacts").then(setContacts).catch((e) => setError(e.message));
    fetchJson<OrderRow[]>("/api/orders").then(setOrders).catch((e) => setError(e.message));
    fetchJson<{ reference: string[]; method: string[] }>("/api/options").then(setOptionLists).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!editId) return;
    fetchJson<{ movements: MoneyMovement[] }>("/api/movements")
      .then(async (d) => {
        const m = d.movements.find((x) => x.id === editId);
        if (!m) throw new Error("That entry could not be found — it may already be edited elsewhere.");
        setType(m.type); setPayerId(m.payerId); setPayeeId(m.payeeId);
        setAmount(String(m.amount)); setCurrency(m.currency); setDate(m.date);
        setActualRate(m.actualRate != null ? String(m.actualRate) : "");
        setQuotedRate(m.quotedRate != null ? String(m.quotedRate) : "");
        setAgentFee(m.agentFee != null ? String(m.agentFee) : "");
        setMethod(m.method); setMethodChoice(optionLists.method.includes(m.method) ? m.method : m.method ? "Other" : "");
        setReference(m.reference); setReferenceChoice(optionLists.reference.includes(m.reference) ? m.reference : m.reference ? "Other" : "");
        setNote(m.note);
        setProofUrl(m.proofUrl);
        setPaymentUse(m.paymentUse);

        if (m.paymentUse === "OrderOnly" || m.paymentUse === "OrderPlusOnAccount") {
          const ledger = await fetchJson<{ applications: Application[] }>("/api/ledger");
          const app = ledger.applications.find((a) => a.movementId === editId && a.active);
          if (app) {
            setOrderId(app.orderId);
            setAppliedAmount(String(app.amount));
            setOriginalAppliedAmount(app.amount);
          }
        }

        setEditLoaded(true);
      })
      .catch((e) => { setError(e.message); setEditLoaded(true); });
  }, [editId]);

  const availableTypes = editId && type === "LegacyCompanyToVendor" ? [...TYPE_OPTIONS, { value: "LegacyCompanyToVendor" as MovementType, label: "Historical Company ? Vendor", payerRole: "Company", payeeRole: "Vendor" }] : TYPE_OPTIONS;
  const cfg = availableTypes.find((t) => t.value === type)!;
  const isVendorReceipt = type === "AgentToVendor" || type === "CompanyToVendor" || type === "LegacyCompanyToVendor";
  const byRole = (role: string) => contacts.filter((c) => c.roles.includes(role as any));
  const vendorOrders = useMemo(
    () => orders.filter((o) => o.vendorId === payeeId && o.currency === currency && (o.due > 0.01 || o.id === orderId)),
    [orders, payeeId, currency, orderId]
  );
  const selectedOrder = vendorOrders.find((o) => o.id === orderId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      if (editId) {
        // Void the previous entry right before saving the corrected one -- never delete it.
        // It stays visible (struck-through) in the Ledger as history; see
        // docs/ARCHITECTURE.md rule 1.
        const voidRes = await fetch(`/api/movements/${editId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "Edited — replaced by a corrected entry" }),
        });
        if (!voidRes.ok) {
          const voidData = await voidRes.json().catch(() => ({}));
          throw new Error(voidData.error || "Failed to update previous entry");
        }
      }

      const res = await fetch("/api/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editId, type, payerId, payeeId, amount: Number(amount), currency, date,
          actualRate: actualRate || null, quotedRate: quotedRate || null, agentFee: agentFee || null,
          method, reference, note, proofUrl,
          paymentUse: isVendorReceipt ? paymentUse : "",
          orderId: paymentUse === "OnAccountOnly" ? "" : orderId,
          appliedAmount: paymentUse === "OnAccountOnly" ? 0 : paymentUse === "OrderOnly" ? Number(amount) : Number(appliedAmount || 0),
        }),
      });
      if (!res.ok) {
        const resData = await res.json().catch(() => ({}));
        throw new Error(resData.error ?? "Failed to save");
      }
      setSaving(false);
      setDone(true);
    } catch (err: unknown) {
      setSaving(false);
      setError(err instanceof Error ? err.message : "Failed to save");
    }
  };

  if (done) {
    return (
      <div className="card" style={{ maxWidth: 480 }}>
        <p className="badge ok" style={{ marginBottom: 12 }}>Saved</p>
        <p style={{ marginBottom: 16 }}>Money movement recorded.</p>
        <button onClick={() => router.push("/ledger")}>View ledger</button>{" "}
        <button className="secondary" onClick={() => setDone(false)}>Record another</button>
      </div>
    );
  }

  if (!editLoaded) return <p className="muted">Loading the entry to edit...</p>;

  return (
    <div>
      <h1 style={{ marginBottom: 24 }}>{editId ? "Edit Money Movement" : "Record Money Movement"}</h1>
      {editId && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <span className="badge" style={{ background: "rgba(59, 130, 246, 0.15)", color: "#60a5fa" }}>
            Editing Entry {editId}
          </span>
          <span className="muted" style={{ fontSize: 13 }}>
            Changes will only be applied when you click &quot;Save correction&quot;. Leaving this page leaves the original entry untouched.
          </span>
        </div>
      )}
      <form onSubmit={submit} className="card grid" style={{ gap: 16, maxWidth: 640 }}>
        <div>
          <label>Flow</label>
          <select value={type} onChange={(e) => { const t = e.target.value as MovementType; setType(t); setCurrency(t === "AgentToVendor" || t === "CompanyToVendor" ? "RMB" : "INR"); setPayerId(""); setPayeeId(""); setPaymentUse(""); setOrderId(""); setActualRate(""); setQuotedRate(""); setAgentFee(""); }}>
            {availableTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label>Payer ({cfg.payerRole})</label>
            <select value={payerId} onChange={(e) => setPayerId(e.target.value)} required>
              <option value="">Select...</option>
              {byRole(cfg.payerRole).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label>Payee ({cfg.payeeRole})</label>
            <select value={payeeId} onChange={(e) => { setPayeeId(e.target.value); setOrderId(""); }} required>
              <option value="">Select...</option>
              {byRole(cfg.payeeRole).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div><label>Amount</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
          <div>
            <label>Currency</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option>RMB</option><option>INR</option><option>USD</option>
            </select>
          </div>
          <div><label>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>

        {(type === "CompanyToAgent" || type === "AgentToVendor") && (
          <div className="card" style={{ background: "var(--soft)" }}>
            <p className="field-label">Agent rate &amp; charges (both optional, can apply together)</p>
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
              <div><label>Actual / reference rate</label><input type="number" value={actualRate} onChange={(e) => setActualRate(e.target.value)} placeholder="e.g. 15" /></div>
              <div><label>Agent's quoted rate</label><input type="number" value={quotedRate} onChange={(e) => setQuotedRate(e.target.value)} placeholder="e.g. 14.5" /></div>
              <div><label>Extra fee</label><input type="number" value={agentFee} onChange={(e) => setAgentFee(e.target.value)} /></div>
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Extra fee is only if the agent actually charged one.</p>
          </div>
        )}

        {isVendorReceipt && (
          <div className="card" style={{ background: "var(--soft)" }}>
            <p className="field-label">Vendor payment use</p>
            <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
              {(["OrderOnly", "OnAccountOnly", "OrderPlusOnAccount"] as PaymentUse[]).map((u) => (
                <label key={u} style={{ display: "flex", alignItems: "center", gap: 4, textTransform: "none", fontSize: 14 }}>
                  <input type="radio" name="use" style={{ width: "auto" }} checked={paymentUse === u} onChange={() => setPaymentUse(u)} />
                  {u === "OrderOnly" ? "Order only" : u === "OnAccountOnly" ? "On-account only" : "Order + on-account"}
                </label>
              ))}
            </div>

            {(paymentUse === "OrderOnly" || paymentUse === "OrderPlusOnAccount") && (
              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label>Order ({currency} only, due &gt; 0)</label>
                  <select value={orderId} onChange={(e) => {
                    setOrderId(e.target.value);
                    const o = vendorOrders.find((x) => x.id === e.target.value);
                    if (paymentUse === "OrderOnly" && o) setAppliedAmount(String(Math.min(o.due, Number(amount) || o.due)));
                  }} required>
                    <option value="">Select...</option>
                    {vendorOrders.map((o) => {
                      const displayDue = o.id === orderId ? o.due + originalAppliedAmount : o.due;
                      return (
                        <option key={o.id} value={o.id}>
                          {o.invoiceRef || o.id} — due {displayDue.toFixed(2)}
                        </option>
                      );
                    })}
                    {editId && orderId && !vendorOrders.some((o) => o.id === orderId) && (
                      <option value={orderId}>(previously selected order)</option>
                    )}
                  </select>
                </div>
                <div>
                  <label>Applied to this order</label>
                  <input
                    type="number"
                    value={paymentUse === "OrderOnly" ? amount : appliedAmount}
                    onChange={(e) => setAppliedAmount(e.target.value)}
                    disabled={paymentUse === "OrderOnly"}
                    required
                  />
                </div>
              </div>
            )}

            <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
              Preview: {currency} {(Number(amount) || 0).toFixed(2)} received
              {paymentUse === "OrderOnly" && ` → all applied to order`}
              {paymentUse === "OnAccountOnly" && ` → all held on account`}
              {paymentUse === "OrderPlusOnAccount" && ` → ${(Number(appliedAmount) || 0).toFixed(2)} to order, ${((Number(amount) || 0) - (Number(appliedAmount) || 0)).toFixed(2)} held`}
              {selectedOrder && (paymentUse === "OrderOnly" || paymentUse === "OrderPlusOnAccount") && ` (order due was ${(selectedOrder.due + (selectedOrder.id === orderId ? originalAppliedAmount : 0)).toFixed(2)})`}
            </p>
          </div>
        )}

        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label>Method</label>
            <select value={methodChoice} onChange={(e) => { const v = e.target.value; setMethodChoice(v); setMethod(v === "Other" ? "" : v); }}>
              <option value="">Select...</option>
              {optionLists.method.map((m) => <option key={m} value={m}>{m}</option>)}
              <option value="Other">Other</option>
            </select>
            {methodChoice === "Other" && (
              <input style={{ marginTop: 8 }} value={method} onChange={(e) => setMethod(e.target.value)} placeholder="Type the method — remembered for next time" required />
            )}
          </div>
          <div>
            <label>Reference</label>
            <select value={referenceChoice} onChange={(e) => { const v = e.target.value; setReferenceChoice(v); setReference(v === "Other" ? "" : v); }}>
              <option value="">Select...</option>
              {optionLists.reference.map((r) => <option key={r} value={r}>{r}</option>)}
              <option value="Other">Other</option>
            </select>
            {referenceChoice === "Other" && (
              <input style={{ marginTop: 8 }} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Type the reference — remembered for next time" />
            )}
          </div>
        </div>
        <ProofUpload label="Proof of transaction (PDF or image, optional)" url={proofUrl} onChange={setProofUrl} />
        <div><label>Note / proof link</label><input value={note} onChange={(e) => setNote(e.target.value)} /></div>

        {error && <p className="error-text">{error}</p>}
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button type="submit" disabled={saving}>
            {saving ? "Saving..." : editId ? "Save correction" : "Save money movement"}
          </button>
          {editId && (
            <button
              type="button"
              className="secondary"
              onClick={() => router.push("/ledger")}
              disabled={saving}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
