"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { vendorAccount } from "@/lib/accounts";
import { convertByRate } from "@/lib/ledger";
import { agentStatement } from "@/lib/agent-statement";
import { LedgerActions, LedgerNote } from "@/app/components/LedgerCells";
import type { Contact, CreditNote, FxConversion, MoneyMovement, Application, Transfer, Role, Order } from "@/lib/schema";
import { fetchJson } from "@/lib/fetchJson";
import { Loading } from "@/app/components/Loading";

type VendorLedger = Contact & { held: Record<string, number> };
type AgentLedger = Contact & { position: Record<string, number> };
type OrderRow = Order & { total: number; paid: number; due: number };
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
  balances?: Record<string, number>;
  conversionIncluded?: boolean;
  groupIds?: string[];
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
  const [estTarget, setEstTarget] = useState("USD");
  const [estRate, setEstRate] = useState("");

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
    const nameOf = (id: string) => contacts.find(c => c.id === id)?.name ?? id;

    if (roleFilter === "Vendor") {
      const statement = vendorAccount(selectedId, { contacts, orders, orderItems: [], movements, applications, transfers, fxConversions, creditNotes });
      out.push(...statement.events.filter(e => !e.reversed).map(e => ({
        id: e.id, kind: e.kind, date: e.date, createdAt: e.createdAt, label: e.label,
        amount: e.credited - e.debited, currency: e.currency, note: e.note,
        editHref: e.kind === "movement" ? (movements.find(m => m.id === e.id)?.type === "OpeningBalance" ? null : `/payments/new?editId=${e.id}`) : e.kind === "credit_note" ? (creditNotes.find(c => c.id === e.id)?.orderId ? `/orders/${creditNotes.find(c => c.id === e.id)?.orderId}` : null) : `/vendor-balance?editId=${(e.groupIds?.length ? e.groupIds : [e.id]).join(",")}${e.kind === "application" ? "&kind=application" : ""}`,
        credited: e.credited, debited: e.debited, runningBalance: e.balance, groupIds: e.groupIds,
      })));
    } else if (roleFilter === "Agent") {
      out.push(...agentStatement(selectedId, { contacts, orders, orderItems: [], movements, applications, transfers, fxConversions, creditNotes }).map(row => ({ ...row, kind: "movement" as const, editHref: `/payments/new?editId=${row.id}` })));
    } else if (roleFilter === "Company") {
      movements
        .filter((m) => !m.reversed && (m.type === "CompanyToAgent" || m.type === "CompanyToVendor" || m.type === "LegacyCompanyToVendor") && m.payerId === selectedId)
        .forEach((m) =>
          out.push({
            id: m.id,
            kind: "movement",
            date: m.date,
            createdAt: m.createdAt || m.date,
            label: `Sent to ${nameOf(m.payeeId)}`,
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
    return out.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [selectedId, roleFilter, movements, transfers, applications, fxConversions, creditNotes, orders, contacts]);

  // "Currently held" should match the Transactions table once a vendor has a display
  // currency on -- built from the same (already-converted) events, not the raw real
  // per-currency balance, so entries without a saved rate still show up honestly as
  // whatever currency they stayed in instead of being silently dropped or merged in.
  const displayHeld = useMemo(() => {
    if (roleFilter !== "Vendor" || !selectedId) return null;
    const vendor = contacts.find((c) => c.id === selectedId);
    if (!vendor?.displayCurrency) return null;
    const byCurrency: Record<string, number> = {};
    for (const e of events) {
      if (!(e.currency in byCurrency) && e.runningBalance != null) byCurrency[e.currency] = e.runningBalance;
    }
    return byCurrency;
  }, [roleFilter, selectedId, contacts, events]);

  const openLedger = (role: Role, id: string) => {
    setRoleFilter(role);
    setSelectedId(id);
    window.scrollTo({ top: 0 });
  };

  // Opt-in, per vendor -- only entries that were themselves given a rate into this currency
  // convert (see lib/accounts.ts applyDisplayCurrency); nothing is ever guessed.
  const setVendorDisplayCurrency = async (id: string, value: string) => {
    const c = contacts.find((x) => x.id === id);
    if (!c) return;
    await fetch(`/api/contacts/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: c.name, roles: c.roles, contact: c.contact, notes: c.notes, displayCurrency: value }),
    });
    loadLedger();
  };

  const vendorOrders = roleFilter === "Vendor" ? orders.filter((o) => o.vendorId === selectedId) : [];
  const vendorHeld = roleFilter === "Vendor" ? vendors.find((v) => v.id === selectedId)?.held : undefined;
  // Reuse a rate already entered when the money was recorded, instead of asking for it again --
  // picks the most recent movement to this vendor that was itself given a conversion rate.
  useEffect(() => {
    const heldCurrency = vendorHeld && Object.entries(vendorHeld).find(([, amt]) => Math.abs(amt) > 0.001)?.[0];
    const withRate = heldCurrency
      ? movements
          .filter((m) => !m.reversed && m.payeeId === selectedId && m.currency === heldCurrency && m.rateCurrency && m.rateCurrency !== heldCurrency && (m.quotedRate || m.actualRate))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      : undefined;
    if (withRate) {
      setEstTarget(withRate.rateCurrency);
      setEstRate(String(withRate.quotedRate ?? withRate.actualRate));
    } else {
      setEstRate("");
    }
  }, [selectedId, vendorHeld, movements]);
  const estRateNum = Number(estRate);
  // Include any currency a funding was ever converted INTO (e.USD via rateCurrency), not just
  // currencies a movement is literally denominated in -- otherwise a USD conversion target
  // would have nowhere to show up, since no movement itself is "in" that currency.
  const extraAgentCurrencies = roleFilter === "Agent"
    ? [...new Set(events.flatMap(e => [e.currency, ...Object.keys(e.balances ?? {})]))].filter(c => c !== "INR" && c !== "RMB")
    : [];
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
    const ids = e.groupIds?.length ? e.groupIds : [e.id];
    if (!window.confirm(`Void this transaction "${e.label}"?\n\nThe original record${ids.length > 1 ? "s stay" : " stays"} in history. This removes ${ids.length > 1 ? "their" : "its"} effect from balances.`)) {
      return;
    }
    setDeletingId(e.id);
    setActionError("");
    try {
      const endpointFor = (id: string) =>
        e.kind === "movement"
          ? `/api/movements/${id}`
          : e.kind === "transfer"
          ? `/api/transfers/${id}`
          : e.kind === "credit_note"
          ? `/api/credit-notes/${id}`
          : `/api/applications/${id}`;
      // Sequential, not Promise.all: concurrent writes to the same sheet tab can race
      // and silently drop one (see docs/DECISIONS.md, 2026-10-17 incident).
      for (const id of ids) {
        const res = await fetch(endpointFor(id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "Voided from Ledger" }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Failed to void transaction");
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Ledger</h1>
        <a href={selectedId ? `/api/export?contactId=${selectedId}` : "/api/export"} className="btn secondary">
          Export Report (Excel){selectedId ? ` — ${selected?.name}` : ""}
        </a>
      </div>
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
                {(() => {
                  const shown = displayHeld ?? vendorHeld;
                  const rows = shown && Object.entries(shown).filter(([, amt]) => Math.abs(amt) > 0.01);
                  return rows && rows.length
                    ? rows.map(([c, amt]) => (
                        <span key={c} className={`badge ${amt > 0 ? "hold" : "err"}`} style={{ marginRight: 6 }}>{c} {amt.toFixed(2)}</span>
                      ))
                    : <span className="muted">Nothing held</span>;
                })()}
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
                  <span className="muted" style={{ fontSize: 13 }}>Show this vendor&apos;s history in</span>
                  <select
                    value={selected.displayCurrency || ""}
                    onChange={(e) => setVendorDisplayCurrency(selected.id, e.target.value)}
                    style={{ width: "auto" }}
                  >
                    <option value="">(as received)</option>
                    {["USD", "RMB", "INR"].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  Converts entries that were given a conversion rate into this currency when they were recorded. Entries with no saved rate stay in their own currency.
                </p>
                {!selected.displayCurrency && vendorHeld && Object.entries(vendorHeld).filter(([, amt]) => Math.abs(amt) > 0.01).length > 0 && (() => {
                  const [heldCurrency, heldAmt] = Object.entries(vendorHeld).filter(([, amt]) => Math.abs(amt) > 0.01)[0];
                  const targets = ["USD", "RMB", "INR"].filter((c) => c !== heldCurrency);
                  const rate = Number(estRate);
                  const estimate = rate > 0 ? convertByRate(heldAmt, rate, heldCurrency, estTarget) : null;
                  return (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
                      <span className="muted" style={{ fontSize: 13 }}>≈</span>
                      <select
                        value={targets.includes(estTarget) ? estTarget : targets[0]}
                        onChange={(e) => setEstTarget(e.target.value)}
                        style={{ width: "auto" }}
                      >
                        {targets.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <span className="muted" style={{ fontSize: 13 }}>at rate</span>
                      <input
                        type="number" step="any" placeholder={`${heldCurrency}→${estTarget} rate`}
                        value={estRate} onChange={(e) => setEstRate(e.target.value)}
                        style={{ width: 110 }}
                      />
                      {estimate != null && <span className="badge info">≈ {estTarget} {estimate.toFixed(2)}</span>}
                    </div>
                  );
                })()}
                {!selected.displayCurrency && (
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Quick estimate only — type today&apos;s rate to see the value in another currency. Nothing is saved.
                  </p>
                )}
              </>
            )}
            {roleFilter === "Agent" && <><p className="field-label">Running position</p>{Object.entries(agents.find(a => a.id === selectedId)?.position ?? {}).map(([cur, amount]) => <span key={cur} className={`badge agent-position ${Math.abs(amount) < 0.005 ? "ok" : amount > 0 ? "hold" : "err"}`}>{Math.abs(amount) < 0.005 ? `Settled (${cur} 0.00)` : amount > 0 ? `Agent holds: ${cur} ${amount.toFixed(2)}` : `Company owes: ${cur} ${(-amount).toFixed(2)}`}</span>)}</>}
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
                      <td>{o.totalKnown === false ? "Total unknown" : `${o.currency} ${o.total.toFixed(2)}`}</td>
                      <td>{o.currency} {o.paid.toFixed(2)}</td>
                      <td><span className={`badge ${o.totalKnown === false || o.due > 0 ? "hold" : "ok"}`}>{o.totalKnown === false ? "Needs confirmation" : `${o.currency} ${o.due.toFixed(2)}`}</span></td>
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
            <div className="ledger-table-scroll"><table className="agent-passbook">
              <thead><tr><th>Date</th><th>What</th><th>Rate</th><th>INR</th><th>Credited (RMB)</th><th>Debited (RMB)</th><th>Balance (RMB)</th>{extraAgentCurrencies.map(cur => <th key={cur}>{cur} / balance</th>)}<th>Note</th><th style={{ textAlign: "right" }}>Actions</th></tr></thead>
              <tbody>{events.map(e => <tr key={e.id}>
                <td>{e.date || "Unknown"}</td><td>{e.label}</td>
                <td className="muted">{e.rate != null ? e.rate.toFixed(2) : "—"}</td>
                <td className={e.inrAmount == null ? "muted" : e.inrAmount < 0 ? "error-text" : ""}>{e.inrAmount != null ? `${e.inrAmount < 0 ? "-" : "+"}₹${Math.abs(e.inrAmount).toFixed(2)}` : "—"}</td>
                <td className={e.rmbAmount != null && e.rmbAmount > 0 ? "ledger-credit" : "muted"} title={e.conversionIncluded ? "Includes a confirmed currency conversion" : undefined}>{e.rmbAmount != null && e.rmbAmount > 0 ? `+¥${e.rmbAmount.toFixed(2)}` : "—"}</td>
                <td className={e.rmbAmount != null && e.rmbAmount < 0 ? "error-text" : "muted"}>{e.rmbAmount != null && e.rmbAmount < 0 ? `-¥${Math.abs(e.rmbAmount).toFixed(2)}` : "—"}</td>
                <td><span className={`badge ${(e.balanceRmb ?? 0) < -0.001 ? "err" : "ok"}`}>{(e.balanceRmb ?? 0) < 0 ? "-" : ""}¥{Math.abs(e.balanceRmb ?? 0).toFixed(2)}</span></td>
                {extraAgentCurrencies.map(cur => <td key={cur}>{e.currency === cur ? `${e.amount < 0 ? "-" : "+"}${Math.abs(e.amount).toFixed(2)}` : "—"}<br /><span className="muted">{cur} {(e.balances?.[cur] ?? 0).toFixed(2)}</span></td>)}
                <td className="muted"><LedgerNote text={e.note} proofUrl={proofById.get(e.id)} /></td>
                <td style={{ textAlign: "right" }}><LedgerActions editHref={e.editHref} disabled={deletingId === e.id} onVoid={() => handleDeleteTransaction(e)} /></td>
              </tr>)}</tbody>
            </table></div>
          ) : roleFilter === "Vendor" ? (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>What</th>
                  <th>Credited</th>
                  <th>Debited</th>
                  <th>Total Balance</th>
                  <th>≈ {estTarget}</th>
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
                    <td className="muted">
                      {e.runningBalance != null && estRateNum > 0
                        ? `${estTarget} ${(e.currency === estTarget ? e.runningBalance : convertByRate(e.runningBalance, estRateNum, e.currency, estTarget)).toFixed(2)}`
                        : "—"}
                    </td>
                    <td className="muted"><LedgerNote text={e.note} proofUrl={proofById.get(e.id)} /></td>
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
                    <td className="muted"><LedgerNote text={e.note} proofUrl={proofById.get(e.id)} /></td>
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
              // Same conversion as the vendor's own page: only entries with a saved rate
              // convert, picking each currency's latest running balance from the already-
              // converted events (see displayHeld above / lib/accounts.ts applyDisplayCurrency).
              const shownHeld = v.displayCurrency
                ? (() => {
                    const byCurrency: Record<string, number> = {};
                    for (const e of vendorAccount(v.id, { contacts, orders, orderItems: [], movements, applications, transfers, fxConversions, creditNotes }).events) {
                      if (!e.reversed && !(e.currency in byCurrency)) byCurrency[e.currency] = e.balance;
                    }
                    return byCurrency;
                  })()
                : v.held;
              const held = Object.entries(shownHeld).filter(([, amt]) => Math.abs(amt) > 0.01);
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
                  <td>{o.totalKnown === false ? "Total unknown" : `${o.currency} ${o.total.toFixed(2)}`}</td>
                  <td>{o.currency} {o.paid.toFixed(2)}</td>
                  <td><span className={`badge ${o.totalKnown === false || o.due > 0 ? "hold" : "ok"}`}>{o.totalKnown === false ? "Needs confirmation" : `${o.currency} ${o.due.toFixed(2)}`}</span></td>
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
