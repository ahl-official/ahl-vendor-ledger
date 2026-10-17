"use client";
import { useState } from "react";

/** Upload one PDF/image proof; reports the stored Drive link via onChange. */
export function ProofUpload({ label, url, onChange }: { label: string; url: string; onChange: (url: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setErr("");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      onChange(data.url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    }
    setBusy(false);
  };

  return (
    <div>
      <label>{label}</label>
      {url ? (
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <a href={url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "underline" }}>View uploaded file</a>
          <button type="button" className="secondary" onClick={() => onChange("")}>Remove</button>
        </div>
      ) : (
        <input type="file" accept="application/pdf,image/*" disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />
      )}
      {busy && <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Uploading...</p>}
      {err && <p className="error-text" style={{ fontSize: 12, marginTop: 4 }}>{err}</p>}
    </div>
  );
}
