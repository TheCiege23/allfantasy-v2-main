/**
 * Phase 22 — ReplayInsightContextProvider (Chimmy Historical Replay Context).
 *
 * Retrieves the user-safe `ManagerReplayInsightSetV1` for the active league and
 * hands it to the prompt layer as a `ReplayInsightSlice`. This is a CONTEXT
 * INTEGRATION provider — it consumes the existing replay resolver/formatter
 * (never modifies them) and produces OBSERVATIONAL context only. It changes no
 * replay infrastructure and no recommendation logic.
 *
 * Data path (A1, server-side, DB-first — mirrors the dashboard route): it calls
 * the read-only `createLiveReplayInsightDataProvider().getReplayCorrelationSummary()`
 * (two findMany, zero writes) then `buildManagerReplayInsights(..., {scope:'league'})`,
 * and stores ONLY the resulting user-safe insight set — never the internal
 * correlation summary. So no raw replay/roster/player IDs and no internal
 * correlation objects can reach the slice, structurally.
 *
 * Gated by `CHIMMY_REPLAY_CONTEXT_ENABLED=true` (default off → status 'disabled'
 * → no prompt section). Independent of the dashboard flag so Chimmy exposure can
 * be rolled out separately.
 */

import {
  buildManagerReplayInsights,
} from "@/lib/replay-framework/insights/managerReplayInsight"
import { createLiveReplayInsightDataProvider } from "@/lib/decision-os/replay-insights/replayInsightResolver"
import type {
  ChimmyContextProvider,
  ChimmyContextRequest,
  ProviderResult,
  ReplayInsightSlice,
} from "@/lib/chimmy-context/types"

export class ReplayInsightContextProvider
  implements ChimmyContextProvider<ReplayInsightSlice>
{
  readonly name = "replayInsights"
  readonly defaultTtlMs = 30 * 60 * 1000

  async load(
    request: ChimmyContextRequest
  ): Promise<ProviderResult<ReplayInsightSlice>> {
    const startedAt = Date.now()
    const fetchedAt = new Date().toISOString()

    const done = (data: ReplayInsightSlice): ProviderResult<ReplayInsightSlice> => ({
      ok: true,
      data,
      fetchedAt,
      durationMs: Date.now() - startedAt,
    })

    // Feature gate (default off) + no-league guard → no section at all.
    if (process.env.CHIMMY_REPLAY_CONTEXT_ENABLED !== "true" || !request.leagueId) {
      return done({ status: "disabled", insightSet: null })
    }

    try {
      const summary = await createLiveReplayInsightDataProvider().getReplayCorrelationSummary(
        request.leagueId
      )
      if (!summary) {
        return done({ status: "empty", insightSet: null })
      }
      const insightSet = buildManagerReplayInsights(summary, { scope: "league", now: new Date() })
      if (insightSet.insights.length === 0) {
        return done({ status: "empty", insightSet })
      }
      return done({ status: "ready", insightSet })
    } catch (err) {
      return {
        ok: false,
        data: null,
        error: err instanceof Error ? err.message : "Unknown replay insight error",
        fetchedAt,
        durationMs: Date.now() - startedAt,
      }
    }
  }
}
