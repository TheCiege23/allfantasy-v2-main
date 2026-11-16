/**
 * One scoring save for every points sport, used by each sport's scoring route and by shared scoring (2026-11-16).
 *
 * The seven `/api/commissioner/leagues/[leagueId]/<sport>-scoring` PUT handlers were the same code seven times:
 * commissioner check → settings lock → sport check → the category-format guard (NBA, MLB) → the season-phase gate
 * (mid-season confirmation) → the premium gate for custom tables → the save → the league log. Shared scoring applies
 * one league's scoring to many leagues, and it must go through exactly those rules for each league — a copy of them
 * would drift the first time one route changed. So the rules live here, and every caller (one league or many) uses
 * this function.
 *
 * It returns a result rather than a response: a route turns it into JSON, and the multi-league apply reports each
 * league's outcome side by side.
 */
import { prisma } from '@/lib/prisma'
import { settingsLockedResponse } from '@/lib/league/settingsLockGuard'
import { decideSettingsEdit, recordMidSeasonSettingsChange } from '@/lib/league/settingsLifecycleGate'
import { isOwnerOrLeagueCommissioner } from '@/lib/commissioner/leagueCommissionerAccount'
import { MID_SEASON_CONFIRMATION_CODE } from '@/lib/league/midSeasonConfirmation'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import { nativeCategoryScoringContext } from '@/lib/category-scoring/nativeCategoryScoringContext'
import { buildFullNflScoringConfig, getLeagueNflScoringConfig, saveLeagueNflScoringConfig, type NflScoringPresetKey } from '@/lib/nfl-scoring'
import { buildFullScoringConfig, getLeagueNbaScoringConfig, saveLeagueNbaScoringConfig, type NbaScoringPresetKey } from '@/lib/nba-scoring'
import { buildFullMlbScoringConfig, getLeagueMlbScoringConfig, saveLeagueMlbScoringConfig, type MlbScoringPresetKey } from '@/lib/mlb-scoring'
import { buildFullNhlScoringConfig, getLeagueNhlScoringConfig, saveLeagueNhlScoringConfig, type NhlScoringPresetKey } from '@/lib/nhl-scoring'
import { buildFullNcaabScoringConfig, getLeagueNcaabScoringConfig, saveLeagueNcaabScoringConfig, type NcaabScoringPresetKey } from '@/lib/ncaab-scoring'
import { buildFullNcaafScoringConfig, getLeagueNcaafScoringConfig, saveLeagueNcaafScoringConfig, type NcaafScoringPresetKey } from '@/lib/ncaaf-scoring'
import { buildFullSoccerScoringConfig, getLeagueSoccerScoringConfig, saveLeagueSoccerScoringConfig, type SoccerScoringPresetKey } from '@/lib/soccer-scoring'

export type PointsScoringSport = 'NFL' | 'NBA' | 'MLB' | 'NHL' | 'NCAAB' | 'NCAAF' | 'SOCCER'

type SavedScoring = { presetKey: string; rules: Record<string, number>; matchesPreset: boolean }
type SaveInput = { presetKey: string; rules: Record<string, number>; userId: string; premiumFeaturesUsed: boolean }

type SportAdapter = {
  label: string
  buildFull: (presetKey: string) => Record<string, number>
  get: (leagueId: string) => Promise<SavedScoring>
  save: (leagueId: string, input: SaveInput) => Promise<void>
  /** Why this league's format refuses a points table, or null. */
  formatRefusal?: (settings: unknown) => string | null
}

const CATEGORY_REFUSAL_NBA = 'This league uses categories; point weights do not apply.'
const CATEGORY_REFUSAL_MLB = 'This league uses category scoring; points presets cannot replace its format.'

/* The casts are to each sport's own preset-key type; a key the sport does not know is the same input the routes always took. */
const ADAPTERS: Record<PointsScoringSport, SportAdapter> = {
  NFL: {
    label: 'NFL',
    buildFull: (k) => buildFullNflScoringConfig(k as NflScoringPresetKey),
    get: getLeagueNflScoringConfig,
    save: (id, i) => saveLeagueNflScoringConfig(id, { ...i, presetKey: i.presetKey as NflScoringPresetKey }),
  },
  NBA: {
    label: 'NBA',
    buildFull: (k) => buildFullScoringConfig(k as NbaScoringPresetKey),
    get: getLeagueNbaScoringConfig,
    save: (id, i) => saveLeagueNbaScoringConfig(id, { ...i, presetKey: i.presetKey as NbaScoringPresetKey }),
    formatRefusal: (settings) => (nativeCategoryScoringContext(settings, 'NBA') ? CATEGORY_REFUSAL_NBA : null),
  },
  MLB: {
    label: 'MLB',
    buildFull: (k) => buildFullMlbScoringConfig(k as MlbScoringPresetKey),
    get: getLeagueMlbScoringConfig,
    save: (id, i) => saveLeagueMlbScoringConfig(id, { ...i, presetKey: i.presetKey as MlbScoringPresetKey }),
    formatRefusal: (settings) => {
      const mode = (settings as Record<string, unknown> | null)?.scoring_mode ?? 'points'
      return mode !== 'points' ? CATEGORY_REFUSAL_MLB : null
    },
  },
  NHL: {
    label: 'NHL',
    buildFull: (k) => buildFullNhlScoringConfig(k as NhlScoringPresetKey),
    get: getLeagueNhlScoringConfig,
    save: (id, i) => saveLeagueNhlScoringConfig(id, { ...i, presetKey: i.presetKey as NhlScoringPresetKey }),
  },
  NCAAB: {
    label: 'NCAAB',
    buildFull: (k) => buildFullNcaabScoringConfig(k as NcaabScoringPresetKey),
    get: getLeagueNcaabScoringConfig,
    save: (id, i) => saveLeagueNcaabScoringConfig(id, { ...i, presetKey: i.presetKey as NcaabScoringPresetKey }),
  },
  NCAAF: {
    label: 'NCAAF',
    buildFull: (k) => buildFullNcaafScoringConfig(k as NcaafScoringPresetKey),
    get: getLeagueNcaafScoringConfig,
    save: (id, i) => saveLeagueNcaafScoringConfig(id, { ...i, presetKey: i.presetKey as NcaafScoringPresetKey }),
  },
  SOCCER: {
    label: 'Soccer',
    buildFull: (k) => buildFullSoccerScoringConfig(k as SoccerScoringPresetKey),
    get: getLeagueSoccerScoringConfig,
    save: (id, i) => saveLeagueSoccerScoringConfig(id, { ...i, presetKey: i.presetKey as SoccerScoringPresetKey }),
  },
}

