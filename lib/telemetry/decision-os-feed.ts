import { logUsageEvent } from '@/lib/telemetry/usage'

/**
 * Durable counterpart to the `decision.os_feed` console line (`emitFeedOutcomes`,
 * `lib/decision-os/core/parity/telemetry.ts`).
 *
 * `decision.os_feed` is the only measurement of whether the domain-OS fact store
 * earns its keep (`served_store` staying 0 means the cache is overhead and the
 * backing table is not worth migrating), and until now it existed solely as a
 * console.log — visible in a log drain, unqueryable in production. This routes
 * the same counts through the SAME persistent path `recordLlmUsage` already
 * uses: one `ApiUsageEvent` row per emission (the counts live in `meta`, keyed
 * `kind: 'decision_os_feed'`), with the hour/day/week/month rollups
 * `logUsageEvent` maintains giving per-day emission counts for free. No new
 * table, no schema change.
 *
 * Same rules as `recordLlmUsage`: never throws, and never awaited by the
 * caller — telemetry must not be able to fail or slow the decision it
 * measures. A write lost to a frozen serverless instance is accepted, exactly
 * as `durableParityStore` documents for request paths.
 */
export function recordDecisionOsFeed(args: {
  /** Domain-OS slice this feed served: 'lineup' | 'waiver' | 'trade' | … */
  domain: string
  servedStore: number
  servedLive: number
  servedUnavailable: number
  /** Per-fact provenance, e.g. "injury:live,projection:store". */
  sources: string
}): void {
  try {
    void logUsageEvent({
      scope: 'api',
      tool: 'decision-os',
      endpoint: `decision.os_feed/${args.domain}`,
      ok: true,
      meta: {
        kind: 'decision_os_feed',
        domain: args.domain,
        servedStore: args.servedStore,
        servedLive: args.servedLive,
        servedUnavailable: args.servedUnavailable,
        sources: args.sources,
      },
    }).catch(() => {})
  } catch {
    // Telemetry must never break, delay, or fail the request it measures.
  }
}
