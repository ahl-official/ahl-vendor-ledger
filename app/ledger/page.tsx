"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Contact, FxConversion, MoneyMovement, Application, Transfer, Role } from "@/lib/schema";
import { fetchJson } from "@/lib/fetchJson";
import { Loading } from "@/app/components/Loading";

type VendorLedger = Contact & { held: Record<string, number> };
type AgentLedger = Contact & { position: Record<string, number> };
type OrderRow = { id: string; vendorId: string; invoiceRef: string; date: string; currency: string; total: number; paid: number; due: number };
type LedgerResponse = {
  vendors: VendorLedger[]; agents: AgentLedger[]; orders: OrderRow[];
  movements: MoneyMovement[]; applications: Application[]; transfers: Transfer[]; fxConversions: FxConversion[];
};

const LOOKUP_ROLES: Role[] = ["Vendor", "Agent", "Company"];

type Event = {
  date: string; label: string; amount: number; currency: string; note: string;
  voided: boolean; editHref: string | null;
  rate?: number | null;
  inrAmount?: number | null;
  rmbAmount?: number | null;
  balanceRmb?: number | null;
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
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);

  const [roleFilter, setRoleFilter] = useState<Role | "">("");
  const [selectedId, setSelectedId] = useState("");

  useEffect(() => {
    Promise.all([
      fetchJson<LedgerResponse>("/api/ledger"),
      fetchJson<Contact[]>("/api/contacts"),
    ])
      .then(([d, c]) => {
        setVendors(d.vendors); setAgents(d.agents); setOrders(d.orders);
        setMovements(d.movements); setApplications(d.applications); setTransfers(d.transfers);
        setFxConversions(d.fxConversions);
        setContacts(c);
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
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

  const agentRmbBalance = (agentId: string) => {
    let bal = 0;
    for (const m of movements) {
      if (m.reversed) continue;
      const rate = m.quotedRate ?? m.actualRate;
      if (m.type === "CompanyToAgent" && m.payeeId === agentId) {
        if (m.currency === "RMB") bal += m.amount;
        else if (rate && rate > 0) bal += rate > 1 ? m.amount / rate : m.amount * rate;
        else {
          const conv = fxConversions.find((c) => c.fundingMovementId === m.id && !c.reversed);
          if (conv) bal += conv.toAmount;
        }
      } else if (m.type === "AgentToVendor" && m.payerId === agentId) {
        if (m.currency === "RMB") bal -= m.amount;
        else if (rate && rate > 0) bal -= rate > 1 ? m.amount / rate : m.amount * rate;
      } else if (m.type === "AgentToCompany" && m.payerId === agentId) {
        if (m.currency === "RMB") bal -= m.amount;
        else if (rate && rate > 0) bal -= rate > 1 ? m.amount / rate : m.amount * rate;
      }
    }
    return bal;
  };

  const events = useMemo<Event[]>(() => {
    if (!selectedId || !roleFilter) return [];
    const out: Event[] = [];

    if (roleFilter === "Vendor") {
      movements
        .filter((m) => m.type === "AgentToVendor" && m.payeeId === selectedId)
        .forEach((m) => {
          const company = companyBehind(m.payerId);
          out.push({
            date: m.date,
            label: `Received from ${nameOf(m.payerId)}${company ? ` (on behalf of ${company})` : ""}`,
            amount: m.amount, currency: m.currency, note: m.note,
            voided: m.reversed, editHref: m.reversed ? null : `/payments/new?editId=${m.id}`,
          });
        });
      transfers
        .filter((t) => t.purpose === "Transfer" && t.toContactId === selectedId)
        .forEach((t) => out.push({
          date: t.createdAt.slice(0, 10),
          label: `Received transfer from ${nameOf(t.fromVendorId)}${t.receivingOrderId ? " (paid an order)" : " (on account)"}`,
          amount: t.amount, currency: t.currency, note: t.note,
          voided: t.reversed, editHref: t.reversed ? null : `/vendor-balance?editId=${t.id}`,
        }));
      transfers
        .filter((t) => t.fromVendorId === selectedId)
        .forEach((t) => {
          const label = t.purpose === "Transfer" ? `Transferred to ${nameOf(t.toContactId)}`
            : t.purpose === "PaySupplier" ? `Paid supplier ${nameOf(t.toContactId)}`
            : t.toContactId ? `Refunded to ${nameOf(t.toContactId)}` : "Refunded out";
          out.push({
            date: t.createdAt.slice(0, 10), label, amount: -t.amount, currency: t.currency, note: t.note,
            voided: t.reversed, editHref: t.reversed ? null : `/vendor-balance?editId=${t.id}`,
          });
        });
      applications
        .filter((a) => movements.some((m) => m.id === a.movementId && m.payeeId === selectedId))
        .forEach((a) => {
          const order = orders.find((o) => o.id === a.orderId);
          out.push({
            date: a.createdAt.slice(0, 10), label: `Applied to order ${order?.invoiceRef || a.orderId}`,
            amount: -a.amount, currency: order?.currency ?? "", note: "",
            voided: !a.active, editHref: a.active ? `/vendor-balance?editId=${a.id}&kind=application` : null,
          });
        });
    } else if (roleFilter === "Agent") {
      movements
        .filter((m) => m.type === "CompanyToAgent" && m.payeeId === selectedId)
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
            date: m.date,
            label: `Received from Company`,
            amount: m.amount,
            currency: m.currency,
            note: m.note,
            voided: m.reversed,
            editHref: m.reversed ? null : `/payments/new?editId=${m.id}`,
            rate,
            inrAmount,
            rmbAmount,
          });
        });

      movements
        .filter((m) => m.type === "AgentToVendor" && m.payerId === selectedId)
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
            date: m.date,
            label: `Paid vendor ${nameOf(m.payeeId)}`,
            amount: -m.amount,
            currency: m.currency,
            note: m.note,
            voided: m.reversed,
            editHref: m.reversed ? null : `/payments/new?editId=${m.id}`,
            rate,
            inrAmount,
            rmbAmount,
          });
        });

      movements
        .filter((m) => m.type === "AgentToCompany" && m.payerId === selectedId)
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
            date: m.date,
            label: `Returned to Company`,
            amount: -m.amount,
            currency: m.currency,
            note: m.note,
            voided: m.reversed,
            editHref: m.reversed ? null : `/payments/new?editId=${m.id}`,
            rate,
            inrAmount,
            rmbAmount,
          });
        });

      // Calculate running balance in RMB chronologically
      out.sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));
      let runningRmb = 0;
      for (const e of out) {
        if (!e.voided && e.rmbAmount != null) {
          runningRmb += e.rmbAmount;
        }
        e.balanceRmb = runningRmb;
      }
    } else if (roleFilter === "Company") {
      movements
        .filter((m) => m.type === "CompanyToAgent" && m.payerId === selectedId)
        .forEach((m) => out.push({
          date: m.date, label: `Sent to agent ${nameOf(m.payeeId)}`, amount: -m.amount, currency: m.currency, note: m.note,
          voided: m.reversed, editHref: m.reversed ? null : `/payments/new?editId=${m.id}`,
        }));
      movements
        .filter((m) => m.type === "AgentToCompany" && m.payeeId === selectedId)
        .forEach((m) => out.push({
          date: m.date, label: `Received from agent ${nameOf(m.payerId)}`, amount: m.amount, currency: m.currency, note: m.note,
          voided: m.reversed, editHref: m.reversed ? null : `/payments/new?editId=${m.id}`,
        }));
      transfers
        .filter((t) => t.purpose === "Refund" && t.toContactId === selectedId)
        .forEach((t) => out.push({
          date: t.createdAt.slice(0, 10), label: `Refund received from ${nameOf(t.fromVendorId)}`, amount: t.amount, currency: t.currency, note: t.note,
          voided: t.reversed, editHref: t.reversed ? null : `/vendor-balance?editId=${t.id}`,
        }));
    }
    return out.sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [selectedId, roleFilter, movements, transfers, applications, fxConversions, orders, contacts]);

  const vendorOrders = roleFilter === "Vendor" ? orders.filter((o) => o.vendorId === selectedId) : [];
  const vendorHeld = roleFilter === "Vendor" ? vendors.find((v) => v.id === selectedId)?.held : undefined;
  const agentPos = roleFilter === "Agent" ? agents.find((a) => a.id === selectedId)?.position : undefined;
  const companyNet = useMemo(() => {
    if (roleFilter !== "Company") return undefined;
    const byCurrency: Record<string, number> = {};
    events.filter((e) => !e.voided).forEach((e) => { byCurrency[e.currency] = (byCurrency[e.currency] ?? 0) + e.amount; });
    return byCurrency;
  }, [roleFilter, events]);

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
                  <th>Amount (INR)</th>
                  <th>Amount (RMB)</th>
                  <th>Balance (RMB)</th>
                  <th>Note</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i} style={e.voided ? { opacity: 0.5, textDecoration: "line-through" } : undefined}>
                    <td>{e.date}</td>
                    <td>
                      {e.label}
                      {e.voided && <span className="badge err" style={{ marginLeft: 8, textDecoration: "none" }}>Corrected</span>}
                    </td>
                    <td className="muted">{e.rate != null ? e.rate.toFixed(2) : "—"}</td>
                    <td className={e.inrAmount == null ? "muted" : e.inrAmount >= 0 ? "" : "error-text"}>
                      {e.inrAmount != null
                        ? `${e.inrAmount < 0 ? "-" : "+"}₹${Math.abs(e.inrAmount).toFixed(2)}`
                        : "—"}
                    </td>
                    <td className={e.rmbAmount == null ? "muted" : e.rmbAmount >= 0 ? "" : "error-text"}>
                      {e.rmbAmount != null
                        ? `${e.rmbAmount < 0 ? "-" : "+"}¥${Math.abs(e.rmbAmount).toFixed(2)}`
                        : "—"}
                    </td>
                    <td>
                      {e.balanceRmb != null ? (
                        <span className={`badge ${e.balanceRmb > 0.001 ? "hold" : e.balanceRmb < -0.001 ? "err" : "ok"}`} style={{ textDecoration: "none" }}>
                          {e.balanceRmb < 0 ? "-" : ""}¥{Math.abs(e.balanceRmb).toFixed(2)}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="muted">{e.note || "—"}</td>
                    <td>
                      {e.editHref && (
                        <Link href={e.editHref} className="muted" style={{ textDecoration: "none" }}>
                          Edit →
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table>
              <thead><tr><th>Date</th><th>What</th><th>Amount</th><th>Note</th><th></th></tr></thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i} style={e.voided ? { opacity: 0.5, textDecoration: "line-through" } : undefined}>
                    <td>{e.date}</td>
                    <td>{e.label}{e.voided && <span className="badge err" style={{ marginLeft: 8, textDecoration: "none" }}>Corrected</span>}</td>
                    <td className={e.amount >= 0 ? "" : "error-text"}>{e.amount >= 0 ? "+" : ""}{e.currency} {e.amount.toFixed(2)}</td>
                    <td className="muted">{e.note || "—"}</td>
                    <td>{e.editHref && <Link href={e.editHref} className="muted" style={{ textDecoration: "none" }}>Edit →</Link>}</td>
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
                <div key={v.id} className="card">
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
          <p className="muted" style={{ marginBottom: 12, fontSize: 13 }}>Current status reflecting the latest transaction.</p>
          <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 32 }}>
            {agents.map((a) => {
              const rmbBal = agentRmbBalance(a.id);
              return (
                <div key={a.id} className="card">
                  <strong>{a.name}</strong>
                  <div style={{ marginTop: 8 }}>
                    <div className={`badge ${rmbBal > 0.001 ? "hold" : rmbBal < -0.001 ? "err" : "ok"}`}>
                      {rmbBal > 0.001
                        ? `Agent holds: RMB ${rmbBal.toFixed(2)}`
                        : rmbBal < -0.001
                        ? `Company owes: RMB ${Math.abs(rmbBal).toFixed(2)}`
                        : "Settled (RMB 0.00)"}
                    </div>
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
