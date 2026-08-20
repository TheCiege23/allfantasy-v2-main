/**
 * PROMPT 151 — Startup: log provider config status (safe, no secrets).
 * Runs when Next.js server boots. Enable with experimental.instrumentationHook in next.config.js.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (
    process.env.DISABLE_INSTRUMENTATION_DURING_BUILD === "1" &&
    process.env.NODE_ENV === "production"
  ) {
    return;
  }

  // ── Required env validation (runs before any request is served) ────────────
  // Throws in production when DATABASE_URL / NEXTAUTH_SECRET / NEXTAUTH_URL are
  // missing or invalid.  In dev/test it only logs — never blocks startup.
  try {
    const { assertProductionEnv } = await import("./lib/env/validateProductionEnv");
    assertProductionEnv();
  } catch (err) {
    if (process.env.NODE_ENV === "production") {
      // Re-throw so the Next.js process exits with a clear diagnostic message
      // rather than silently serving requests with a broken configuration.
      throw err;
    }
    // Non-fatal in development — local env may legitimately omit prod vars.
    console.error(
      "[EnvValidation] Startup validation failed (non-fatal in dev):",
      err instanceof Error ? err.message : err
    );
  }

  try {
    const { logProviderStatus, logProviderStartupValidation } = await import("./lib/provider-config");
    logProviderStatus();
    logProviderStartupValidation();
  } catch {
    // Non-fatal; do not block startup
  }
  try {
    const { initSentryServer } = await import("./lib/error-tracking");
    initSentryServer();
  } catch {
    // Optional; do not block startup
  }
  // Decision OS parity telemetry -> durable storage.
  //
  // Without a registered sink, `emitDecisionTelemetry` falls through to console.log and the
  // evidence the flip gate needs goes to the log drain, where nothing can query it. The in-memory
  // debug store it reads instead is per-invocation and capped at 500 entries, so the gate could
  // never reach the >=50 comparisons it requires.
  //
  // Safe before the migration is applied: the sink's write is fire-and-forget with a swallowed
  // rejection, so a missing table changes nothing.
  try {
    const [{ registerDecisionTelemetrySink }, { createDurableParitySink }] = await Promise.all([
      import("./lib/decision-os/core/telemetry"),
      import("./lib/decision-os/core/parity/durableParityStore"),
    ]);
    registerDecisionTelemetrySink(createDurableParitySink());
  } catch {
    // Telemetry must never block startup.
  }

  // Do not import BullMQ workers here — webpack bundles instrumentation.ts and would pull
  // bullmq/ioredis (Node-only: path, child_process, …) into the build and fail.
  // Run workers via `scripts/start-worker.ts` or a dedicated Node process:
  //   START_INTEGRITY_WORKER_WITH_NEXT / START_AUTOCOACH_STATUS_WORKER_WITH_NEXT
  // are honored only when the worker entrypoint is used, not from Next instrumentation.
}
