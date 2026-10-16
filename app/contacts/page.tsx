"use client";
import { useEffect, useState } from "react";
import type { Contact, Role } from "@/lib/schema";
import { ROLES } from "@/lib/schema";
import { Loading } from "@/app/components/Loading";

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [roles, setRoles] = useState<Role[]>([]);
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);

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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, roles, contact, notes }),
    });
    setSaving(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to save");
      return;
    }
    setName(""); setRoles([]); setContact(""); setNotes("");
    load();
  };

  return (
    <div>
      <h1 style={{ marginBottom: 24 }}>Contacts</h1>

      <form onSubmit={submit} className="card" style={{ marginBottom: 24, display: "grid", gap: 12 }}>
        <h2>Add contact</h2>
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
        <button type="submit" disabled={saving}>{saving ? "Saving..." : "Add contact"}</button>
      </form>

      {loading ? (
        <Loading label="Loading contacts" />
      ) : loadError ? (
        <p className="error-text">{loadError}</p>
      ) : (
        <table>
          <thead>
            <tr><th>Name</th><th>Roles</th><th>Contact</th><th>Notes</th></tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.roles.join(", ")}</td>
                <td>{c.contact || "—"}</td>
                <td className="muted">{c.notes || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
