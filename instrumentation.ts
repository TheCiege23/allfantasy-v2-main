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
  // NOTE: a Decision OS parity telemetry sink was registered here and has been REMOVED.
  // It never took effect. Next.js bundles instrumentation.ts separately from route handlers,
  // so the module-level sink in core/telemetry.ts was set on THIS bundle's copy while routes
  // imported a different instance; module state does not cross bundles. Verified in
  // production: [ProviderConfig] proves register() runs on every cold start, yet the cron
  // route still took emitDecisionTelemetry's console.log fallback, which only happens when
  // sink is null.
  //
  // It was also harmful: emitDecisionTelemetry is `if (sink) sink(p) else console.log(p)`, so a
  // sink handling only parity silently deleted decision.issued / adopted / resolved /
  // live_enrichment from the production log drain.
  //
  // Parity is now persisted directly from core/parity/telemetry.ts, in the same module graph
  // as the emitters, with no registration to lose.

  // Do not import BullMQ workers here — webpack bundles instrumentation.ts and would pull
  // bullmq/ioredis (Node-only: path, child_process, …) into the build and fail.
  // Run workers via `scripts/start-worker.ts` or a dedicated Node process:
  //   START_INTEGRITY_WORKER_WITH_NEXT / START_AUTOCOACH_STATUS_WORKER_WITH_NEXT
  // are honored only when the worker entrypoint is used, not from Next instrumentation.
}
