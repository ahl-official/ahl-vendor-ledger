"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Contact } from "@/lib/schema";
import { fetchJson } from "@/lib/fetchJson";
import { Loading } from "@/app/components/Loading";

type VendorLedger = Contact & { held: Record<string, number> };
type AgentLedger = Contact & { position: Record<string, number> };
type OrderRow = { id: string; vendorId: string; invoiceRef: string; date: string; currency: string; total: number; paid: number; due: number };

export default function LedgerPage() {
  const [vendors, setVendors] = useState<VendorLedger[]>([]);
  const [agents, setAgents] = useState<AgentLedger[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchJson<{ vendors: VendorLedger[]; agents: AgentLedger[]; orders: OrderRow[] }>("/api/ledger")
      .then((d) => { setVendors(d.vendors); setAgents(d.agents); setOrders(d.orders); })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, []);

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
  );
}
