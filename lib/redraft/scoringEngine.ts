import type { SportConfig } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getPlatformEvents, EVENT } from '@/lib/events'
import { calculateOfficialTeamScore, leagueUsesDevyEngine } from '@/lib/devy/scoringEligibilityEngine'
import { leagueUsesC2CEngine, updateC2CMatchupScores } from '@/lib/c2c/scoringEngine'
import {
  expandSportConfigToggles,
  getScoringCategories,
  resolveSportConfigKey,
  tryGetSportConfig,
} from '@/lib/sportConfig'
import type { ScoringCategory } from '@/lib/sportConfig/types'
import { bridgeUiRulesToEngineCategoryPoints } from '@/lib/nfl-scoring/scoringKeyBridge'
import { isNflRedraftScoringStarterSlot } from '@/lib/scoring-runtime'
import type { StatCategoryRow } from './types'
import { isSportsDataEnabled } from '@/lib/fantasy-os/sports-runtime/gates'
import { CertifiedScoringIntegrationService } from '@/lib/fantasy-os/sports-runtime/scoringIntegration'

export function calculateFantasyPoints(
  rawStats: Record<string, number>,
  statCategories: SportConfig['statCategories'],
  scoringOverrides?: Record<string, number>,
): number {
  const cats = statCategories as unknown as StatCategoryRow[]
  if (!Array.isArray(cats)) return 0
  let sum = 0
  for (const cat of cats) {
    const v = rawStats[cat.key] ?? 0
    const mult = scoringOverrides?.[cat.key] ?? cat.points
    sum += v * mult
  }
  return sum
}

function bonusBaseYardsKey(catKey: string): string | null {
  if (catKey.includes('pass_') && catKey.includes('bonus')) return 'pass_yds'
  if (catKey.includes('rush_') && catKey.includes('bonus')) return 'rush_yds'
  if (catKey.includes('rec_') && catKey.includes('bonus')) return 'rec_yds'
  return null
}

export function pointsForCategory(cat: ScoringCategory, rawStats: Record<string, number>): number {
  const pts = cat.defaultPoints
  if (cat.minForBonus != null) {
    const base = bonusBaseYardsKey(cat.key)
    if (!base) return 0
    const yards = rawStats[base] ?? 0
    return yards >= cat.minForBonus ? pts : 0
  }
  // Threshold-tier categories (team-defense points/yards allowed): award the
  // tier's points when the single tier stat falls within [tierMin, tierMax].
  // The stat must be present — a real 0 (shutout) is a valid tier value, so
  // distinguish "absent" from "0" via a key check rather than `?? 0`.
  if (cat.tierStatKey != null) {
    if (!(cat.tierStatKey in rawStats)) return 0
    const value = rawStats[cat.tierStatKey]
    if (!Number.isFinite(value)) return 0
    const min = cat.tierMin ?? Number.NEGATIVE_INFINITY
    const max = cat.tierMax ?? Number.POSITIVE_INFINITY
    return value >= min && value <= max ? pts : 0
  }
  const raw = rawStats[cat.key] ?? 0
  if (cat.unit === 'per_yard' || cat.unit === 'per_inning') {
    return raw * pts
  }
  return raw * pts
}

export function applyScoringPresetToRecPoints(
  categories: ScoringCategory[],
  preset: string,
  overrides: Record<string, number>,
): ScoringCategory[] {
  if (overrides.rec != null) return categories
  if (preset === 'CUSTOM') return categories
  const recPts =
    preset === 'PPR' ? 1 : preset === 'HALF_PPR' ? 0.5 : preset === 'STANDARD' ? 0 : null
  if (recPts === null) return categories
  return categories.map((c) => (c.key === 'rec' ? { ...c, defaultPoints: recPts } : c))
}

/**
 * Pure scorer: sum fantasy points for one player's raw weekly stats against a
 * resolved scoring-category list, honoring per-category commissioner overrides
 * and yardage-threshold bonuses. This is the authoritative scoring math; both
 * the live engine (`calculateScoreFromSportConfig`) and the contract tests run
 * through it so what we test is exactly what scores.
 */
export function scoreStatsWithCategories(
  categories: ScoringCategory[],
  rawStats: Record<string, number>,
  overrides: Record<string, number> = {},
): number {
  let sum = 0
  for (const cat of categories) {
    const mult = overrides[cat.key] ?? cat.defaultPoints
    sum += pointsForCategory({ ...cat, defaultPoints: mult }, rawStats)
  }
  return sum
}

