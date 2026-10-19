# Docs — read before changing anything that touches money

**If you are an AI agent or a new teammate about to work on this codebase, start here —
before you write a line of code, and especially before you touch anything under `lib/`
or `app/api/`.**

This app tracks real money (vendor payments, agent cash flows, order balances) for
American Hairline. A change that *looks* locally correct can still silently corrupt a
balance somewhere else — this has already happened twice (see the incident log). The
docs in this folder exist so that doesn't happen a third time.

## Read in this order

1. **[`ARCHITECTURE.md`](ARCHITECTURE.md)** — the data model, the six non-negotiable
   rules, and where to look for each piece of logic. This is the one file you cannot
   skip.
2. **[`DECISIONS.md`](DECISIONS.md)** — *why* each rule exists, open questions for the
   business owner, and a dated incident log of real bugs that happened and how they were
   fixed. Add to this file whenever you make a non-obvious call or fix a real bug —
   don't just fix it silently.
3. **[`../README.md`](../README.md)** (project root) — local setup, npm scripts,
   deployment, screen-by-screen feature list.
4. **[`../TEST-CASES.md`](../TEST-CASES.md)** and **[`../TESTING.md`](../TESTING.md)** —
   worked examples with exact input values and expected numbers, safe to run against
   `TEST`-prefixed contacts without touching real data.
5. **[`../CONTEXT.md`](../CONTEXT.md)** / **[`../PRD.md`](../PRD.md)** — the original
   planning handoff. Useful for *intent and history*, but treat `ARCHITECTURE.md` and
   `DECISIONS.md` as more current — the code has moved past the original PRD in places
   (e.g. Credit Notes exist now, despite the PRD marking them out of scope; there is no
   direct Company→Vendor path anymore, despite the PRD describing one).

## The single most important rule

Every financial table (`Money_Movements`, `Applications`, `Transfers`,
`FX_Conversions`, `Credit_Notes`) is **append-only**. A correction is: void the old row
(`reversed: true` / `active: false` + a reason), then append a new, corrected row. Never
edit a financial row's values in place, and never truly delete one once it's been used
for real money. See `ARCHITECTURE.md` rule 1 for the full explanation and what to do
instead.

## Before you ship a money-math change

A green `npm run build` proves the TypeScript compiles. It proves nothing about whether
the numbers are right. Verify any change to balance logic against the live Sheet (or a
`TEST`-prefixed sandbox) with an actual before/after check, not just "it didn't crash."
