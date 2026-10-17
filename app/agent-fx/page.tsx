"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Contact } from "@/lib/schema";
import { fetchJson } from "@/lib/fetchJson";

type Open = { movementId: string; date: string; currency: string; remaining: number; type?: string; payeeId?: string };
type AgentLedger = Contact & { position: Record<string, number> };

export default function AgentFxPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentLedger[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [agentId, setAgentId] = useState("");
  const [openFundings, setOpenFundings] = useState<Open[]>([]);
  const [openSpends, setOpenSpends] = useState<Open[]>([]);
  const [fundingMovementId, setFundingMovementId] = useState("");
  const [spendMovementId, setSpendMovementId] = useState("");
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetchJson<{ agents: AgentLedger[] }>("/api/ledger").then((d) => setAgents(d.agents)).catch((e) => setError(e.message));
    fetchJson<Contact[]>("/api/contacts").then(setContacts).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!agentId) { setOpenFundings([]); setOpenSpends([]); return; }
    fetchJson<{ openFundings: Open[]; openSpends: Open[] }>(`/api/fx-conversions?agentId=${agentId}`)
      .then((d) => { setOpenFundings(d.openFundings); setOpenSpends(d.openSpends); })
      .catch((e) => setError(e.message));
  }, [agentId]);

  const agent = agents.find((a) => a.id === agentId);
  const funding = openFundings.find((f) => f.movementId === fundingMovementId);
  const spend = openSpends.find((s) => s.movementId === spendMovementId);
  const contactName = (id?: string) => contacts.find((c) => c.id === id)?.name ?? id ?? "";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!funding || !spend) return setError("Choose both a funding and a spend");
    const from = Number(fromAmount);
    const to = Number(toAmount);
    if (!from || from <= 0 || !to || to <= 0) return setError("Both amounts must be greater than 0");
    setSaving(true);
    const res = await fetch("/api/fx-conversions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, fundingMovementId, spendMovementId, fromAmount: from, toAmount: to, note }),
    });
    setSaving(false);
    if (!res.ok) return setError((await res.json()).error ?? "Failed to save");
    setDone(true);
  };

  if (done) {
    return (
      <div className="card" style={{ maxWidth: 480 }}>
        <p className="badge ok" style={{ marginBottom: 12 }}>Saved</p>
        <p style={{ marginBottom: 16 }}>Conversion linked — the agent&apos;s position will reflect it on the Ledger.</p>
        <button onClick={() => router.push("/ledger")}>View ledger</button>{" "}
        <button className="secondary" onClick={() => {
          setDone(false); setFundingMovementId(""); setSpendMovementId(""); setFromAmount(""); setToAmount(""); setNote("");
          if (agentId) fetchJson<{ openFundings: Open[]; openSpends: Open[] }>(`/api/fx-conversions?agentId=${agentId}`)
            .then((d) => { setOpenFundings(d.openFundings); setOpenSpends(d.openSpends); });
        }}>Link another</button>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Agent FX Conversion</h1>
      <p className="muted" style={{ marginBottom: 24, maxWidth: 640 }}>
        Confirms that a specific INR (or other-currency) funding is what actually paid for a specific
        RMB (or other-currency) payout to a vendor. Nothing is calculated automatically — enter the real
        amounts the agent converted. Until you link them here, the agent&apos;s position shows both
        currencies separately on the Ledger.
      </p>

      <form onSubmit={submit} className="card grid" style={{ gap: 16, maxWidth: 640 }}>
        <div>
          <label>Agent</label>
          <select value={agentId} onChange={(e) => { setAgentId(e.target.value); setFundingMovementId(""); setSpendMovementId(""); }} required>
            <option value="">Select...</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        {agent && (
          <p className="muted" style={{ fontSize: 13 }}>
            Current position: {Object.entries(agent.position).filter(([, v]) => Math.abs(v) > 0.01)
              .map(([c, v]) => v >= 0 ? `Holds ${c} ${v.toFixed(2)}` : `Company owes ${c} ${Math.abs(v).toFixed(2)}`)
              .join(" · ") || "Settled"}
          </p>
        )}

        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label>Unconverted funding (Company → Agent)</label>
            <select value={fundingMovementId} onChange={(e) => {
              setFundingMovementId(e.target.value);
              const f = openFundings.find((x) => x.movementId === e.target.value);
              if (f) setFromAmount(String(f.remaining));
            }} required disabled={!agent}>
              <option value="">Select...</option>
              {openFundings.map((f) => (
                <option key={f.movementId} value={f.movementId}>{f.date} — {f.currency} {f.remaining.toFixed(2)} unconverted</option>
              ))}
            </select>
          </div>
          <div>
            <label>Unbacked spend (Agent → Vendor/Company)</label>
            <select value={spendMovementId} onChange={(e) => {
              setSpendMovementId(e.target.value);
              const s = openSpends.find((x) => x.movementId === e.target.value);
              if (s) setToAmount(String(s.remaining));
            }} required disabled={!agent}>
              <option value="">Select...</option>
              {openSpends.map((s) => (
                <option key={s.movementId} value={s.movementId}>
                  {s.date} — {s.currency} {s.remaining.toFixed(2)} unbacked{s.type === "AgentToVendor" ? ` (paid ${contactName(s.payeeId)})` : " (returned to company)"}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label>{funding ? `${funding.currency} consumed from this funding` : "From amount"} {funding && `(max ${funding.remaining.toFixed(2)})`}</label>
            <input type="number" value={fromAmount} onChange={(e) => setFromAmount(e.target.value)} required />
          </div>
          <div>
            <label>{spend ? `${spend.currency} this backs on the spend` : "To amount"} {spend && `(max ${spend.remaining.toFixed(2)})`}</label>
            <input type="number" value={toAmount} onChange={(e) => setToAmount(e.target.value)} required />
          </div>
        </div>

        {funding && spend && fromAmount && toAmount && (
          <p className="muted" style={{ fontSize: 13 }}>
            {funding.currency} {Number(fromAmount).toFixed(2)} converts to {spend.currency} {Number(toAmount).toFixed(2)}
            {" "}(implied rate {(Number(fromAmount) / Number(toAmount)).toFixed(4)} {funding.currency}/{spend.currency}).
            Funding left after: {funding.currency} {(funding.remaining - Number(fromAmount)).toFixed(2)}.
            Spend still unbacked after: {spend.currency} {(spend.remaining - Number(toAmount)).toFixed(2)}.
          </p>
        )}

        <div><label>Note</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. WeChat transfer screenshot ref" /></div>

        {error && <p className="error-text">{error}</p>}
        <button type="submit" disabled={saving} style={{ justifySelf: "start" }}>{saving ? "Saving..." : "Link conversion"}</button>
      </form>
    </div>
  );
}