/**
 * Slots that NEVER count toward a matchup score. Mirrors the non-starter set in
 * `lineupValidation` (BENCH/BN/IR/TAXI/DEVY/RESERVE) so scoring and lineup rules
 * agree: previously only bench/taxi/devy were excluded, which let an IR- or
 * reserve-slotted player's points leak into the starter total.
 */
/**
 * Scoring-side starter classification: only true starter slots count toward a
 * matchup score. Exported so the contract test can prove bench/IR/taxi/devy/
 * reserve players never contribute points.
 */
export function isScoringStarterSlot(slotType: string | null | undefined): boolean {
  return isNflRedraftScoringStarterSlot(slotType)
}

type SportConfigBlob = Record<string, unknown>

function readSportConfig(league: { settings: unknown }): SportConfigBlob {
  const s = league.settings as Record<string, unknown> | null | undefined
  const raw = s?.sportConfig
  return raw && typeof raw === 'object' && raw !== null ? (raw as SportConfigBlob) : {}
}

/**
 * Legacy fallback (R1): derive engine overrides from `settings.nfl_scoring_config`
 * (the UI store) when the canonical `sportConfig.categoryPoints` is absent — so
 * leagues last saved before the UI→engine bridge still score their commissioner
 * settings. Only fires when categoryPoints is empty.
 */
function bridgeLegacyNflScoringConfig(league: { settings: unknown }): Record<string, number> {
  const s = league.settings as Record<string, unknown> | null | undefined
  const legacy = s?.nfl_scoring_config as Record<string, unknown> | undefined
  const rules = legacy?.rules as Record<string, number> | undefined
  if (!rules || typeof rules !== 'object') return {}
  return bridgeUiRulesToEngineCategoryPoints(rules)
}

function togglesFromSportConfig(sc: SportConfigBlob): string[] {
  const t: string[] = []
  if (sc.enableIDP === true) t.push('IDP')
  if (sc.enableSuperflex === true) t.push('SUPERFLEX')
  if (sc.enableTEPremium === true) t.push('TE_PREMIUM')
  return t
}

/**
 * Config-driven fantasy points from raw weekly stats — uses SportConfig + league `settings.sportConfig` overrides.
 */
export async function calculateScoreFromSportConfig(
  leagueId: string,
  _playerId: string,
  _week: number,
  rawStats: Record<string, number>,
  position?: string | null,
): Promise<number> {
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { sport: true, settings: true },
  })
  if (!league) return 0

  const sport = resolveSportConfigKey(String(league.sport))
  const cfg = tryGetSportConfig(sport)
  if (!cfg) return calculateFantasyPoints(rawStats, [] as unknown as SportConfig['statCategories'], undefined)

  const sc = readSportConfig(league)
  const toggles = togglesFromSportConfig(sc)
  const expanded = expandSportConfigToggles(toggles)
  let categories = getScoringCategories(cfg.sport, expanded)
  const preset = String(sc.scoringPreset ?? 'PPR')
  // R1 precedence: the canonical engine store wins. For legacy leagues that only
  // have the UI store (`nfl_scoring_config`, written before the bridge existed),
  // derive engine overrides from it so their commissioner scoring is honored too.
  let overrides =
    typeof sc.categoryPoints === 'object' && sc.categoryPoints !== null
      ? (sc.categoryPoints as Record<string, number>)
      : {}
  if (Object.keys(overrides).length === 0) {
    overrides = bridgeLegacyNflScoringConfig(league)
  }
  categories = applyScoringPresetToRecPoints(categories, preset, overrides)

  const effectiveStats = applyTePremiumStat(categories, rawStats, position)
  return scoreStatsWithCategories(categories, effectiveStats, overrides)
}

/**
 * TE Premium fix: the `te_premium` category scores off a `te_premium` count, but
 * the NFL stat normalizer never emits that key — so the toggle was inert. Inject
 * it (= receptions) for TEs ONLY, and only when the te_premium category is active
 * (TE_PREMIUM enabled). Non-TEs and TEP-off leagues are unaffected, so this is
 * backward-compatible. Position is supplied by the roster row at every call site.
 */
