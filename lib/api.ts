import { NextResponse } from "next/server";

/** Wraps a route handler so a thrown error (e.g. Sheet not configured yet) becomes
 *  a clean JSON 500 instead of Next's HTML error page breaking client-side `.json()`. */
export function withErrors<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      console.error(err);
      return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
    }
  };
}
