/**
 * Draft room — map normalized draft pool rows to `PlayerEntry` + optional unified layers.
 * Pure functions only (no HTTP); safe for client + server.
 */

import type { NormalizedDraftEntry } from '@/lib/draft-sports-models/types'
import type { PlayerEntry } from '@/components/app/draft-room/PlayerPanel'
import { lookupAiAdpMatch, type AiAdpLookupMaps } from '@/lib/draft-room/ai-adp-lookup'
import { coalesceYearsExpFromNormalizedEntry } from '@/lib/draft-room/draftRoomRookieDiagnostics'
import {
  buildUnifiedPlayerProductView,
  type UnifiedPlayerAugment,
  type UnifiedPlayerProductView,
} from '@/lib/player-data/unifiedPlayerProductView'
import { buildPlayerFallbackDiagnostics } from '@/lib/player-data/providerFallbackDiagnostics'
import type { ProviderFallbackDiagnostics } from '@/lib/player-data/providerFallbackDiagnostics'
import type { RollingInsightsSoccerLeagueCode } from '@/lib/providers/rollingInsightsSoccerLeague'

export type MapDraftPoolPlayerOptions = {
  draftUISettings?: { aiAdpEnabled?: boolean } | null
  useAllFantasyAdp: boolean
  aiAdpLookupMaps: AiAdpLookupMaps
  /** Soccer competition hint from league settings — improves unified meta for SOCCER */
  soccerLeagueAugment?: RollingInsightsSoccerLeagueCode | null
  /** Builds `unified` headshot/stat/injury fallbacks for cards (default true). */
  includeUnifiedProduct?: boolean
  /** Dev / QA only — adds `providerFallbackDiagnostics` on the row. */
  includeProviderFallbackDiagnostics?: boolean
}

export type DraftRoomPlayerRow = PlayerEntry & {
  unifiedProductView?: UnifiedPlayerProductView
  providerFallbackDiagnostics?: ProviderFallbackDiagnostics
}

export function mapNormalizedDraftEntryToPlayerEntry(
  e: NormalizedDraftEntry,
  opts: MapDraftPoolPlayerOptions,
): DraftRoomPlayerRow {
  const name = e.name ?? e.display?.displayName ?? ''
  const position = e.position ?? e.display?.metadata?.position ?? ''
  const team = e.team ?? e.display?.metadata?.teamAbbreviation ?? null
  const ai =
    opts.draftUISettings?.aiAdpEnabled && !opts.useAllFantasyAdp
      ? lookupAiAdpMatch(opts.aiAdpLookupMaps, name, position, team)
      : null
  const yearsExp = coalesceYearsExpFromNormalizedEntry(e)
  const isRookieComputed = e.isRookie === true ? true : yearsExp === 0 ? true : undefined

  const augment: UnifiedPlayerAugment | undefined =
    opts.soccerLeagueAugment != null ? { soccerLeague: opts.soccerLeagueAugment } : undefined
  const unifiedProductView =
    opts.includeUnifiedProduct !== false
      ? buildUnifiedPlayerProductView(e, augment ? { augment } : undefined)
      : undefined

  const providerFallbackDiagnostics =
    opts.includeProviderFallbackDiagnostics && unifiedProductView
      ? buildPlayerFallbackDiagnostics(unifiedProductView, 'draft')
      : undefined

  const row: DraftRoomPlayerRow = {
    id: e.playerId ?? e.display?.playerId ?? name,
    playerId: e.playerId ?? e.display?.playerId ?? null,
    name,
    position,
    team,
    adp: e.adp ?? e.display?.stats?.adp ?? null,
    byeWeek: e.byeWeek ?? e.display?.metadata?.byeWeek ?? null,
    aiAdp: opts.useAllFantasyAdp
      ? (e.aiAdp ?? null)
      : opts.draftUISettings?.aiAdpEnabled && ai
        ? ai.adp
        : (e.aiAdp ?? null),
    aiAdpSampleSize: opts.useAllFantasyAdp ? e.aiAdpSampleSize : ai?.sampleSize,
    aiAdpLowSample: opts.useAllFantasyAdp ? e.aiAdpLowSample : ai?.lowSample,
    display: e.display ?? null,
    isDevy: e.isDevy,
    school: e.school ?? null,
    classYearLabel: e.classYearLabel ?? e.display?.metadata?.classYearLabel ?? null,
    draftGrade: e.draftGrade ?? e.display?.metadata?.draftGrade ?? null,
    projectedLandingSpot: e.projectedLandingSpot ?? e.display?.metadata?.projectedLandingSpot ?? null,
    graduatedToNFL: e.graduatedToNFL,
    poolType: e.poolType,
    nflDraftProjectionSplits: e.nflDraftProjectionSplits ?? null,
    yearsExp,
    isRookie: isRookieComputed,
    ...(unifiedProductView ? { unifiedProductView } : {}),
    ...(providerFallbackDiagnostics ? { providerFallbackDiagnostics } : {}),
  }

  return row
}