export function isPointsScoringSport(sport: unknown): sport is PointsScoringSport {
  return typeof sport === 'string' && sport in ADAPTERS
}

export function readLeagueSportScoring(sport: PointsScoringSport, leagueId: string): Promise<SavedScoring> {
  return ADAPTERS[sport].get(leagueId)
}

/** A custom table, or rules sent with the request, is the premium feature — the rule every scoring route applied. */
export function scoringNeedsPremium(presetKey: string, rules: Record<string, number> | undefined): boolean {
  return presetKey === 'custom' || Boolean(rules)
}

export async function userHasAdvancedScoring(userId: string): Promise<boolean> {
  try {
    return (await new FeatureGateService().evaluateUserFeatureAccess(userId, 'advanced_scoring')).allowed
  } catch {
    return false
  }
}

export type ScoringApplyOutcome =
  | 'saved'
  | 'not_found'
  | 'forbidden'
  | 'locked'
  | 'wrong_sport'
  | 'incompatible'
  | 'needs_confirmation'
  | 'refused'
  | 'premium_required'

export type ScoringApplyResult =
  | { ok: true; outcome: 'saved'; midSeason: boolean }
  | { ok: false; outcome: Exclude<ScoringApplyOutcome, 'saved'>; status: number; body: Record<string, unknown> }

export type ApplySportScoringInput = {
  leagueId: string
  userId: string
  /** The sport the caller expects; a league of another sport is refused, as each route always did. */
  sport: PointsScoringSport
  presetKey?: string
  rules?: Record<string, number>
  /** The request body, read only for the mid-season confirmation flag. */
  confirmationBody?: unknown
  /** The league-log source: `<sport>-scoring` from a route, `shared-scoring` from the multi-league apply. */
  source: string
  /** Extra league-log detail (shared scoring names the league it copied from). */
  detail?: Record<string, unknown>
  /** Premium already established for this user (the multi-league apply asks once, not per league). */
  premium?: boolean
}

export async function applySportScoringToLeague(input: ApplySportScoringInput): Promise<ScoringApplyResult> {
  const { leagueId, userId, sport } = input
  const adapter = ADAPTERS[sport]
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, sport: true, settings: true } })
  if (!league) return { ok: false, outcome: 'not_found', status: 404, body: { error: 'Not found' } }
  if (!(await isOwnerOrLeagueCommissioner(league, leagueId, userId))) {
    return { ok: false, outcome: 'forbidden', status: 403, body: { error: 'Commissioner only' } }
  }
  const locked = await settingsLockedResponse(leagueId, 'scoring')
  if (locked) {
    const body = (await locked.json().catch(() => ({ error: 'Scoring is locked.' }))) as Record<string, unknown>
    return { ok: false, outcome: 'locked', status: locked.status, body }
  }
  if (league.sport !== sport) return { ok: false, outcome: 'wrong_sport', status: 400, body: { error: `${adapter.label} leagues only` } }
  const formatRefusal = adapter.formatRefusal?.(league.settings) ?? null
  if (formatRefusal) return { ok: false, outcome: 'incompatible', status: 409, body: { error: formatRefusal } }

  const lifecycle = await decideSettingsEdit(leagueId, userId, 'scoring', input.confirmationBody ?? {})
  if (!lifecycle.ok) {
    const outcome = lifecycle.body.code === MID_SEASON_CONFIRMATION_CODE ? 'needs_confirmation' : 'refused'
    return { ok: false, outcome, status: lifecycle.status, body: lifecycle.body }
  }

  const presetKey = input.presetKey ?? 'af_default'
  if (scoringNeedsPremium(presetKey, input.rules)) {
    const premium = input.premium ?? (await userHasAdvancedScoring(userId))
    if (!premium) {
      return {
        ok: false,
        outcome: 'premium_required',
        status: 403,
        body: { error: 'premiumRequired', message: 'Custom scoring editing requires AF Commissioner Subscription.' },
      }
    }
  }

  await adapter.save(leagueId, {
    presetKey,
    rules: input.rules ?? adapter.buildFull(presetKey),
    userId,
    premiumFeaturesUsed: presetKey === 'custom',
  })
  await recordMidSeasonSettingsChange(lifecycle, {
    alwaysLog: true,
    leagueId,
    userId,
    section: 'scoring',
    source: input.source,
    detail: { presetKey, ...(input.detail ?? {}) },
  })
  return { ok: true, outcome: 'saved', midSeason: lifecycle.midSeason }
}
