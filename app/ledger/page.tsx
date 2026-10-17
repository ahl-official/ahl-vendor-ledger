"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Contact, MoneyMovement, Application, Transfer, Role } from "@/lib/schema";
import { fetchJson } from "@/lib/fetchJson";
import { Loading } from "@/app/components/Loading";

type VendorLedger = Contact & { held: Record<string, number> };
type AgentLedger = Contact & { position: Record<string, number> };
type OrderRow = { id: string; vendorId: string; invoiceRef: string; date: string; currency: string; total: number; paid: number; due: number };
type LedgerResponse = {
  vendors: VendorLedger[]; agents: AgentLedger[]; orders: OrderRow[];
  movements: MoneyMovement[]; applications: Application[]; transfers: Transfer[];
};

const LOOKUP_ROLES: Role[] = ["Vendor", "Agent", "Company"];

type Event = { date: string; label: string; amount: number; currency: string; note: string };

export default function LedgerPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [vendors, setVendors] = useState<VendorLedger[]>([]);
  const [agents, setAgents] = useState<AgentLedger[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [movements, setMovements] = useState<MoneyMovement[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
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
        setContacts(c);
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const nameOf = (id: string) => contacts.find((c) => c.id === id)?.name ?? id;

  // Whoever funded this agent at all -- in practice there's one Company, but this stays
  // correct even if a second one is ever added (just names the first funder found).
  const companyBehind = (agentId: string) => {
    const funding = movements.find((m) => !m.reversed && m.type === "CompanyToAgent" && m.payeeId === agentId);
    return funding ? nameOf(funding.payerId) : null;
  };

  const contactOptions = useMemo(
    () => (roleFilter ? contacts.filter((c) => c.roles.includes(roleFilter)) : []),
    [contacts, roleFilter]
  );
  const selected = contacts.find((c) => c.id === selectedId);

  const events = useMemo<Event[]>(() => {
    if (!selectedId || !roleFilter) return [];
    const out: Event[] = [];

    if (roleFilter === "Vendor") {
      movements
        .filter((m) => !m.reversed && m.type === "AgentToVendor" && m.payeeId === selectedId)
        .forEach((m) => {
          const company = companyBehind(m.payerId);
          out.push({
            date: m.date,
            label: `Received from ${nameOf(m.payerId)}${company ? ` (on behalf of ${company})` : ""}`,
            amount: m.amount, currency: m.currency, note: m.note,
          });
        });
      transfers
        .filter((t) => !t.reversed && t.purpose === "Transfer" && t.toContactId === selectedId)
        .forEach((t) => out.push({
          date: t.createdAt.slice(0, 10),
          label: `Received transfer from ${nameOf(t.fromVendorId)}${t.receivingOrderId ? " (paid an order)" : " (on account)"}`,
          amount: t.amount, currency: t.currency, note: t.note,
        }));
      transfers
        .filter((t) => !t.reversed && t.fromVendorId === selectedId)
        .forEach((t) => {
          const label = t.purpose === "Transfer" ? `Transferred to ${nameOf(t.toContactId)}`
            : t.purpose === "PaySupplier" ? `Paid supplier ${nameOf(t.toContactId)}`
            : t.toContactId ? `Refunded to ${nameOf(t.toContactId)}` : "Refunded out";
          out.push({ date: t.createdAt.slice(0, 10), label, amount: -t.amount, currency: t.currency, note: t.note });
        });
      applications
        .filter((a) => a.active && movements.some((m) => m.id === a.movementId && m.payeeId === selectedId))
        .forEach((a) => {
          const order = orders.find((o) => o.id === a.orderId);
          out.push({ date: a.createdAt.slice(0, 10), label: `Applied to order ${order?.invoiceRef || a.orderId}`, amount: -a.amount, currency: order?.currency ?? "", note: "" });
        });
    } else if (roleFilter === "Agent") {
      movements
        .filter((m) => !m.reversed && m.type === "CompanyToAgent" && m.payeeId === selectedId)
        .forEach((m) => out.push({ date: m.date, label: `Received from Company`, amount: m.amount, currency: m.currency, note: m.note }));
      movements
        .filter((m) => !m.reversed && m.type === "AgentToVendor" && m.payerId === selectedId)
        .forEach((m) => out.push({ date: m.date, label: `Paid vendor ${nameOf(m.payeeId)}`, amount: -m.amount, currency: m.currency, note: m.note }));
      movements
        .filter((m) => !m.reversed && m.type === "AgentToCompany" && m.payerId === selectedId)
        .forEach((m) => out.push({ date: m.date, label: `Returned to Company`, amount: -m.amount, currency: m.currency, note: m.note }));
    } else if (roleFilter === "Company") {
      movements
        .filter((m) => !m.reversed && m.type === "CompanyToAgent" && m.payerId === selectedId)
        .forEach((m) => out.push({ date: m.date, label: `Sent to agent ${nameOf(m.payeeId)}`, amount: -m.amount, currency: m.currency, note: m.note }));
      movements
        .filter((m) => !m.reversed && m.type === "AgentToCompany" && m.payeeId === selectedId)
        .forEach((m) => out.push({ date: m.date, label: `Received from agent ${nameOf(m.payerId)}`, amount: m.amount, currency: m.currency, note: m.note }));
      transfers
        .filter((t) => !t.reversed && t.purpose === "Refund" && t.toContactId === selectedId)
        .forEach((t) => out.push({ date: t.createdAt.slice(0, 10), label: `Refund received from ${nameOf(t.fromVendorId)}`, amount: t.amount, currency: t.currency, note: t.note }));
    }
    return out.sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [selectedId, roleFilter, movements, transfers, applications, orders, contacts]);

  const vendorOrders = roleFilter === "Vendor" ? orders.filter((o) => o.vendorId === selectedId) : [];
  const vendorHeld = roleFilter === "Vendor" ? vendors.find((v) => v.id === selectedId)?.held : undefined;
  const agentPos = roleFilter === "Agent" ? agents.find((a) => a.id === selectedId)?.position : undefined;
  const companyNet = useMemo(() => {
    if (roleFilter !== "Company") return undefined;
    const byCurrency: Record<string, number> = {};
    events.forEach((e) => { byCurrency[e.currency] = (byCurrency[e.currency] ?? 0) + e.amount; });
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
                {agentPos && Object.entries(agentPos).filter(([, amt]) => Math.abs(amt) > 0.01).length
                  ? Object.entries(agentPos).filter(([, amt]) => Math.abs(amt) > 0.01).map(([c, amt]) => (
                      <span key={c} className={`badge ${amt >= 0 ? "info" : "err"}`} style={{ marginRight: 6 }}>
                        {amt >= 0 ? `Holds ${c} ${amt.toFixed(2)}` : `Company owes ${c} ${Math.abs(amt).toFixed(2)}`}
                      </span>
                    ))
                  : <span className="muted">Settled</span>}
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
          ) : (
            <table>
              <thead><tr><th>Date</th><th>What</th><th>Amount</th><th>Note</th></tr></thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i}>
                    <td>{e.date}</td>
                    <td>{e.label}</td>
                    <td className={e.amount >= 0 ? "" : "error-text"}>{e.amount >= 0 ? "+" : ""}{e.currency} {e.amount.toFixed(2)}</td>
                    <td className="muted">{e.note || "—"}</td>
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
          <p className="muted" style={{ marginBottom: 12, fontSize: 13 }}>Positive = agent still holds company funding. Negative = company owes the agent.</p>
          <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 32 }}>
            {agents.map((a) => {
              const pos = Object.entries(a.position).filter(([, amt]) => Math.abs(amt) > 0.01);
              return (
                <div key={a.id} className="card">
                  <strong>{a.name}</strong>
                  <div style={{ marginTop: 8 }}>
                    {pos.length ? pos.map(([c, amt]) => (
                      <div key={c} className={`badge ${amt >= 0 ? "info" : "err"}`} style={{ marginRight: 6 }}>
                        {amt >= 0 ? `Holds ${c} ${amt.toFixed(2)}` : `Company owes ${c} ${Math.abs(amt).toFixed(2)}`}
                      </div>
                    )) : <span className="muted">Settled</span>}
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
