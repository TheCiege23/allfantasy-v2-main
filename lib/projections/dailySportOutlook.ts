import { liveFactorAdjustments, loadFactorTable, type FactorAdjustment } from '@/lib/af-projections/factors/factorTables'
import { loadInjurySnapshots, snapshotLevelFor } from '@/lib/af-projections/factors/injurySnapshots'
import { dailyGameContext, loadMlbWeatherLevels } from '@/lib/af-projections/factors/dailyGameContext'
import { projectionTeamKey } from '@/lib/af-projections/leagueProjectionSchedule'
import 'server-only'

import type { PrismaClient } from '@prisma/client'

import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { readScoringType } from '@/lib/category-scoring/leagueScoringType'
import { isDailyLineupScoringEnabled } from '@/lib/redraft/dailyLineups'
import { buildWeekKickoffMap, easternDayKey, normalizeLockTeam } from '@/lib/redraft/lineupLock'
import { bridgeRosterIdsToGameLogIds } from '@/lib/redraft/rosterGameLogIdBridge'
import { dailySportWeekForInstant } from '@/lib/season-week/dailySportSeasonStarts'
import { proTeamCode, type ProFantraxSport } from '@/lib/player-identity/proFantraxIdentityPlan'
import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import { AF_FORM_PROJECTION_LABEL, AF_FORM_PROJECTION_SOURCE } from './dailySportFormLabels'
import {
  formatPositionRank,
  isDailyFormSport,
  isUnavailableForProjection,
  positionRanks,
  projectPeriodPoints,
  scoreFormBlob,
  type PositionRank,
} from './dailySportForm'
import { readDailySportForm, readPriorDailySportForm } from './dailySportFormStore'
import { leagueAcceptsSeasonTotals } from './dailySportSeasonTotals'

/**
 * The waiver and lineup screens' projection and position rank for NBA / NHL / MLB players, priced
 * under ONE league's scoring. Request-path code: it reads Postgres only — the stored form lines
 * (dailySportFormStore), the identity map, and the week's slate the lineup lock already reads — and
 * makes ONE pass over each, whatever the number of players on screen.
 */

export type DailySportOutlook = {
  /** AF projection for the scoring period, league scoring. Null = no recent rate, or no known slate. */
  projectedPoints: number | null
  /** His pro team's games in the period; null when the period's slate is unknown. */
  periodGames: number | null
  perGame: number | null
  recentGames: number
  seasonPoints: number | null
  positionRank: PositionRank | null
  /**
   * Daily-lineup period only: his team's opponent that day (a team code where one is known) and
   * whether he is at home. Null when his team has no game that day, or in a weekly period.
   */
  opponent?: string | null
  homeAway?: 'home' | 'away' | null
  /**
   * The learned factors that moved this projection (`lib/af-projections/factors`): back-to-backs, streaks, playing
   * time, opponent, a new team, a return from a layoff — only those that made later games' projections closer in the
   * hold-out check. Absent when none applied; `projectedPoints` is then exactly the form rate × games.
   */
  /** `unadjusted` holds the fields before the factors, restored for a viewer without AF Intelligence. */
  afFactors?: { multiplier: number; reasons: string[]; unadjusted?: Record<string, number | null> }
}

export type DailySportOutlookResult = {
  byKey: Map<string, DailySportOutlook>
  period: { kind: 'week' | 'day'; season: number; week: number; day: string | null } | null
  label: string
  /** Why nothing was priced, when nothing was. */
  reason?: 'not_a_daily_form_sport' | 'category_league' | 'no_scoring_rules' | 'form_not_computed'
  computedAt?: string
  /** Last season's lines were stored and blended in (PRIOR_SEASON_BLEND_GAMES). */
  priorSeason?: number | null
}

