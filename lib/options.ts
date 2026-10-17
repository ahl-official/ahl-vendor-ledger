import { readRows, appendRow, newId } from "./sheets";
import { METHOD_DEFAULTS, REFERENCE_DEFAULTS, type OptionField } from "./schema";

const DEFAULTS: Record<OptionField, string[]> = {
  reference: REFERENCE_DEFAULTS,
  method: METHOD_DEFAULTS,
};

/** Every known value for both dropdowns: the built-in defaults plus whatever's been
 *  typed under "Other" so far, for everyone. */
export async function getOptionLists(): Promise<Record<OptionField, string[]>> {
  const rows = await readRows("Custom_Options");
  const out: Record<OptionField, string[]> = { reference: [...REFERENCE_DEFAULTS], method: [...METHOD_DEFAULTS] };
  for (const r of rows) {
    const field = r.field as OptionField;
    if (field in out && r.value && !out[field].includes(r.value)) out[field].push(r.value);
  }
  return out;
}

/** Remembers a free-typed value so it becomes a normal dropdown option from now on.
 *  No-op if it's blank or already known (default or previously remembered). */
export async function registerOptionIfNew(field: OptionField, value: string) {
  const trimmed = value.trim();
  if (!trimmed || DEFAULTS[field].includes(trimmed)) return;
  const rows = await readRows("Custom_Options");
  const alreadyKnown = rows.some((r) => r.field === field && r.value === trimmed);
  if (alreadyKnown) return;
  await appendRow("Custom_Options", { id: newId("OPT"), field, value: trimmed, createdAt: new Date().toISOString() });
}
