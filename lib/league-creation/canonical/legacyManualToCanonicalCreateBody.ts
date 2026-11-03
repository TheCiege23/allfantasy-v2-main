/**
 * Maps the legacy League Creation Wizard payload (POST /api/league/create, platform=manual)
 * into the canonical POST /api/leagues JSON shape for validateCreatePayload + executeCanonicalLeagueCreation.
 *
 * Keep aligned with lib/create-league-v2/submit.ts (submitCreateLeagueV2) concept / preset selection.
 */

import {
  isScoringPresetValidForContext,
  resolveScoringPresetId,
  type PresetCtx,
} from '@/lib/league-creation-preset/scoring-presets'
import type { LeagueTypeId } from '@/lib/league-creation-wizard/types'
import type { SupportedSport } from '@/lib/create-league-v2/state'
import { isFootballLike } from '@/lib/create-league-v2/state'
import { normalizeToSupportedSport, supportsIdpLeagueSport } from '@/lib/sport-scope'
import { normalizeBestBallSettings } from '@/lib/bestball/rules'

export type LegacyManualCanonicalBuildInput = {
  sport: string
  leagueName: string
  teamCount: number
  requestedLeagueType: string | undefined
  requestedDraftType: string | undefined
  scoringPresetIdInput: string | undefined
  soccerPipelineInput: 'mls' | 'euro' | undefined
  settingsWizard: Record<string, unknown> | undefined
  /** True when NFL IDP card / DYNASTY_IDP / explicit idp league type */
  isIdpRequested: boolean
  /**
   * Legacy wizard / Quick Create `scoring` field (e.g. PPR, HALF_PPR) when `scoringPresetId` is absent.
   * Mapped to stable preset ids (fb_full_ppr, …) before canonical validation.
   */
  legacyScoringLabel?: string | null
  /**
   * When true and the wizard type is ambiguous (`redraft`), prefer `dynasty` (Quick Create sometimes leaves type as redraft).
   */
  preferDynastyConcept?: boolean
}

function mapLegacyScoringLabelToPresetCandidate(
  sport: SupportedSport,
  raw: string | undefined | null,
  ctx: PresetCtx,
): string | null {
  if (raw == null) return null
  const trimmed = String(raw).trim()
  if (!trimmed) return null

  if (isScoringPresetValidForContext(trimmed, ctx)) {
    return trimmed
  }

  const norm = trimmed.toUpperCase().replace(/\s+/g, '_').replace(/-/g, '_')

  if (isFootballLike(sport) && !ctx.idpSelected) {
    if (sport === 'NCAAF') {
      const ncaafAlias: Record<string, string> = {
        PPR: 'ncaaf_ppr',
        FULL_PPR: 'ncaaf_ppr',
        FULL: 'ncaaf_ppr',
        HALF_PPR: 'ncaaf_half_ppr',
        HALF: 'ncaaf_half_ppr',
        STANDARD: 'ncaaf_standard',
        NON_PPR: 'ncaaf_standard',
        STD: 'ncaaf_standard',
        NONPPR: 'ncaaf_standard',
      }
      const mapped = ncaafAlias[norm]
      if (mapped && isScoringPresetValidForContext(mapped, ctx)) return mapped
    }
    const footballAlias: Record<string, string> = {
      PPR: 'fb_full_ppr',
      FULL_PPR: 'fb_full_ppr',
      FULL: 'fb_full_ppr',
      HALF_PPR: 'fb_half_ppr',
      HALF: 'fb_half_ppr',
      STANDARD: 'fb_standard',
      NON_PPR: 'fb_standard',
      STD: 'fb_standard',
      NONPPR: 'fb_standard',
    }
    const mapped = footballAlias[norm]
    if (mapped && isScoringPresetValidForContext(mapped, ctx)) return mapped
  }

  const pointsBySport: Partial<Record<SupportedSport, string>> = {
    NBA: 'nba_points',
    NCAAB: 'ncaab_points',
    MLB: 'mlb_points',
    NHL: 'nhl_points',
    SOCCER: 'soc_points',
  }
  if ((norm === 'POINTS' || norm === 'DEFAULT' || norm === 'CLASSIC') && pointsBySport[sport]) {
    const id = pointsBySport[sport]!
    if (isScoringPresetValidForContext(id, ctx)) return id
  }

  return null
}

