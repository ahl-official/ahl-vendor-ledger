// Client-side fetch helper: our API routes always return JSON, even on error
// (see lib/api.ts withErrors), so every caller should throw on !ok instead of
// blindly calling .then(setState) and crashing on an {error} object.
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request to ${url} failed`);
  return data as T;
}
