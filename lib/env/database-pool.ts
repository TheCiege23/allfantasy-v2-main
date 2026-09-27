/** Bound each Prisma Rust-engine process pool, including production replicas.
 * Explicit operator settings win; non-Postgres/Accelerate URLs are untouched.
 */
export function applyDatabasePoolGuardrails(rawUrl: string): string {
  if (!/^postgres(ql)?:\/\//i.test(rawUrl)) return rawUrl;
  try {
    const parsed = new URL(rawUrl);
    if (!parsed.searchParams.has("connection_limit")) {
      // More than one is needed by helpers that read outside a transaction.
      parsed.searchParams.set("connection_limit", "5");
    }
    if (!parsed.searchParams.has("pool_timeout")) {
      parsed.searchParams.set("pool_timeout", "30");
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}