export function applyTePremiumStat(
  categories: ScoringCategory[],
  rawStats: Record<string, number>,
  position?: string | null,
): Record<string, number> {
  const isTe = String(position ?? '').trim().toUpperCase() === 'TE'
  if (!isTe) return rawStats
  if (!categories.some((c) => c.key === 'te_premium')) return rawStats
  const receptions = rawStats.rec ?? rawStats.receptions ?? 0
  return { ...rawStats, te_premium: receptions }
}

export type RosterScoreSummary = {
  rosterId: string
  starterCount: number
  scoredStarterCount: number
  points: number
  missingPlayerIds: string[]
  allFinal: boolean
}

export type MatchupScoreUpdateSummary = {
  matchupId: string
  week: number
  homeScore: number
  awayScore: number
  isComplete: boolean
  missingPlayerIds: string[]
}

async function scoreRosterStarters(args: {
  leagueId: string
  rosterId: string
  week: number
  seasonYear: number
  useDevyEngine: boolean
}): Promise<RosterScoreSummary> {
  if (args.useDevyEngine) {
    const r = await calculateOfficialTeamScore(args.leagueId, args.rosterId, args.week, args.seasonYear)
    return {
      rosterId: args.rosterId,
      starterCount: 1,
      scoredStarterCount: 1,
      points: r.officialScore,
      missingPlayerIds: [],
      allFinal: true,
    }
  }

  const starters = await prisma.redraftRosterPlayer.findMany({
    where: {
      rosterId: args.rosterId,
      droppedAt: null,
    },
  })
  const activeStarters = starters.filter((p: (typeof starters)[number]) => isScoringStarterSlot(p.slotType))

  let pts = 0
  let scoredStarterCount = 0
  let allFinal = true
  const missingPlayerIds: string[] = []

  for (const p of activeStarters) {
    const row = await prisma.playerWeeklyScore.findUnique({
      where: {
        playerId_week_season_sport: {
          playerId: p.playerId,
          week: args.week,
          season: args.seasonYear,
          sport: p.sport,
        },
      },
    })
    if (!row) {
      missingPlayerIds.push(p.playerId)
      allFinal = false
      continue
    }
    pts += await calculateScoreFromSportConfig(
      args.leagueId,
      p.playerId,
      args.week,
      row.stats as Record<string, number>,
      p.position,
    )
    scoredStarterCount += 1
    if (!row.isFinalized) allFinal = false
  }

  return {
    rosterId: args.rosterId,
    starterCount: activeStarters.length,
    scoredStarterCount,
    points: Math.round(pts * 100) / 100,
    missingPlayerIds,
    allFinal,
  }
}

