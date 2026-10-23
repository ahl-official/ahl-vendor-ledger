"use client";
import { useEffect, useRef, useState } from "react";
import type { Contact, Role } from "@/lib/schema";
import { ROLES } from "@/lib/schema";
import { Loading } from "@/app/components/Loading";

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [roles, setRoles] = useState<Role[]>([]);
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const load = () =>
    fetch("/api/contacts")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load contacts");
        setContacts(data);
        setLoadError("");
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const toggleRole = (r: Role) =>
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  const resetForm = () => {
    setEditingId(null);
    setName(""); setRoles([]); setContact(""); setNotes(""); setError("");
  };

  const startEdit = (c: Contact) => {
    setEditingId(c.id);
    setName(c.name); setRoles(c.roles); setContact(c.contact); setNotes(c.notes);
    setError("");
  };

  // Scroll after the edit form has actually re-rendered, not before -- scrolling inside
  // startEdit() could fire while the page still showed "Add contact", landing short of
  // where the (now-taller, now-populated) edit form ended up.
  useEffect(() => {
    if (editingId) formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [editingId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    const res = await fetch(editingId ? `/api/contacts/${editingId}` : "/api/contacts", {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, roles, contact, notes }),
    });
    setSaving(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to save");
      return;
    }
    resetForm();
    load();
  };

  // Never deletes the contact or any row that references it -- every past transaction, order,
  // and balance stays exactly as it is. This only marks the contact inactive so it stops
  // appearing as a choice for new transactions; its full history stays visible in the Ledger.
  const deleteContact = async (c: Contact) => {
    if (!window.confirm(`Delete "${c.name}"?\n\nThis only hides them from future transactions. All of their past transactions, orders, and balances stay exactly as they are in the Ledger -- nothing is deleted or changed there. You can restore them later.`)) {
      return;
    }
    setBusyId(c.id);
    await fetch(`/api/contacts/${c.id}`, { method: "DELETE" });
    setBusyId(null);
    load();
  };

  const restoreContact = async (c: Contact) => {
    setBusyId(c.id);
    await fetch(`/api/contacts/${c.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: c.name, roles: c.roles, contact: c.contact, notes: c.notes, active: true }),
    });
    setBusyId(null);
    load();
  };

  return (
    <div>
      <h1 style={{ marginBottom: 24 }}>Contacts</h1>

      <form ref={formRef} onSubmit={submit} className="card" style={{ marginBottom: 24, display: "grid", gap: 12 }}>
        <h2>{editingId ? "Edit contact" : "Add contact"}</h2>
        <div>
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label>Roles</label>
          <div style={{ display: "flex", gap: 12 }}>
            {ROLES.map((r) => (
              <label key={r} style={{ display: "flex", alignItems: "center", gap: 4, textTransform: "none", fontSize: 14 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={roles.includes(r)} onChange={() => toggleRole(r)} />
                {r}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label>Contact / WeChat / Phone</label>
          <input value={contact} onChange={(e) => setContact(e.target.value)} />
        </div>
        <div>
          <label>Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>
        {error && <p className="error-text">{error}</p>}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" disabled={saving}>
            {saving ? "Saving..." : editingId ? "Save changes" : "Add contact"}
          </button>
          {editingId && (
            <button type="button" className="secondary" onClick={resetForm}>Cancel</button>
          )}
        </div>
      </form>

      {loading ? (
        <Loading label="Loading contacts" />
      ) : loadError ? (
        <p className="error-text">{loadError}</p>
      ) : (
        <>
        <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or role..."
            style={{ maxWidth: 320 }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 6, textTransform: "none", fontSize: 14 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show deleted
          </label>
        </div>
        <table>
          <thead>
            <tr><th>Name</th><th>Roles</th><th>Contact</th><th>Notes</th><th></th></tr>
          </thead>
          <tbody>
            {contacts
              .filter((c) => showInactive || c.active)
              .filter((c) => {
                const q = search.trim().toLowerCase();
                return !q || c.name.toLowerCase().includes(q) || c.roles.some((r) => r.toLowerCase().includes(q));
              })
              .map((c) => (
              <tr key={c.id} style={!c.active ? { opacity: 0.55 } : undefined}>
                <td>{c.name} {!c.active && <span className="badge" style={{ marginLeft: 6, fontSize: 11 }}>Deleted</span>}</td>
                <td>{c.roles.join(", ")}</td>
                <td>{c.contact || "—"}</td>
                <td className="muted">{c.notes || "—"}</td>
                <td style={{ textAlign: "right" }}>
                  {c.active ? (
                    <>
                      <button type="button" className="secondary" onClick={() => startEdit(c)}>Edit</button>{" "}
                      <button type="button" className="secondary" disabled={busyId === c.id} onClick={() => deleteContact(c)}>Delete</button>
                    </>
                  ) : (
                    <button type="button" className="secondary" disabled={busyId === c.id} onClick={() => restoreContact(c)}>Restore</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </>
      )}
    </div>
  );
}