/**
 * Returns a plain object suitable for validateCreatePayload (stripForbiddenCreateLeagueFields applied by caller).
 */
export function buildLegacyManualCanonicalCreatePayload(input: LegacyManualCanonicalBuildInput): Record<string, unknown> {
  const sport = normalizeToSupportedSport(input.sport)
  const ltRaw = (input.requestedLeagueType ?? 'redraft').toLowerCase()

  let concept: string
  if (ltRaw === 'dynasty_idp') {
    concept = 'dynasty'
  } else if (ltRaw === 'idp') {
    concept = 'idp'
  } else if (input.isIdpRequested && supportsIdpLeagueSport(sport) && (ltRaw === 'redraft' || ltRaw === '')) {
    concept = 'idp'
  } else if (input.preferDynastyConcept === true && ltRaw === 'redraft') {
    concept = 'dynasty'
  } else {
    concept = input.requestedLeagueType ?? 'redraft'
  }

  const ctx: PresetCtx = {
    leagueType: (String(concept).toLowerCase() === 'dynasty'
      ? 'dynasty'
      : (input.requestedLeagueType ?? 'redraft')) as LeagueTypeId,
    sport: sport as SupportedSport,
    idpSelected: input.isIdpRequested,
  }
  const scoringPreset = resolveScoringPresetId(
    input.scoringPresetIdInput?.trim() ||
      mapLegacyScoringLabelToPresetCandidate(sport, input.legacyScoringLabel, ctx) ||
      '',
    ctx,
  )

  const draftType = input.requestedDraftType ?? 'snake'

  const sw = input.settingsWizard ?? {}
  const tz =
    typeof sw.league_timezone === 'string' && String(sw.league_timezone).trim().length > 0
      ? String(sw.league_timezone).trim()
      : 'America/New_York'

  const conceptSetup: Record<string, unknown> = {}
  if (ltRaw === 'pirate') {
    conceptSetup.pirate = {
      protectionLimit: Math.max(1, Math.min(10, Math.floor(Number(sw.pirate_protection_limit) || 3))),
      claimHours: Math.max(1, Math.min(72, Math.floor(Number(sw.pirate_claim_hours) || 24))),
      playoffClaims: sw.pirate_playoff_claims === true,
    }
  }
  if (ltRaw === 'survivor') {
    if (sw.survivorTribeSlots !== undefined) conceptSetup.survivorTribeSlots = sw.survivorTribeSlots
    const tribe = sw.survivor_suggested_tribe_count
    if (typeof tribe === 'number' && Number.isFinite(tribe)) {
      conceptSetup.survivorTribeCount = Math.max(2, Math.min(4, Math.round(tribe)))
    }
  }
  if (ltRaw === 'best_ball') {
    const rawBestBall =
      sw.best_ball_settings && typeof sw.best_ball_settings === 'object' && !Array.isArray(sw.best_ball_settings)
        ? (sw.best_ball_settings as Record<string, unknown>)
        : sw.bestBall && typeof sw.bestBall === 'object' && !Array.isArray(sw.bestBall)
          ? (sw.bestBall as Record<string, unknown>)
          : null
    const normalizedBestBall = normalizeBestBallSettings({
      sport,
      conceptSetup: rawBestBall ? { bestBall: rawBestBall } : null,
      draftType,
      timezone: tz,
      language: sw.language === 'es' || sw.language === 'en' ? sw.language : null,
    })
    conceptSetup.bestBall = normalizedBestBall
  }

  const tradeReviewRaw = sw.trade_review_mode
  const tradeReviewMode =
    tradeReviewRaw === 'league_vote' || tradeReviewRaw === 'instant' || tradeReviewRaw === 'none'
      ? tradeReviewRaw
      : 'commissioner'

  const out: Record<string, unknown> = {
    concept: String(concept).toLowerCase(),
    sport,
    scoringPreset,
    teamCount: input.teamCount,
    draftType,
    leagueName: input.leagueName.trim(),
    timezone: tz,
    tradeReviewMode,
  }

  if (Object.keys(conceptSetup).length > 0) {
    out.conceptSetup = conceptSetup
  }

  if (sport === 'SOCCER') {
    out.soccerPipeline = input.soccerPipelineInput ?? 'euro'
  }

  const lang = sw.language
  if (lang === 'es' || lang === 'en') {
    out.language = lang
  }

  return out
}
