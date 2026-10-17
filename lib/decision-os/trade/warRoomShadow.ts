/**
 * Decision OS — one instrumentation call site for all five war rooms
 * (Slice 13). The war rooms are five parallel stacks with byte-identical
 * verdict rules over different value bases; giving them ONE shadow helper
 * keeps this from becoming a sixth thing that drifts.
 *
 * Never throws. Emits nothing unless DECISION_OS_TRADE_SHADOW_WARROOM is on.
 */
import { recordTradeSurfaceShadow, type TradeSurface } from './surfaceShadow'
import { warRoomSurfaceObservation } from './legacyParity'
import { warRoomLegacyVerdict } from './warRoomLegacyVerdict'

export type WarRoomFormat = 'redraft' | 'dynasty' | 'keeper' | 'bestball' | 'guillotine'

const FORMAT_TO_SURFACE: Record<WarRoomFormat, TradeSurface> = {
  redraft: 'warroom_redraft',
  dynasty: 'warroom_dynasty',
  keeper: 'warroom_keeper',
  bestball: 'warroom_bestball',
  guillotine: 'warroom_guillotine',
}

export function recordWarRoomTradeShadow(input: {
  format: WarRoomFormat
  leagueId: string
  userId?: string | null
  rosterId?: string | null
  outgoingCount?: number
  incomingCount?: number
  /** Guillotine and best ball can switch trades off; the legacy rule called that 'disabled'. */
  tradesEnabled?: boolean
  /**
   * The engine's INPUTS, not a verdict: the engines stopped computing one (2026-09-30), and the retired
   * rule is derived here, inside Decision OS, for this telemetry only (warRoomLegacyVerdict.ts).
   */
  analysis: {
    valueDelta?: number | null
    rosterFitDelta?: number | null
    keeperSurplusDelta?: number | null
  } | null
}): void {
  try {
    const verdict = input.analysis
      ? warRoomLegacyVerdict({
          valueDelta: input.analysis.valueDelta,
          rosterFitDelta: input.analysis.rosterFitDelta,
          keeperSurplusDelta: input.analysis.keeperSurplusDelta,
          tradesEnabled: input.tradesEnabled,
        })
      : null
    const observation = warRoomSurfaceObservation({
      verdict,
      valueDelta: input.analysis?.valueDelta,
      rosterFitDelta: input.analysis?.rosterFitDelta,
    })
    recordTradeSurfaceShadow({
      surface: FORMAT_TO_SURFACE[input.format],
      userId: input.userId ?? null,
      leagueId: input.leagueId,
      proposerRosterId: input.rosterId ?? null,
      assetsGive: input.outgoingCount,
      assetsGet: input.incomingCount,
      surfaceVerdict: verdict,
      surfaceValueDeltaPct: input.analysis?.valueDelta ?? null,
      // 'abstained' is a real, honest state in these engines
      // ('needs_more_data') — recorded distinctly so it is never mistaken for
      // agreement in the flip-readiness rollup.
      surfaceAnalysisMode: observation.abstained ? 'warroom_abstained' : 'warroom_composite_verdict',
    })
  } catch {
    // Instrumentation must never break a war-room response.
  }
}
