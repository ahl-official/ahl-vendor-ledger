"use client";
import { useState } from "react";

/** Upload one or more PDFs/images; reports the stored Drive links (comma-joined) via onChange. */
export function ProofUpload({ label, url, onChange }: { label: string; url: string; onChange: (url: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const urls = url ? url.split(",").filter(Boolean) : [];

  const pick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErr("");
    setBusy(true);
    try {
      const uploaded: string[] = [];
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `Upload failed for ${file.name}`);
        uploaded.push(data.url);
      }
      onChange([...urls, ...uploaded].join(","));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    }
    setBusy(false);
  };

  const remove = (i: number) => onChange(urls.filter((_, idx) => idx !== i).join(","));

  return (
    <div>
      <label>{label}</label>
      {urls.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "4px 0" }}>
          {urls.map((u, i) => (
            <li key={u} style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 4 }}>
              <a href={u} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "underline" }}>
                File {i + 1}
              </a>
              <button type="button" className="secondary" onClick={() => remove(i)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <input type="file" accept="application/pdf,image/*" multiple disabled={busy} onChange={(e) => pick(e.target.files)} />
      {busy && <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Uploading...</p>}
      {err && <p className="error-text" style={{ fontSize: 12, marginTop: 4 }}>{err}</p>}
    </div>
  );
}