/** 'YYYY-MM-DD' — the shape the daily-lineup day picker sends and `easternDayKey` returns. */
export function isDayKey(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`))
}

export type OutlookPlayerInput = {
  /** The key the caller wants the result under (a roster id, or the waiver row's id). */
  key: string
  /** The id to look the player up by: a roster id / pool `external_source_id` (RI number, identity id). */
  lookupId: string | null
  team: string | null
  injuryStatus: string | null
}

function teamCode(sport: string, team: string | null | undefined): string | null {
  const raw = String(team ?? '').trim()
  if (!raw) return null
  return proTeamCode(sport as ProFantraxSport, raw) ?? normalizeLockTeam(sport, raw)
}

export async function loadDailySportOutlook(
  db: PrismaClient,
  args: {
    league: { sport: string | null; season: number | null; settings: unknown }
    players: readonly OutlookPlayerInput[]
    now?: Date
    /**
     * False for a viewer whose plan does not include AF Intelligence (lib/core-app/afIntelligenceWithhold.ts): the
     * learned factors are not applied at all, so every number — and every TOTAL a caller sums from them — is the
     * plain one. Default true.
     */
    afIntelligence?: boolean
    /**
     * Daily-lineup leagues: the Eastern day the lineup screen's day picker has selected
     * ('YYYY-MM-DD'). The period is that day — its games and its opponent — and its week. Absent or
     * malformed = today. Ignored in a weekly league, whose period is the week.
     */
    day?: string | null
  },
): Promise<DailySportOutlookResult> {
  const sport = String(args.league.sport ?? '').trim().toUpperCase()
  const empty = (reason: DailySportOutlookResult['reason']): DailySportOutlookResult => ({
    byKey: new Map(),
    period: null,
    label: AF_FORM_PROJECTION_LABEL,
    reason,
  })
  if (!isDailyFormSport(sport)) return empty('not_a_daily_form_sport')
  // A categories league has no points to project or rank by.
  if (readScoringType(args.league.settings).mode !== 'points') return empty('category_league')
  const scorer = buildLeagueStatScorer({ sport, settings: args.league.settings })
  if (!scorer) return empty('no_scoring_rules')
  const now = args.now ?? new Date()
  const blob = await readDailySportForm(db, sport, now)
  if (!blob) return empty('form_not_computed')
  // Last season's lines (same table, keyed by season). None stored = this season alone. A prior built
  // from season totals is exact only under scoring it fully maps, so a league weighting anything else
  // (an NHL hat-trick bonus) declines it rather than score that category as 0 (dailySportSeasonTotals.ts).
  const stored = await readPriorDailySportForm(db, sport, blob.season, now).catch(() => null)
  const prior =
    stored?.basis === 'season_totals' && !leagueAcceptsSeasonTotals({ sport, settings: args.league.settings }, stored)
      ? null
      : stored

  const scored = scoreFormBlob(blob, scorer, prior)
  const ranks = positionRanks(scored.values())

  // Roster / pool ids -> the identity ids the game lines are keyed on (the matchup sync's own bridge).
  const lookupIds = [...new Set(args.players.map((p) => p.lookupId).filter((x): x is string => Boolean(x)))]
  const bridge = await bridgeRosterIdsToGameLogIds(db as never, [sport], lookupIds)
  const formIdByLookup = new Map<string, string>()
  for (const gameLogId of bridge.gameLogIds) {
    const lookup = bridge.rosterIdFor(gameLogId)
    if (!lookup || !scored.has(gameLogId)) continue
    // Prefer the translated id over the id itself: an RI number that happens to be an identity id is not him.
    if (!formIdByLookup.has(lookup) || gameLogId !== lookup) formIdByLookup.set(lookup, gameLogId)
  }

  // The period: this week of the sport's calendar, or — in a daily-lineup league — ONE day: the day
  // the lineup screen has selected, else today. A selected day is priced in ITS week, whose slate
  // holds that day's games and opponents; noon Eastern places it in that week whatever the zone.
  const season = Number(args.league.season ?? blob.season)
  const daily = isDailyLineupScoringEnabled(args.league.settings, sport)
  const pickedDay = daily && isDayKey(args.day) ? args.day : null
  const periodInstant = pickedDay ? new Date(`${pickedDay}T16:00:00Z`) : now
  const week = Number.isInteger(season) ? dailySportWeekForInstant(sport, season, periodInstant) : null
  const periodDay = pickedDay ?? easternDayKey(now)
  let gamesByTeam: Map<string, Set<string>> | null = null
  const opponentByTeam = new Map<string, { opponent: string; home: boolean }>()
  if (week != null) {
    const kickoffs = await buildWeekKickoffMap(db, { sport, season, week }).catch(() => null)
    const byTeamDay = kickoffs?.byTeamDay
    // An empty slate means "not synced" or "no games this week" — neither licenses a 0 for everyone.
    if (byTeamDay && byTeamDay.size > 0) {
      gamesByTeam = new Map()
      for (const [team, days] of byTeamDay) {
        const code = teamCode(sport, team)
        if (!code) continue
        const set = gamesByTeam.get(code) ?? new Set<string>()
        for (const d of days.keys()) set.add(d)
        gamesByTeam.set(code, set)
      }
    }
    if (daily && periodDay) {
      for (const [team, days] of kickoffs?.opponentsByTeamDay ?? []) {
        const code = teamCode(sport, team)
        const m = days.get(periodDay)
        if (!code || !m || opponentByTeam.has(code)) continue
        opponentByTeam.set(code, { opponent: teamCode(sport, m.opponent) ?? m.opponent, home: m.home })
      }
    }
  }

  /*
   * The learned factors for each player's next game. A daily period is one game, so rest and opponent are known; a
   * weekly one can hold several, so only the factors about the player himself apply (form, playing time, a new team,
   * a return). Never throws: a failed read is no adjustment.
   */
  const factorTable = args.afIntelligence === false ? null : await loadFactorTable(db, sport, now).catch(() => null)
  const nextAtMs = daily && periodDay ? Date.parse(`${periodDay}T23:00:00Z`) : now.getTime()
  // Today's designations (NBA, NHL), from the same pre-game snapshot the learner reads — only once the table has
  // published an injury level, and only for a one-game daily period.
  const injurySnapshot = factorTable && daily && periodDay && (sport === 'NBA' || sport === 'NHL') && factorTable.levels.some((l) => l.published && l.factor === 'injury')
    ? (await loadInjurySnapshots(db, sport, [periodDay]).catch(() => new Map())).get(periodDay)
    : undefined
  // MLB's stored pre-game forecast for the day — only once the table has published a weather level.
  const mlbWeather = factorTable && daily && periodDay && sport === 'MLB' && factorTable.levels.some((l) => l.published && l.factor === 'weather')
    ? await loadMlbWeatherLevels(db, [periodDay]).catch(() => null)
    : null
  const adjustments = factorTable
    ? await liveFactorAdjustments(db, {
        sport,
        table: factorTable,
        now,
        players: args.players.flatMap((p) => {
          const formId = p.lookupId ? formIdByLookup.get(p.lookupId) : undefined
          if (!formId) return []
          const code = teamCode(sport, p.team) ?? teamCode(sport, scored.get(formId)?.team ?? null)
          return [{
            key: p.key,
            gameLogId: formId,
            next: daily
              ? (() => {
                  const injury = snapshotLevelFor(injurySnapshot, formId, projectionTeamKey(sport, p.team ?? scored.get(formId)?.team ?? null))
                  const game = dailyGameContext(sport, p.team ?? scored.get(formId)?.team ?? null, nextAtMs, periodDay ?? null, mlbWeather)
                  const context = { ...(game ?? {}), ...(injury ? { injury } : {}) }
                  return { atMs: nextAtMs, opponent: (code ? opponentByTeam.get(code)?.opponent : null) ?? null, ...(Object.keys(context).length ? { context } : {}) }
                })()
              : (() => {
                  // A week can hold several games, but one head coach: only the coaching level is known for all of them.
                  const coaching = dailyGameContext(sport, p.team ?? scored.get(formId)?.team ?? null, nextAtMs, null, null)?.coaching
                  return { atMs: nextAtMs, drop: ['rest', 'opponent'] as const, ...(coaching ? { context: { coaching } } : {}) }
                })(),
          }]
        }),
      }).catch(() => new Map<string, FactorAdjustment>())
    : new Map<string, FactorAdjustment>()

  const byKey = new Map<string, DailySportOutlook>()
  for (const p of args.players) {
    const formId = p.lookupId ? formIdByLookup.get(p.lookupId) : undefined
    const f = formId ? scored.get(formId) : undefined
    if (!f) continue
    const code = teamCode(sport, p.team) ?? teamCode(sport, f.team)
    let periodGames: number | null = null
    if (gamesByTeam) {
      const days = code ? gamesByTeam.get(code) : undefined
      periodGames = daily ? (periodDay && days?.has(periodDay) ? 1 : 0) : days?.size ?? 0
    }
    const matchup = daily && code ? opponentByTeam.get(code) : undefined
    const base = projectPeriodPoints({
      perGame: f.perGame,
      teamGames: periodGames,
      available: !isUnavailableForProjection(p.injuryStatus),
      part: f.part,
    })
    const adj = adjustments.get(p.key)
    byKey.set(p.key, {
      projectedPoints: base != null && adj ? Math.round(base * adj.multiplier * 100) / 100 : base,
      ...(adj && base ? { afFactors: { multiplier: adj.multiplier, reasons: adj.reasons, unadjusted: { projectedPoints: base } } } : {}),
      periodGames,
      perGame: f.perGame,
      recentGames: f.recentGames,
      seasonPoints: f.seasonPoints,
      positionRank: ranks.get(f.id) ?? null,
      ...(daily ? { opponent: matchup?.opponent ?? null, homeAway: matchup ? (matchup.home ? 'home' : 'away') : null } : {}),
    })
  }

  return {
    byKey,
    period: week != null ? { kind: daily ? 'day' : 'week', season, week, day: daily ? periodDay : null } : null,
    label: AF_FORM_PROJECTION_LABEL,
    computedAt: blob.computedAt,
    priorSeason: prior?.season ?? null,
  }
}

/** The wire fields a priced row carries; `positionRankLabel` is "C12". */
export type DailySportWireFields = {
  positionRank?: PositionRank | null
  positionRankLabel?: string | null
  /** Daily-lineup period: that day's opponent and venue, for a row the NFL game context does not cover. */
  periodOpponent?: string | null
  periodHomeAway?: 'home' | 'away' | null
  /** The learned factors that moved `projectedPoints`; `unadjusted.projectedPoints` is the number before them. */
  afFactors?: { multiplier: number; reasons: string[]; unadjusted?: Record<string, number | null> }
}

/**
 * Stamp an outlook onto serialized player rows. A row with no outlook is returned untouched, so a
 * player we cannot identify keeps whatever the row already said rather than gaining a false zero.
 */
export function applyDailySportOutlook<T extends Pick<UnifiedPlayerWireDto, 'id' | 'projectedPoints' | 'projectionsSource'>>(
  rows: readonly T[],
  outlook: DailySportOutlookResult,
  keyOf: (row: T, index: number) => string = (row) => row.id,
): Array<T & DailySportWireFields> {
  return rows.map((row, index) => {
    const o = outlook.byKey.get(keyOf(row, index))
    if (!o) return row
    return {
      ...row,
      ...(o.projectedPoints != null ? { projectedPoints: o.projectedPoints, projectionsSource: AF_FORM_PROJECTION_SOURCE } : {}),
      positionRank: o.positionRank,
      positionRankLabel: formatPositionRank(o.positionRank),
      ...(o.opponent !== undefined ? { periodOpponent: o.opponent, periodHomeAway: o.homeAway ?? null } : {}),
      ...(o.projectedPoints != null && o.afFactors ? { afFactors: o.afFactors } : {}),
    }
  })
}
