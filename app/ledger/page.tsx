"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Contact, CreditNote, FxConversion, MoneyMovement, Application, Transfer, Role } from "@/lib/schema";
import { fetchJson } from "@/lib/fetchJson";
import { Loading } from "@/app/components/Loading";

type VendorLedger = Contact & { held: Record<string, number> };
type AgentLedger = Contact & { position: Record<string, number> };
type OrderRow = { id: string; vendorId: string; invoiceRef: string; date: string; currency: string; total: number; paid: number; due: number };
type LedgerResponse = {
  vendors: VendorLedger[]; agents: AgentLedger[]; orders: OrderRow[];
  movements: MoneyMovement[]; applications: Application[]; transfers: Transfer[]; fxConversions: FxConversion[];
  creditNotes?: CreditNote[];
};

const LOOKUP_ROLES: Role[] = ["Vendor", "Agent", "Company"];

type Event = {
  id: string;
  kind: "movement" | "transfer" | "application" | "credit_note";
  date: string;
  createdAt: string;
  label: string;
  amount: number;
  currency: string;
  note: string;
  editHref: string | null;
  rate?: number | null;
  inrAmount?: number | null;
  rmbAmount?: number | null;
  balanceRmb?: number | null;
  credited?: number | null;
  debited?: number | null;
  runningBalance?: number | null;
};

