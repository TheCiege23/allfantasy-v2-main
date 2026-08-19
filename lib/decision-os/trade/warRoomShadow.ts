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
  analysis: {
    verdict?: string | null
    valueDelta?: number | null
    rosterFitDelta?: number | null
  } | null
}): void {
  try {
    const observation = warRoomSurfaceObservation({
      verdict: input.analysis?.verdict,
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
      surfaceVerdict: input.analysis?.verdict ?? null,
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
