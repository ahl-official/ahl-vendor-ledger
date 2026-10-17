"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Application, Contact, MoneyMovement, Transfer } from "@/lib/schema";
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
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <VendorBalanceContent />
    </Suspense>
  );
}

function VendorBalanceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");
  const editKind = searchParams.get("kind") === "application" ? "application" : "transfer";

  const [vendors, setVendors] = useState<VendorLedger[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [currency, setCurrency] = useState("RMB");
  const [action, setAction] = useState<(typeof ACTIONS)[number]["value"]>("apply");
  const [amount, setAmount] = useState("");
  const [orderId, setOrderId] = useState("");
  const [toContactId, setToContactId] = useState("");
  const [paymentUse, setPaymentUse] = useState<"OrderOnly" | "OnAccountOnly" | "OrderPlusOnAccount" | "">("");
  const [appliedAmount, setAppliedAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [editLoaded, setEditLoaded] = useState(!editId);
  const [editVoided, setEditVoided] = useState(false);

  const load = () => {
    fetchJson<{ vendors: VendorLedger[] }>("/api/ledger")
      .then((d) => setVendors(d.vendors))
      .catch((e) => setError(e.message));
    fetchJson<Contact[]>("/api/contacts")
      .then(setContacts)
      .catch((e) => setError(e.message));
    fetchJson<OrderRow[]>("/api/orders")
      .then(setOrders)
      .catch((e) => setError(e.message));
  };
  useEffect(load, []);

  useEffect(() => {
    if (!editId) return;
    type LedgerFull = { movements: MoneyMovement[]; applications: Application[]; transfers: Transfer[] };
    fetchJson<LedgerFull>("/api/ledger")
      .then(async (d) => {
        if (editKind === "transfer") {
          const t = d.transfers.find((x) => x.id === editId);
          if (!t) throw new Error("That entry could not be found — it may already be edited elsewhere.");
          setVendorId(t.fromVendorId);
          setCurrency(t.currency);
          setAction(t.purpose);
          setToContactId(t.toContactId);
          setAmount(String(t.amount));
          setNote(t.note);
          if (t.purpose === "Transfer") {
            if (t.receivingOrderId) {
              setPaymentUse("OrderOnly");
              setOrderId(t.receivingOrderId);
            } else setPaymentUse("OnAccountOnly");
          }
          await fetch(`/api/transfers/${editId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: "Edited — replaced by a corrected entry" }),
          });
        } else {
          const a = d.applications.find((x) => x.id === editId);
          if (!a) throw new Error("That entry could not be found — it may already be edited elsewhere.");
          const movement = d.movements.find((m) => m.id === a.movementId);
          setVendorId(movement?.payeeId ?? "");
          setCurrency(movement?.currency ?? "RMB");
          setAction("apply");
          setOrderId(a.orderId);
          setAmount(String(a.amount));
          await fetch(`/api/applications/${editId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: "Edited — replaced by a corrected entry" }),
          });
        }
        setEditVoided(true);
        setEditLoaded(true);
        load();
      })
      .catch((e) => {
        setError(e.message);
        setEditLoaded(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  const vendor = vendors.find((v) => v.id === vendorId);
  const heldCurrencies = useMemo(() => {
    if (!vendor) return [];
    return Object.entries(vendor.held).filter(([, amt]) => Math.abs(amt) > 0.001);
  }, [vendor]);

  // When vendor changes, auto-select their first held currency
  useEffect(() => {
    if (vendor) {
      const currs = Object.entries(vendor.held).filter(([, amt]) => Math.abs(amt) > 0.001);
      if (currs.length > 0 && !currs.some(([c]) => c === currency)) {
        setCurrency(currs[0][0]);
      }
    }
  }, [vendor, currency]);

  const totalHeld = vendor?.held[currency] ?? 0;

  const recipients =
    action === "Transfer"
      ? contacts.filter((c) => c.roles.includes("Vendor") && c.id !== vendorId)
      : action === "PaySupplier"
      ? contacts.filter((c) => c.roles.includes("Supplier"))
      : action === "Refund"
      ? contacts.filter((c) => c.roles.includes("Company"))
      : [];

  const targetOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.vendorId === (action === "apply" ? vendorId : toContactId) &&
          o.currency === currency &&
          o.due > 0.01
      ),
    [orders, vendorId, toContactId, action, currency]
  );

  const isTransferSplit = action === "Transfer" && toContactId;
  const effectiveApplied = paymentUse === "OrderOnly" ? amount : appliedAmount;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const amt = Number(amount);
    if (!vendor) return setError("Choose a vendor");
    if (!amt || amt <= 0) return setError("Amount must be greater than 0");
    if (amt - totalHeld > 0.01) {
      return setError(`Vendor only holds ${currency} ${totalHeld.toFixed(2)} in total balance`);
    }
    if (isTransferSplit && !paymentUse) {
      return setError("Choose Order only / On-account only / Order + on-account");
    }

    setSaving(true);
    const res =
      action === "apply"
        ? await fetch("/api/applications", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ vendorId, orderId, amount: amt }),
          })
        : await fetch("/api/transfers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fromVendorId: vendorId,
              purpose: action,
              toContactId,
              amount: amt,
              currency,
              paymentUse: isTransferSplit ? paymentUse : undefined,
              receivingOrderId: isTransferSplit ? (paymentUse === "OnAccountOnly" ? "" : orderId) : orderId,
              appliedAmount: isTransferSplit ? Number(effectiveApplied || 0) : undefined,
              note,
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
        <p style={{ marginBottom: 16 }}>Vendor balance updated.</p>
        <button onClick={() => router.push("/ledger")}>View ledger</button>{" "}
        <button
          className="secondary"
          onClick={() => {
            setDone(false);
            setAmount("");
            setPaymentUse("");
            setAppliedAmount("");
            setOrderId("");
          }}
        >
          Do another
        </button>
      </div>
    );
  }

  if (!editLoaded) return <p className="muted">Loading the entry to edit...</p>;

  return (
    <div>
      <h1 style={{ marginBottom: 24 }}>
        {editId ? "Edit Vendor Balance Entry" : "Use Vendor Balance"}
      </h1>
      {editId && editVoided && (
        <p className="badge hold" style={{ marginBottom: 16, display: "inline-block" }}>
          Editing — the original entry is now voided (visible, struck-through, on the Ledger). Save below to record its replacement.
        </p>
      )}
      <form onSubmit={submit} className="card grid" style={{ gap: 16, maxWidth: 640 }}>
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label>Vendor</label>
            <select
              value={vendorId}
              onChange={(e) => {
                setVendorId(e.target.value);
                setAmount("");
                setOrderId("");
              }}
              required
            >
              <option value="">Select...</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label>Total Balance Held</label>
            {vendor ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 38 }}>
                {heldCurrencies.length > 0 ? (
                  heldCurrencies.map(([curr, bal]) => (
                    <button
                      key={curr}
                      type="button"
                      className={`badge ${currency === curr ? "hold" : "info"}`}
                      style={{
                        fontSize: 13,
                        padding: "6px 12px",
                        cursor: heldCurrencies.length > 1 ? "pointer" : "default",
                        borderWidth: currency === curr ? 2 : 1,
                        fontWeight: 600,
                      }}
                      onClick={() => setCurrency(curr)}
                      title={heldCurrencies.length > 1 ? `Click to spend in ${curr}` : undefined}
                    >
                      {curr} {bal.toFixed(2)}
                    </button>
                  ))
                ) : (
                  <span className="muted" style={{ fontSize: 13 }}>Nothing held</span>
                )}
              </div>
            ) : (
              <input disabled placeholder="Select a vendor first" />
            )}
          </div>
        </div>

        <div>
          <label>Action</label>
          <select
            value={action}
            onChange={(e) => {
              setAction(e.target.value as (typeof ACTIONS)[number]["value"]);
              setOrderId("");
              setToContactId("");
              setPaymentUse("");
              setAppliedAmount("");
            }}
          >
            {ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        {(action === "Transfer" || action === "PaySupplier" || action === "Refund") && (
          <div>
            <label>
              {action === "Transfer"
                ? "Receiving vendor"
                : action === "PaySupplier"
                ? "Supplier"
                : "Company to refund"}
            </label>
            <select
              value={toContactId}
              onChange={(e) => {
                setToContactId(e.target.value);
                setOrderId("");
              }}
              required
            >
              <option value="">Select...</option>
              {recipients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {action === "apply" && (
          <div>
            <label>Order to apply toward ({currency} only, due &gt; 0)</label>
            <select value={orderId} onChange={(e) => setOrderId(e.target.value)} required disabled={!vendor}>
              <option value="">Select...</option>
              {targetOrders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.invoiceRef || o.id} — due {currency} {o.due.toFixed(2)}
                </option>
              ))}
              {editId && orderId && !targetOrders.some((o) => o.id === orderId) && (
                <option value={orderId}>(previously selected order)</option>
              )}
            </select>
          </div>
        )}

        <div>
          <label>Amount to spend ({currency})</label>
          <input
            type="number"
            step="any"
            value={amount}
            max={totalHeld}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={totalHeld > 0 ? `Max ${totalHeld.toFixed(2)}` : "0.00"}
            required
            disabled={!vendor || totalHeld <= 0}
          />
        </div>

        {isTransferSplit && (
          <div className="card" style={{ background: "var(--soft)" }}>
            <p className="field-label">What the receiving vendor does with it</p>
            <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
              {(["OrderOnly", "OnAccountOnly", "OrderPlusOnAccount"] as const).map((u) => (
                <label key={u} style={{ display: "flex", alignItems: "center", gap: 4, textTransform: "none", fontSize: 14 }}>
                  <input
                    type="radio"
                    name="transferUse"
                    style={{ width: "auto" }}
                    checked={paymentUse === u}
                    onChange={() => setPaymentUse(u)}
                  />
                  {u === "OrderOnly" ? "Order only" : u === "OnAccountOnly" ? "On-account only" : "Order + on-account"}
                </label>
              ))}
            </div>

            {(paymentUse === "OrderOnly" || paymentUse === "OrderPlusOnAccount") && (
              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label>Receiving vendor&apos;s order</label>
                  <select
                    value={orderId}
                    onChange={(e) => {
                      setOrderId(e.target.value);
                      const o = targetOrders.find((x) => x.id === e.target.value);
                      if (paymentUse === "OrderOnly" && o) {
                        setAppliedAmount(String(Math.min(o.due, Number(amount) || o.due)));
                      }
                    }}
                    required
                  >
                    <option value="">Select...</option>
                    {targetOrders.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.invoiceRef || o.id} — due {o.due.toFixed(2)}
                      </option>
                    ))}
                    {editId && orderId && !targetOrders.some((o) => o.id === orderId) && (
                      <option value={orderId}>(previously selected order)</option>
                    )}
                  </select>
                </div>
                <div>
                  <label>Applied to this order</label>
                  <input
                    type="number"
                    step="any"
                    value={effectiveApplied}
                    onChange={(e) => setAppliedAmount(e.target.value)}
                    disabled={paymentUse === "OrderOnly"}
                    required
                  />
                </div>
              </div>
            )}

            <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
              {paymentUse === "OrderOnly" && `All of it pays the order.`}
              {paymentUse === "OnAccountOnly" && `All of it is held on the receiving vendor's account.`}
              {paymentUse === "OrderPlusOnAccount" &&
                `${(Number(appliedAmount) || 0).toFixed(2)} pays the order, ${(
                  (Number(amount) || 0) - (Number(appliedAmount) || 0)
                ).toFixed(2)} is held on account.`}
            </p>
          </div>
        )}

        {vendor && amount && Number(amount) > 0 && (
          <p className="muted" style={{ fontSize: 13 }}>
            Before → Change → After: {currency} {totalHeld.toFixed(2)} → -{Number(amount).toFixed(2)} →{" "}
            {(totalHeld - Number(amount)).toFixed(2)} remaining held by {vendor.name}
          </p>
        )}

        {action !== "apply" && (
          <div>
            <label>Note / proof</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        )}

        {error && <p className="error-text">{error}</p>}
        <button type="submit" disabled={saving || !vendor || totalHeld <= 0} style={{ justifySelf: "start" }}>
          {saving ? "Saving..." : editId ? "Save correction" : "Save"}
        </button>
      </form>
    </div>
  );
}