export default function LedgerPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [vendors, setVendors] = useState<VendorLedger[]>([]);
  const [agents, setAgents] = useState<AgentLedger[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [movements, setMovements] = useState<MoneyMovement[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [fxConversions, setFxConversions] = useState<FxConversion[]>([]);
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [roleFilter, setRoleFilter] = useState<Role | "">("");
  const [selectedId, setSelectedId] = useState("");

  const loadLedger = () => {
    Promise.all([
      fetchJson<LedgerResponse>("/api/ledger"),
      fetchJson<Contact[]>("/api/contacts"),
    ])
      .then(([d, c]) => {
        setVendors(d.vendors);
        setAgents(d.agents);
        setOrders(d.orders);
        setMovements(d.movements);
        setApplications(d.applications);
        setTransfers(d.transfers);
        setFxConversions(d.fxConversions);
        setCreditNotes(d.creditNotes ?? []);
        setContacts(c);
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadLedger();
  }, []);

  const nameOf = (id: string) => contacts.find((c) => c.id === id)?.name ?? id;

  const companyBehind = (agentId: string) => {
    const funding = movements.find((m) => !m.reversed && m.type === "CompanyToAgent" && m.payeeId === agentId);
    return funding ? nameOf(funding.payerId) : null;
  };

  const contactOptions = useMemo(
    () => (roleFilter ? contacts.filter((c) => c.roles.includes(roleFilter)) : []),
    [contacts, roleFilter]
  );
  const selected = contacts.find((c) => c.id === selectedId);

  const proofById = useMemo(
    () => new Map([...movements, ...transfers].filter((x) => x.proofUrl).map((x) => [x.id, x.proofUrl])),
    [movements, transfers]
  );

  const events = useMemo<Event[]>(() => {
    if (!selectedId || !roleFilter) return [];
    const out: Event[] = [];

    if (roleFilter === "Vendor") {
      movements
        .filter((m) => !m.reversed && m.type === "AgentToVendor" && m.payeeId === selectedId)
        .forEach((m) => {
          const company = companyBehind(m.payerId);
          out.push({
            id: m.id,
            kind: "movement",
            date: m.date,
            createdAt: m.createdAt || m.date,
            label: `Received from ${nameOf(m.payerId)}${company ? ` (on behalf of ${company})` : ""}`,
            amount: m.amount,
            currency: m.currency,
            note: m.note,
            editHref: `/payments/new?editId=${m.id}`,
            credited: m.amount,
            debited: null,
          });
        });
      transfers
        .filter((t) => !t.reversed && t.purpose === "Transfer" && t.toContactId === selectedId)
        .forEach((t) => {
          const order = t.receivingOrderId ? orders.find((o) => o.id === t.receivingOrderId) : undefined;
          out.push({
            id: t.id,
            kind: "transfer",
            date: t.createdAt.slice(0, 10),
            createdAt: t.createdAt,
            label: `Received transfer from ${nameOf(t.fromVendorId)}${t.receivingOrderId ? ` (paid order ${order?.invoiceRef || t.receivingOrderId})` : " (on account)"}`,
            amount: t.receivingOrderId ? 0 : t.amount,
            currency: t.currency,
            note: t.note,
            editHref: `/vendor-balance?editId=${t.id}`,
            credited: t.amount,
            debited: t.receivingOrderId ? t.amount : null,
          });
        });
      transfers
        .filter((t) => !t.reversed && t.fromVendorId === selectedId)
        .forEach((t) => {
          const label =
            t.purpose === "Transfer"
              ? `Transferred to ${nameOf(t.toContactId)}`
              : t.purpose === "PaySupplier"
              ? `Paid supplier ${nameOf(t.toContactId)}`
              : t.toContactId
              ? `Refunded to ${nameOf(t.toContactId)}`
              : "Refunded out";
          out.push({
            id: t.id,
            kind: "transfer",
            date: t.createdAt.slice(0, 10),
            createdAt: t.createdAt,
            label,
            amount: -t.amount,
            currency: t.currency,
            note: t.note,
            editHref: `/vendor-balance?editId=${t.id}`,
            credited: null,
            debited: t.amount,
          });
        });
      applications
        .filter((a) => a.active && movements.some((m) => !m.reversed && m.id === a.movementId && m.payeeId === selectedId))
        .forEach((a) => {
          const order = orders.find((o) => o.id === a.orderId);
          const movement = movements.find((m) => m.id === a.movementId);
          const curr = order?.currency || movement?.currency || "RMB";
          out.push({
            id: a.id,
            kind: "application",
            date: a.createdAt.slice(0, 10),
            createdAt: a.createdAt,
            label: `Applied to order ${order?.invoiceRef || a.orderId}`,
            amount: -a.amount,
            currency: curr,
            note: "",
            editHref: `/vendor-balance?editId=${a.id}&kind=application`,
            credited: null,
            debited: a.amount,
          });
        });
      creditNotes
        .filter((cn) => !cn.reversed && cn.vendorId === selectedId)
        .forEach((cn) => {
          const order = orders.find((o) => o.id === cn.orderId);
          out.push({
            id: cn.id,
            kind: "credit_note",
            date: cn.date,
            createdAt: cn.createdAt,
            label: `Credit Note — Order ${order?.invoiceRef || cn.orderId}${cn.reason ? ` (${cn.reason})` : ""}`,
            amount: cn.amount,
            currency: cn.currency,
            note: cn.reason,
            editHref: `/orders/${cn.orderId}`,
            credited: cn.amount,
            debited: null,
          });
        });

      // 1. Calculate running balance chronologically (oldest to newest by creation timestamp)
      out.sort((a, b) => {
        const timeDiff = a.createdAt.localeCompare(b.createdAt);
        if (timeDiff !== 0) return timeDiff;
        if (a.kind === "movement" && b.kind !== "movement") return -1;
        if (b.kind === "movement" && a.kind !== "movement") return 1;
        return 0;
      });
      const runningBalances: Record<string, number> = {};
      for (const e of out) {
        runningBalances[e.currency] = (runningBalances[e.currency] ?? 0) + e.amount;
        e.runningBalance = runningBalances[e.currency];
      }
    } else if (roleFilter === "Agent") {
      movements
        .filter((m) => !m.reversed && m.type === "CompanyToAgent" && m.payeeId === selectedId)
        .forEach((m) => {
          const rate = m.quotedRate ?? m.actualRate ?? null;
          let inrAmount: number | null = m.currency === "INR" ? m.amount : null;
          let rmbAmount: number | null = m.currency === "RMB" ? m.amount : null;
          if (m.currency === "INR") {
            if (rate && rate > 0) {
              rmbAmount = rate > 1 ? m.amount / rate : m.amount * rate;
            } else {
              const conv = fxConversions.find((c) => c.fundingMovementId === m.id && !c.reversed);
              if (conv) rmbAmount = conv.toAmount;
            }
          } else if (m.currency === "RMB" && rate && rate > 0) {
            inrAmount = m.amount * (rate > 1 ? rate : 1 / rate);
          }
          out.push({
            id: m.id,
            kind: "movement",
            date: m.date,
            createdAt: m.createdAt || m.date,
            label: `Received from Company`,
            amount: m.amount,
            currency: m.currency,
            note: m.note,
            editHref: `/payments/new?editId=${m.id}`,
            rate,
            inrAmount,
            rmbAmount,
          });
        });

      movements
        .filter((m) => !m.reversed && m.type === "AgentToVendor" && m.payerId === selectedId)
        .forEach((m) => {
          const rate = m.quotedRate ?? m.actualRate ?? null;
          let rmbAmount: number | null = m.currency === "RMB" ? -m.amount : null;
          let inrAmount: number | null = m.currency === "INR" ? -m.amount : null;
          if (m.currency === "RMB") {
            if (rate && rate > 0) {
              inrAmount = -(m.amount * (rate > 1 ? rate : 1 / rate));
            } else {
              const conv = fxConversions.find((c) => c.spendMovementId === m.id && !c.reversed);
              if (conv) inrAmount = -conv.fromAmount;
            }
          } else if (m.currency === "INR" && rate && rate > 0) {
            rmbAmount = -(m.amount / (rate > 1 ? rate : 1 / rate));
          }
          out.push({
            id: m.id,
            kind: "movement",
            date: m.date,
            createdAt: m.createdAt || m.date,
            label: `Paid vendor ${nameOf(m.payeeId)}`,
            amount: -m.amount,
            currency: m.currency,
            note: m.note,
            editHref: `/payments/new?editId=${m.id}`,
            rate,
            inrAmount,
            rmbAmount,
          });
        });

      movements
        .filter((m) => !m.reversed && m.type === "AgentToCompany" && m.payerId === selectedId)
        .forEach((m) => {
          const rate = m.quotedRate ?? m.actualRate ?? null;
          let rmbAmount: number | null = m.currency === "RMB" ? -m.amount : null;
          let inrAmount: number | null = m.currency === "INR" ? -m.amount : null;
          if (m.currency === "INR" && rate && rate > 0) {
            rmbAmount = -(rate > 1 ? m.amount / rate : m.amount * rate);
          } else if (m.currency === "RMB" && rate && rate > 0) {
            inrAmount = -(m.amount * (rate > 1 ? rate : 1 / rate));
          }
          out.push({
            id: m.id,
            kind: "movement",
            date: m.date,
            createdAt: m.createdAt || m.date,
            label: `Returned to Company`,
            amount: -m.amount,
            currency: m.currency,
            note: m.note,
            editHref: `/payments/new?editId=${m.id}`,
            rate,
            inrAmount,
            rmbAmount,
          });
        });

      // 1. Calculate running balance chronologically (oldest to newest by creation timestamp)
      out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      let runningRmb = 0;
      for (const e of out) {
        if (e.rmbAmount != null) {
          runningRmb += e.rmbAmount;
        }
        e.balanceRmb = runningRmb;
      }
    } else if (roleFilter === "Company") {
      movements
        .filter((m) => !m.reversed && m.type === "CompanyToAgent" && m.payerId === selectedId)
        .forEach((m) =>
          out.push({
            id: m.id,
            kind: "movement",
            date: m.date,
            createdAt: m.createdAt || m.date,
            label: `Sent to agent ${nameOf(m.payeeId)}`,
            amount: -m.amount,
            currency: m.currency,
            note: m.note,
            editHref: `/payments/new?editId=${m.id}`,
          })
        );
      movements
        .filter((m) => !m.reversed && m.type === "AgentToCompany" && m.payeeId === selectedId)
        .forEach((m) =>
          out.push({
            id: m.id,
            kind: "movement",
            date: m.date,
            createdAt: m.createdAt || m.date,
            label: `Received from agent ${nameOf(m.payerId)}`,
            amount: m.amount,
            currency: m.currency,
            note: m.note,
            editHref: `/payments/new?editId=${m.id}`,
          })
        );
      transfers
        .filter((t) => !t.reversed && t.purpose === "Refund" && t.toContactId === selectedId)
        .forEach((t) =>
          out.push({
            id: t.id,
            kind: "transfer",
            date: t.createdAt.slice(0, 10),
            createdAt: t.createdAt,
            label: `Refund received from ${nameOf(t.fromVendorId)}`,
            amount: t.amount,
            currency: t.currency,
            note: t.note,
            editHref: `/vendor-balance?editId=${t.id}`,
          })
        );
    }

    // 2. Display latest transaction on top (like a bank passbook)
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [selectedId, roleFilter, movements, transfers, applications, fxConversions, creditNotes, orders, contacts]);

  const openLedger = (role: Role, id: string) => {
    setRoleFilter(role);
    setSelectedId(id);
    window.scrollTo({ top: 0 });
  };

  const vendorOrders = roleFilter === "Vendor" ? orders.filter((o) => o.vendorId === selectedId) : [];
  const vendorHeld = roleFilter === "Vendor" ? vendors.find((v) => v.id === selectedId)?.held : undefined;
  const companyNet = useMemo(() => {
    if (roleFilter !== "Company") return undefined;
    const byCurrency: Record<string, number> = {};
    events.forEach((e) => {
      byCurrency[e.currency] = (byCurrency[e.currency] ?? 0) + e.amount;
    });
    return byCurrency;
  }, [roleFilter, events]);

  // Voids the row -- never deletes it. Financial rows are append-only (see
  // docs/ARCHITECTURE.md rule 1): the entry stays visible, struck-through, with a
  // "Corrected"/"Voided" badge, instead of vanishing with no trace.
  const handleDeleteTransaction = async (e: Event) => {
    if (!window.confirm(`Void this transaction "${e.label}"?\n\nIt will stay visible (struck-through) in the history for audit purposes -- it is not permanently deleted.`)) {
      return;
    }
    setDeletingId(e.id);
    setActionError("");
    try {
      const endpoint =
        e.kind === "movement"
          ? `/api/movements/${e.id}`
          : e.kind === "transfer"
          ? `/api/transfers/${e.id}`
          : e.kind === "credit_note"
          ? `/api/credit-notes/${e.id}`
          : `/api/applications/${e.id}`;
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Voided from Ledger" }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to void transaction");
      }
      loadLedger();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to void transaction";
      setActionError(msg);
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div>
        <h1 style={{ marginBottom: 24 }}>Ledger</h1>
        <Loading label="Loading ledger" />
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ marginBottom: 24 }}>Ledger</h1>
      {loadError && <p className="error-text" style={{ marginBottom: 16 }}>{loadError}</p>}
      {actionError && (
        <div className="card" style={{ background: "var(--err-bg)", borderColor: "var(--err-border)", marginBottom: 16 }}>
          <p className="error-text" style={{ margin: 0 }}>{actionError}</p>
        </div>
      )}

      <div className="card" style={{ marginBottom: 32 }}>
        <p className="field-label">Look up one contact</p>
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", maxWidth: 560 }}>
          <div>
            <label>Is this a...</label>
            <select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value as Role | ""); setSelectedId(""); }}>
              <option value="">Select...</option>
              {LOOKUP_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label>Name</label>
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} disabled={!roleFilter}>
              <option value="">Select...</option>
              {contactOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {selected ? (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2>{selected.name}</h2>
            <button className="secondary" onClick={() => { setRoleFilter(""); setSelectedId(""); }}>← Back to overview</button>
          </div>

          <div className="card" style={{ marginBottom: 24 }}>
            {roleFilter === "Vendor" && (
              <>
                <p className="field-label">Currently held</p>
                {vendorHeld && Object.entries(vendorHeld).filter(([, amt]) => Math.abs(amt) > 0.01).length
                  ? Object.entries(vendorHeld).filter(([, amt]) => Math.abs(amt) > 0.01).map(([c, amt]) => (
                      <span key={c} className={`badge ${amt > 0 ? "hold" : "err"}`} style={{ marginRight: 6 }}>{c} {amt.toFixed(2)}</span>
                    ))
                  : <span className="muted">Nothing held</span>}
              </>
            )}
            {roleFilter === "Agent" && (
              <>
                <p className="field-label">Running position</p>
                <div>
                  {events.length > 0 && events[0].balanceRmb != null ? (
                    events[0].balanceRmb > 0.001 ? (
                      <span className="badge hold" style={{ fontWeight: 600, fontSize: 13, padding: "6px 12px" }}>
                        Agent holds: RMB {events[0].balanceRmb.toFixed(2)}
                      </span>
                    ) : events[0].balanceRmb < -0.001 ? (
                      <span className="badge err" style={{ fontWeight: 600, fontSize: 13, padding: "6px 12px" }}>
                        Company owes: RMB {Math.abs(events[0].balanceRmb).toFixed(2)}
                      </span>
                    ) : (
                      <span className="badge ok" style={{ fontWeight: 600, fontSize: 13, padding: "6px 12px" }}>
                        Settled (RMB 0.00)
                      </span>
                    )
                  ) : (
                    <span className="muted">No transactions</span>
                  )}
                </div>
              </>
            )}
            {roleFilter === "Company" && (
              <>
                <p className="field-label">Net cash movement</p>
                {companyNet && Object.entries(companyNet).filter(([, amt]) => Math.abs(amt) > 0.01).length
                  ? Object.entries(companyNet).map(([c, amt]) => (
                      <span key={c} className={`badge ${amt <= 0 ? "info" : "ok"}`} style={{ marginRight: 6 }}>
                        {amt <= 0 ? `Sent out ${c} ${Math.abs(amt).toFixed(2)} net` : `Received back ${c} ${amt.toFixed(2)} net`}
                      </span>
                    ))
                  : <span className="muted">Nothing yet</span>}
              </>
            )}
          </div>

          {roleFilter === "Vendor" && vendorOrders.length > 0 && (
            <>
              <h3 style={{ marginBottom: 12 }}>Orders</h3>
              <table style={{ marginBottom: 24 }}>
                <thead><tr><th>Date</th><th>Invoice</th><th>Total</th><th>Paid</th><th>Due</th><th></th></tr></thead>
                <tbody>
                  {vendorOrders.map((o) => (
                    <tr key={o.id}>
                      <td>{o.date}</td>
                      <td>{o.invoiceRef || o.id}</td>
                      <td>{o.currency} {o.total.toFixed(2)}</td>
                      <td>{o.currency} {o.paid.toFixed(2)}</td>
                      <td><span className={`badge ${o.due <= 0 ? "ok" : "hold"}`}>{o.currency} {o.due.toFixed(2)}</span></td>
                      <td><Link href={`/orders/${o.id}`} className="muted">Open →</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h3 style={{ marginBottom: 12 }}>Transactions</h3>
          {events.length === 0 ? (
            <p className="muted">No transactions yet.</p>
          ) : roleFilter === "Agent" ? (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>What</th>
                  <th>Rate</th>
                  <th>INR</th>
                  <th>Credited (RMB)</th>
                  <th>Debited (RMB)</th>
                  <th>Balance (RMB)</th>
                  <th>Note</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i}>
                    <td>{e.date}</td>
                    <td>{e.label}</td>
                    <td className="muted">{e.rate != null ? e.rate.toFixed(2) : "—"}</td>
                    <td className={e.inrAmount == null ? "muted" : e.inrAmount >= 0 ? "" : "error-text"}>
                      {e.inrAmount != null
                        ? `${e.inrAmount < 0 ? "-" : "+"}₹${Math.abs(e.inrAmount).toFixed(2)}`
                        : "—"}
                    </td>
                    <td className={e.rmbAmount != null && e.rmbAmount > 0 ? "" : "muted"}>
                      {e.rmbAmount != null && e.rmbAmount > 0 ? `+¥${e.rmbAmount.toFixed(2)}` : e.rmbAmount == null ? "no rate" : "—"}
                    </td>
                    <td className={e.rmbAmount != null && e.rmbAmount < 0 ? "error-text" : "muted"}>
                      {e.rmbAmount != null && e.rmbAmount < 0 ? `-¥${Math.abs(e.rmbAmount).toFixed(2)}` : "—"}
                    </td>
                    <td>
                      {e.balanceRmb != null ? (
                        <span className={`badge ${e.balanceRmb > 0.001 ? "hold" : e.balanceRmb < -0.001 ? "err" : "ok"}`} style={{ textDecoration: "none" }}>
                          {e.balanceRmb < 0 ? "-" : ""}¥{Math.abs(e.balanceRmb).toFixed(2)}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="muted">{e.note || "—"}{proofById.get(e.id) && <> <a href={proofById.get(e.id)} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "underline" }}>proof</a></>}</td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        {e.editHref && (
                          <Link
                            href={e.editHref}
                            className="icon-btn edit-btn"
                            title="Edit transaction"
                            aria-label="Edit transaction"
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </Link>
                        )}
                        {e.id && (
                          <button
                            type="button"
                            className="icon-btn delete-btn"
                            title="Void transaction (stays visible, struck-through)"
                            aria-label="Void transaction"
                            disabled={deletingId === e.id}
                            onClick={() => handleDeleteTransaction(e)}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              <line x1="10" y1="11" x2="10" y2="17" />
                              <line x1="14" y1="11" x2="14" y2="17" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : roleFilter === "Vendor" ? (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>What</th>
                  <th>Credited</th>
                  <th>Debited</th>
                  <th>Total Balance</th>
                  <th>Note</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i}>
                    <td>{e.date}</td>
                    <td>{e.label}</td>
                    <td>
                      {e.credited != null && e.credited > 0 ? (
                        <span style={{ color: "#166534", fontWeight: 600 }}>
                          +{e.currency} {e.credited.toFixed(2)}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {e.debited != null && e.debited > 0 ? (
                        <span className="error-text" style={{ fontWeight: 600 }}>
                          -{e.currency} {e.debited.toFixed(2)}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {e.runningBalance != null ? (
                        <span
                          className={`badge ${
                            e.runningBalance > 0.001
                              ? "hold"
                              : e.runningBalance < -0.001
                              ? "err"
                              : "ok"
                          }`}
                          style={{ fontWeight: 600 }}
                        >
                          {e.currency} {e.runningBalance.toFixed(2)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="muted">{e.note || "—"}{proofById.get(e.id) && <> <a href={proofById.get(e.id)} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "underline" }}>proof</a></>}</td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        {e.editHref && (
                          <Link
                            href={e.editHref}
                            className="icon-btn edit-btn"
                            title="Edit transaction"
                            aria-label="Edit transaction"
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </Link>
                        )}
                        {e.id && (
                          <button
                            type="button"
                            className="icon-btn delete-btn"
                            title="Void transaction (stays visible, struck-through)"
                            aria-label="Void transaction"
                            disabled={deletingId === e.id}
                            onClick={() => handleDeleteTransaction(e)}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              <line x1="10" y1="11" x2="10" y2="17" />
                              <line x1="14" y1="11" x2="14" y2="17" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>What</th>
                  <th>Amount</th>
                  <th>Note</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i}>
                    <td>{e.date}</td>
                    <td>{e.label}</td>
                    <td className={e.amount >= 0 ? "" : "error-text"}>{e.amount >= 0 ? "+" : ""}{e.currency} {e.amount.toFixed(2)}</td>
                    <td className="muted">{e.note || "—"}{proofById.get(e.id) && <> <a href={proofById.get(e.id)} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "underline" }}>proof</a></>}</td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        {e.editHref && (
                          <Link
                            href={e.editHref}
                            className="icon-btn edit-btn"
                            title="Edit transaction"
                            aria-label="Edit transaction"
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </Link>
                        )}
                        {e.id && (
                          <button
                            type="button"
                            className="icon-btn delete-btn"
                            title="Void transaction (stays visible, struck-through)"
                            aria-label="Void transaction"
                            disabled={deletingId === e.id}
                            onClick={() => handleDeleteTransaction(e)}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              <line x1="10" y1="11" x2="10" y2="17" />
                              <line x1="14" y1="11" x2="14" y2="17" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div>
          <h2 style={{ marginBottom: 12 }}>Vendors — currently held</h2>
          <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 32 }}>
            {vendors.map((v) => {
              const held = Object.entries(v.held).filter(([, amt]) => Math.abs(amt) > 0.01);
              return (
                <div key={v.id} className="card clickable" role="button" tabIndex={0} onClick={() => openLedger("Vendor", v.id)} onKeyDown={(e) => e.key === "Enter" && openLedger("Vendor", v.id)}>
                  <strong>{v.name}</strong>
                  <div style={{ marginTop: 8 }}>
                    {held.length
                      ? held.map(([c, amt]) => <div key={c} className={`badge ${amt > 0 ? "hold" : "err"}`} style={{ marginRight: 6 }}>{c} {amt.toFixed(2)}</div>)
                      : <span className="muted">Nothing held</span>}
                  </div>
                </div>
              );
            })}
          </div>

          <h2 style={{ marginBottom: 12 }}>Agents — running position</h2>
          <p className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
            Positive = agent still holds company funding. Negative = company owes the agent. Shown
            per currency, never netted — link a funding to a payout on the <strong>Agent FX</strong> page
            to settle them against each other.
          </p>
          <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 32 }}>
            {agents.map((a) => {
              const pos = Object.entries(a.position).filter(([, amt]) => Math.abs(amt) > 0.01);
              return (
                <div key={a.id} className="card clickable" role="button" tabIndex={0} onClick={() => openLedger("Agent", a.id)} onKeyDown={(e) => e.key === "Enter" && openLedger("Agent", a.id)}>
                  <strong>{a.name}</strong>
                  <div style={{ marginTop: 8 }}>
                    {pos.length
                      ? pos.map(([c, amt]) => (
                          <div key={c} className={`badge ${amt >= 0 ? "info" : "err"}`} style={{ marginRight: 6, marginBottom: 4 }}>
                            {amt >= 0 ? `Holds ${c} ${amt.toFixed(2)}` : `Company owes ${c} ${Math.abs(amt).toFixed(2)}`}
                          </div>
                        ))
                      : <span className="muted">Settled</span>}
                  </div>
                </div>
              );
            })}
          </div>

          <h2 style={{ marginBottom: 12 }}>Orders</h2>
          <table>
            <thead><tr><th>Date</th><th>Vendor</th><th>Invoice</th><th>Total</th><th>Paid</th><th>Due</th><th></th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>{o.date}</td>
                  <td>{vendors.find((v) => v.id === o.vendorId)?.name ?? o.vendorId}</td>
                  <td>{o.invoiceRef || o.id}</td>
                  <td>{o.currency} {o.total.toFixed(2)}</td>
                  <td>{o.currency} {o.paid.toFixed(2)}</td>
                  <td><span className={`badge ${o.due <= 0 ? "ok" : "hold"}`}>{o.currency} {o.due.toFixed(2)}</span></td>
                  <td><Link href={`/orders/${o.id}`} className="muted">Open →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
