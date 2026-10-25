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
  // Last season's lines (same table, keyed by season). None stored = this season alone.
  const prior = await readPriorDailySportForm(db, sport, blob.season, now).catch(() => null)

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
    byKey.set(p.key, {
      projectedPoints: projectPeriodPoints({
        perGame: f.perGame,
        teamGames: periodGames,
        available: !isUnavailableForProjection(p.injuryStatus),
        part: f.part,
      }),
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
    }
  })
}
