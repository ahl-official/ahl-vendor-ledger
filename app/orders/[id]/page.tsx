"use client";
import { Suspense, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { OrderItem } from "@/lib/schema";
import { Loading } from "@/app/components/Loading";

type OrderDetail = {
  id: string; vendorName: string; invoiceRef: string; date: string; currency: string;
  shippingFee: number; adjustment: number; notes: string; items: OrderItem[];
  total: number; paid: number; due: number;
};

export default function OrderDetailPage() {
  return (
    <Suspense fallback={<Loading label="Loading order" />}>
      <OrderDetailContent />
    </Suspense>
  );
}

function OrderDetailContent() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/orders/${id}`).then(async (r) => {
      if (!r.ok) return setError((await r.json()).error ?? "Not found");
      setOrder(await r.json());
    });
  }, [id]);

  if (error) return <p className="error-text">{error}</p>;
  if (!order) return <Loading label="Loading order" />;

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>{order.vendorName}</h1>
      <p className="muted" style={{ marginBottom: 24 }}>{order.invoiceRef || "No invoice ref"} · {order.date}</p>

      <div className="card" style={{ marginBottom: 16 }}>
        <table>
          <thead><tr><th>Description</th><th>SKU</th><th>Qty</th><th>Unit</th><th>Unit price</th><th>Line total</th></tr></thead>
          <tbody>
            {order.items.map((i) => (
              <tr key={i.id}>
                <td>{i.description}</td><td>{i.sku || "—"}</td><td>{i.qty}</td><td>{i.unit || "—"}</td>
                <td>{i.unitPrice.toFixed(2)}</td><td>{i.lineTotal.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="card"><div className="field-label">Total</div><strong>{order.currency} {order.total.toFixed(2)}</strong></div>
        <div className="card"><div className="field-label">Paid</div><strong>{order.currency} {order.paid.toFixed(2)}</strong></div>
        <div className="card"><div className="field-label">Due</div><span className={`badge ${order.due <= 0 ? "ok" : "hold"}`}>{order.currency} {order.due.toFixed(2)}</span></div>
        <div className="card"><div className="field-label">Shipping / Adj.</div><strong>{order.shippingFee.toFixed(2)} / {order.adjustment.toFixed(2)}</strong></div>
      </div>

      {order.notes && <p className="muted" style={{ marginTop: 16 }}>{order.notes}</p>}
    </div>
  );
}