export async function updateMatchupScores(matchupId: string): Promise<MatchupScoreUpdateSummary | null> {
  const m = await prisma.redraftMatchup.findFirst({
    where: { id: matchupId },
    include: {
      homeRoster: { include: { players: true } },
      awayRoster: { include: { players: true } },
    },
  })
  if (!m || !m.homeRoster || !m.awayRosterId) return null

  const leagueId = m.leagueId
  const week = m.week
  const homeRosterId = m.homeRosterId
  const awayRosterId = m.awayRosterId
  const seasonRowId = m.seasonId

  if (await leagueUsesC2CEngine(leagueId)) {
    await updateC2CMatchupScores(matchupId)
    return null
  }

  const season = await prisma.redraftSeason.findFirst({ where: { id: seasonRowId } })
  if (!season) return null
  const seasonYear = season.season

  const useDevyEngine = await leagueUsesDevyEngine(leagueId)

  const home = await scoreRosterStarters({
    leagueId,
    rosterId: homeRosterId,
    week,
    seasonYear,
    useDevyEngine,
  })
  const away = await scoreRosterStarters({
    leagueId,
    rosterId: awayRosterId,
    week,
    seasonYear,
    useDevyEngine,
  })
  const missingPlayerIds = [...home.missingPlayerIds, ...away.missingPlayerIds]
  const isComplete =
    missingPlayerIds.length === 0 &&
    home.starterCount > 0 &&
    away.starterCount > 0 &&
    home.scoredStarterCount === home.starterCount &&
    away.scoredStarterCount === away.starterCount

  // Existing, authoritative finalization decision — driven entirely by the existing stat inputs' own
  // per-player finalized flags. Certified game data NEVER supplies fantasy points and NEVER finalizes on its own.
  const existingFinal = isComplete && home.allFinal && away.allFinal

  // Gated (off by default), STRICTER-ONLY certified finality guard: if the existing engine would finalize but
  // TRUSTWORTHY certified game evidence says not every game is final, withhold finalization (keep 'active') so a
  // premature final can't lock in. It can only DELAY finalization, never cause it, never change scores. Fails
  // open (unavailable/stale certified data → existing decision unchanged). Corrections still re-run this fn and
  // re-finalize once conditions hold. Evidence emitted (console.info), not persisted (no migration).
  let isFinal = existingFinal
  if (existingFinal && isSportsDataEnabled('scoring') && String(season.sport ?? 'NFL').toUpperCase() === 'NFL') {
    try {
      const finality = await new CertifiedScoringIntegrationService().evaluateScoringFinalityEvidence({ season: String(seasonYear), week: String(week) })
      if (finality.trustworthy && !finality.certifiedAllGamesFinal) {
        isFinal = false
        console.info('[scoring][sports-data] finalization withheld by certified evidence', { matchupId, week, unresolvedGames: finality.unresolvedGames, snapshot: finality.snapshotVersion, reason: finality.reason })
      }
    } catch {
      isFinal = existingFinal // fail open — existing authority final
    }
  }

  await prisma.redraftMatchup.update({
    where: { id: matchupId },
    data: {
      homeScore: home.points,
      awayScore: away.points,
      status: isFinal ? 'final' : 'active',
      lineupSnapshots: {
        redraftScoring: {
          scoredAt: new Date().toISOString(),
          isComplete,
          home,
          away,
          missingPlayerIds,
        },
      },
    },
  })

  // G15.2b/G15.3 — best-effort, never throws.
  //  • matchup.finalized: once per matchup (deterministic key), on final result.
  //  • matchup.updated: only when the score actually CHANGED (compared to the prior
  //    persisted score) so high-frequency no-op recalcs don't flood the log. Safe to
  //    wire now that the G15.3 relay drains the outbox.
  //  • score.updated (per-player) stays DEFERRED — per-player-per-sync volume would grow
  //    the permanent domain_events log unbounded; needs coalescing/retention (G15.4+).
  const scoreChanged = home.points !== m.homeScore || away.points !== m.awayScore
  if (isFinal) {
    const winnerRosterId =
      home.points > away.points ? homeRosterId : away.points > home.points ? awayRosterId : null
    await getPlatformEvents().emit(EVENT.MATCHUP_FINALIZED, {
      leagueId,
      seasonId: seasonRowId,
      sport: season.sport ?? null,
      leagueConcept: 'redraft',
      actor: { type: 'system' },
      source: 'engine:scoring',
      period: { kind: 'week', index: week },
      idempotencyKey: `matchup.finalized:${matchupId}`,
      subjects: [{ kind: 'matchup', id: matchupId }],
      payload: { matchupId, homeScore: home.points, awayScore: away.points, winnerRosterId: winnerRosterId ?? undefined },
    })
  } else if (scoreChanged) {
    await getPlatformEvents().emit(EVENT.MATCHUP_UPDATED, {
      leagueId,
      seasonId: seasonRowId,
      sport: season.sport ?? null,
      leagueConcept: 'redraft',
      actor: { type: 'system' },
      source: 'engine:scoring',
      period: { kind: 'week', index: week },
      subjects: [{ kind: 'matchup', id: matchupId }],
      payload: { matchupId },
    })
  }

  return {
    matchupId,
    week,
    homeScore: home.points,
    awayScore: away.points,
    isComplete,
    missingPlayerIds,
  }
}

export async function recalculateMatchupsForSeasonWeek(
  seasonId: string,
  week: number,
): Promise<{ updated: number; incomplete: number; summaries: MatchupScoreUpdateSummary[] }> {
  const matchups = await prisma.redraftMatchup.findMany({
    where: { seasonId, week },
    select: { id: true },
  })
  const summaries: MatchupScoreUpdateSummary[] = []
  let incomplete = 0
  for (const matchup of matchups) {
    const summary = await updateMatchupScores(matchup.id)
    if (!summary) continue
    summaries.push(summary)
    if (!summary.isComplete) incomplete += 1
  }
  return { updated: summaries.length, incomplete, summaries }
}

// Lineup locking now lives in `lib/redraft/lineupLock.ts`, derived from the real
// game schedule at request time (no flag-flipping job needed). The former
// `lockPlayersAtGameStart` no-op stub was removed when G1 was implemented.
