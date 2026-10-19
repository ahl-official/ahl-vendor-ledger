"use client";
import Link from "next/link";

export function LedgerNote({ text, proofUrl }: { text: string; proofUrl?: string }) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return <div className="ledger-note">
    {words.length > 3 ? <details>
      <summary>
        <span className="ledger-note-preview">{words.slice(0, 3).join(" ")}…</span>{" "}
        <span className="ledger-read-more">Read more</span><span className="ledger-read-less">Read less</span>
      </summary>
      <div className="ledger-note-full">{text}</div>
    </details> : <span>{text || "—"}</span>}
    {proofUrl && <> <a href={proofUrl} target="_blank" rel="noreferrer" className="ledger-proof">proof</a></>}
  </div>;
}

export function LedgerActions({ editHref, disabled, onVoid }: { editHref: string | null; disabled: boolean; onVoid: () => void }) {
  return <div className="ledger-actions">
    {editHref && <Link href={editHref} className="icon-btn edit-btn" title="Edit transaction" aria-label="Edit transaction">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    </Link>}
    <button type="button" className="icon-btn delete-btn" title="Void transaction" aria-label="Void transaction" disabled={disabled} onClick={onVoid}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
      </svg>
    </button>
  </div>;
}
