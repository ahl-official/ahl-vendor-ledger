"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Application, Contact, CreditNote, MoneyMovement, Transfer } from "@/lib/schema";
import { fetchJson } from "@/lib/fetchJson";
import { ProofUpload } from "@/app/components/ProofUpload";
import { convertByRate } from "@/lib/ledger";

type Receipt = { movementId: string; date: string; currency: string; remaining: number };
type VendorLedger = Contact & { held: Record<string, number>; openReceipts: Receipt[] };
type OrderRow = { id: string; vendorId: string; invoiceRef: string; currency: string; due: number };

const ACTIONS = [
  { value: "apply", label: "Apply to Order" },
  { value: "Transfer", label: "Transfer to Vendor" },
  { value: "PaySupplier", label: "Pay Supplier" },
  { value: "Expense", label: "Record Expense" },
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
  const [movements, setMovements] = useState<MoneyMovement[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [date, setDate] = useState("");
  const [currency, setCurrency] = useState("RMB");
  const [action, setAction] = useState<(typeof ACTIONS)[number]["value"]>("apply");
  const [amount, setAmount] = useState("");
  const [orderId, setOrderId] = useState("");
  const [toContactId, setToContactId] = useState("");
  const [paymentUse, setPaymentUse] = useState<"OrderOnly" | "OnAccountOnly" | "OrderPlusOnAccount" | "">("");
  const [appliedAmount, setAppliedAmount] = useState("");
  const [note, setNote] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [editLoaded, setEditLoaded] = useState(!editId);
  const [originalEditAmount, setOriginalEditAmount] = useState(0);
  const [originalEditOrderId, setOriginalEditOrderId] = useState("");
  const [originalEditVendorId, setOriginalEditVendorId] = useState("");
  const [originalEditCurrency, setOriginalEditCurrency] = useState("");
  const [spendCurrency, setSpendCurrency] = useState("");
  const [spendRate, setSpendRate] = useState("");

  useEffect(() => {
    if (!editId) setDate(new Date().toISOString().slice(0, 10));
  }, [editId]);

  const load = () => {
    fetchJson<{ vendors: VendorLedger[]; movements: MoneyMovement[] }>("/api/ledger")
      .then((d) => { setVendors(d.vendors); setMovements(d.movements); })
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
    type LedgerFull = { movements: MoneyMovement[]; applications: Application[]; transfers: Transfer[]; creditNotes: CreditNote[] };
    fetchJson<LedgerFull>("/api/ledger")
      .then(async (d) => {
        if (editKind === "transfer") {
          const t = d.transfers.find((x) => x.id === editId);
          if (!t) throw new Error("That entry could not be found — it may already be edited elsewhere.");
          setVendorId(t.fromVendorId);
          setOriginalEditVendorId(t.fromVendorId);
          setCurrency(t.currency);
          setOriginalEditCurrency(t.currency);
          setAction(t.purpose === "PaySupplier" ? "PaySupplier" : t.purpose === "Expense" ? "Expense" : "Transfer");
          setToContactId(t.toContactId);
          setAmount(String(t.amount));
          setOriginalEditAmount(t.amount);
          setDate(t.date ?? t.createdAt.slice(0, 10));
          setNote(t.note);
          setProofUrl(t.proofUrl);
          if (t.purpose === "Transfer") {
            if (t.receivingOrderId) {
              setPaymentUse("OrderOnly");
              setOrderId(t.receivingOrderId);
              setOriginalEditOrderId(t.receivingOrderId);
            } else setPaymentUse("OnAccountOnly");
          }
        } else {
          const a = d.applications.find((x) => x.id === editId);
          if (!a) throw new Error("That entry could not be found — it may already be edited elsewhere.");
          const movement = d.movements.find((m) => m.id === a.movementId);
          const vId = movement?.payeeId ?? "";
          const curr = movement?.currency ?? "RMB";
          setVendorId(vId);
          setOriginalEditVendorId(vId);
          setCurrency(curr);
          setOriginalEditCurrency(curr);
          setAction("apply");
          setOrderId(a.orderId);
          setOriginalEditOrderId(a.orderId);
          setAmount(String(a.amount));
          setOriginalEditAmount(a.amount);
          setDate(a.date ?? a.createdAt.slice(0, 10));
        }
        setEditLoaded(true);
      })
      .catch((e) => {
        setError(e.message);
        setEditLoaded(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  // Spending in a different currency than what's held is only offered outside "apply" --
  // an order's due amount is fixed in its own currency, so applying to it can't convert.
  useEffect(() => {
    setSpendCurrency(currency);
  }, [currency, vendorId, action]);

  // Reuse a rate already entered when money was received into this vendor's balance,
  // instead of asking for it again, when switching to spend in a different currency.
  useEffect(() => {
    if (spendCurrency === currency) return setSpendRate("");
    const withRate = movements
      .filter((m) => !m.reversed && m.payeeId === vendorId && m.currency === currency && m.rateCurrency === spendCurrency && (m.quotedRate || m.actualRate))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    setSpendRate(withRate ? String(withRate.quotedRate ?? withRate.actualRate) : "");
  }, [spendCurrency, currency, vendorId, movements]);

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

  const totalHeld =
    (vendor?.held[currency] ?? 0) +
    (editId && vendorId === originalEditVendorId && currency === originalEditCurrency ? originalEditAmount : 0);

  // "Amount to spend" is typed in spendCurrency; convertedAmt is what actually gets
  // deducted from the vendor's real balance (held in `currency`).
  const convertingSpend = action !== "apply" && spendCurrency !== currency;
  const spendRateNum = Number(spendRate);
  const typedAmt = Number(amount) || 0;
  const convertedAmt = convertingSpend && spendRateNum > 0 ? convertByRate(typedAmt, spendRateNum, spendCurrency, currency) : typedAmt;
  const spendMax = convertingSpend ? (spendRateNum > 0 ? convertByRate(totalHeld, spendRateNum, currency, spendCurrency) : undefined) : totalHeld;

  const recipients =
    action === "Transfer"
      ? contacts.filter((c) => c.roles.includes("Vendor") && c.id !== vendorId)
      : action === "PaySupplier"
      ? contacts.filter((c) => c.roles.includes("Supplier"))
      : [];
  // Expense doesn't ask who spent it -- the system still needs a "to" contact internally,
  // so it's silently recorded against the Company.
  const companyContactId = contacts.find((c) => c.roles.includes("Company"))?.id ?? "";

  const targetOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.vendorId === (action === "apply" ? vendorId : toContactId) &&
          o.currency === currency &&
          (o.due > 0.01 || o.id === orderId)
      ),
    [orders, vendorId, toContactId, action, currency, orderId]
  );

  const isTransferSplit = action === "Transfer" && toContactId;
  const effectiveApplied = paymentUse === "OrderOnly" ? String(convertedAmt) : appliedAmount;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!vendor) return setError("Choose a vendor");
    if (!typedAmt || typedAmt <= 0) return setError("Amount must be greater than 0");
    if (convertingSpend && !(spendRateNum > 0)) return setError(`Enter the ${spendCurrency}→${currency} rate to convert`);
    const amt = convertedAmt;
    if (amt - totalHeld > 0.01) {
      return setError(`Vendor only holds ${currency} ${totalHeld.toFixed(2)} in total balance`);
    }
    if (action === "Expense" && !companyContactId) return setError("No Company contact found to record this against");
    if (isTransferSplit && !paymentUse) {
      return setError("Choose Order only / On-account only / Order + on-account");
    }

    setSaving(true);
    try {
      if (editId) {
        // Void the previous entry -- never delete it. It stays visible (struck-through)
        // in the Ledger as history; see docs/ARCHITECTURE.md rule 1.
        const voidUrl = editKind === "transfer" ? `/api/transfers/${editId}` : `/api/applications/${editId}`;
        const voidRes = await fetch(voidUrl, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "Edited — replaced by a corrected entry" }),
        });
        if (!voidRes.ok) {
          const vErr = await voidRes.json().catch(() => ({}));
          throw new Error(vErr.error || "Failed to update previous entry");
        }
      }

      const res =
        action === "apply"
          ? await fetch("/api/applications", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ vendorId, orderId, amount: amt, date }),
            })
          : await fetch("/api/transfers", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                fromVendorId: vendorId,
                purpose: action,
                toContactId: action === "Expense" ? companyContactId : toContactId,
                amount: amt,
                currency,
                paymentUse: isTransferSplit ? paymentUse : undefined,
                receivingOrderId: isTransferSplit ? (paymentUse === "OnAccountOnly" ? "" : orderId) : orderId,
                appliedAmount: isTransferSplit ? Number(effectiveApplied || 0) : undefined,
                date,
                note: convertingSpend
                  ? [note, `Entered as ${spendCurrency} ${typedAmt.toFixed(2)} @ ${spendRateNum} → ${currency} ${amt.toFixed(2)}`].filter(Boolean).join("\n\n")
                  : note,
                proofUrl,
              }),
            });
      setSaving(false);
      if (!res.ok) {
        const rErr = await res.json().catch(() => ({}));
        throw new Error(rErr.error ?? "Failed to save");
      }
      setDone(true);
      load();
    } catch (err: unknown) {
      setSaving(false);
      setError(err instanceof Error ? err.message : "Failed to save");
    }
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
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
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

        {(action === "Transfer" || action === "PaySupplier") && (
          <div>
            <label>
              {action === "Transfer" ? "Receiving vendor" : "Supplier"}
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
              {targetOrders.map((o) => {
                const displayDue = o.due + (o.id === originalEditOrderId ? originalEditAmount : 0);
                return (
                  <option key={o.id} value={o.id}>
                    {o.invoiceRef || o.id} — due {currency} {displayDue.toFixed(2)}
                  </option>
                );
              })}
              {editId && orderId && !targetOrders.some((o) => o.id === orderId) && (
                <option value={orderId}>(previously selected order)</option>
              )}
            </select>
          </div>
        )}

        {action !== "apply" && heldCurrencies.length > 0 && (
          <div className="grid" style={{ gridTemplateColumns: convertingSpend ? "1fr 1fr" : "1fr" }}>
            <div>
              <label>Spend in</label>
              <select value={spendCurrency} onChange={(e) => setSpendCurrency(e.target.value)}>
                <option value={currency}>{currency} (vendor&apos;s balance)</option>
                {["USD", "RMB", "INR"].filter((c) => c !== currency).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            {convertingSpend && (
              <div>
                <label>Rate ({spendCurrency}→{currency})</label>
                <input
                  type="number" step="any" value={spendRate}
                  onChange={(e) => setSpendRate(e.target.value)}
                  placeholder="e.g. 83"
                />
              </div>
            )}
          </div>
        )}

        <div>
          <label>Amount to spend ({spendCurrency || currency})</label>
          <input
            type="number"
            step="any"
            value={amount}
            max={spendMax}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={spendMax && spendMax > 0 ? `Max ${spendMax.toFixed(2)}` : "0.00"}
            required
            disabled={!vendor || totalHeld <= 0 || (convertingSpend && !(spendRateNum > 0))}
          />
          {convertingSpend && spendRateNum > 0 && typedAmt > 0 && (
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              = {currency} {convertedAmt.toFixed(2)} from the vendor&apos;s actual balance
            </p>
          )}
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
                        setAppliedAmount(String(Math.min(o.due, convertedAmt || o.due)));
                      }
                    }}
                    required
                  >
                    <option value="">Select...</option>
                    {targetOrders.map((o) => {
                      const displayDue = o.due + (o.id === originalEditOrderId ? originalEditAmount : 0);
                      return (
                        <option key={o.id} value={o.id}>
                          {o.invoiceRef || o.id} — due {displayDue.toFixed(2)}
                        </option>
                      );
                    })}
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
                  convertedAmt - (Number(appliedAmount) || 0)
                ).toFixed(2)} is held on account.`}
            </p>
          </div>
        )}

        {vendor && typedAmt > 0 && (!convertingSpend || spendRateNum > 0) && (
          <p className="muted" style={{ fontSize: 13 }}>
            Before → Change → After: {currency} {totalHeld.toFixed(2)} → -{convertedAmt.toFixed(2)} →{" "}
            {(totalHeld - convertedAmt).toFixed(2)} remaining held by {vendor.name}
            {convertingSpend && ` (entered as ${spendCurrency} ${typedAmt.toFixed(2)} @ ${spendRateNum})`}
          </p>
        )}

        {action !== "apply" && (
          <>
            <ProofUpload label={action === "Expense" ? "Receipt (PDF or image, optional)" : "Proof of transaction (PDF or image, optional)"} url={proofUrl} onChange={setProofUrl} />
            <div>
              <label>{action === "Expense" ? "What was it for?" : "Note / proof link"}</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} required={action === "Expense"} />
            </div>
          </>
        )}

        {error && <p className="error-text">{error}</p>}
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button type="submit" disabled={saving || !vendor || totalHeld <= 0}>
            {saving ? "Saving..." : editId ? "Save correction" : "Save"}
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
