import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { computeLeagueProjectedPoints, extractScoringSettings } from '@/lib/projections/leagueScoring'
import { readWeekMarketContextByTeam, type TeamMarketContext } from '@/lib/odds/gameOddsReads'
import type { SectionState } from './leagueHome'
import { loadNews, loadPlayerBlurbs, loadSchedule, mergeNewsItems, type PlayerCardNews, type PlayerCardWeek } from './playerCard'
import type { PlayerDetail } from './playerFinder'
import { componentStats, statLinePpr, summarizeSeason, type PlayerSeason, type SeasonWeek } from './playerSeason'
import { createSwrCache } from './staleWhileRevalidate'

/**
 * The deeper Player Finder card (Phase 1, 2026-09-27): what he has done this season against what
 * he was projected, his next games with the betting market's view of his offense, the news about
 * him, and what he is worth in each of your leagues.
 *
 * Everything here is a DATABASE read (DB-first boundary). The one read-through is the market
 * value service, which serves FantasyCalc from the cache the hourly warm keeps and fetches only on
 * a cold miss — the pattern `getFantasyCalcValuesDbFirst` already documents.
 *
 * ⚠ WHAT IS SHARED AND WHAT IS NOT. The season rows, next games, odds and news depend only on the
 * PLAYER and the WEEK, so they are cached per player for a minute and served to every manager who
 * opens him — the same game-day stance as the card facts in playerFinder.ts. A league's own
 * scoring and the per-league values depend on the VIEWER's leagues and are computed per request.
 *
 * ⚠ PER-LEAGUE VALUE IS AF PRO (Guap's paywall ruling, 2026-09-27): the caller passes
 * `includeValues: false` for a locked viewer and nothing is computed or sent. The season view,
 * next games and news stay free — they are the game-day hook.
 */

const DEPTH_TTL_MS = 60_000
const DEPTH_CAP = 500
const NEXT_GAMES = 5

export type PlayerNextGame = {
  opponent: string | null
  home: boolean
  kickoff: string | null
  /** The betting market's read of HIS team this week, when a quote exists. */
  market: Pick<TeamMarketContext, 'impliedTeamTotal' | 'spread' | 'gameTotal' | 'winProbability' | 'isStale'> | null
}

export type LeagueValue = {
  /** What THIS league's format and scoring make him worth (FantasyCalc, adjusted for reception rules). */
  value: number
  /** The chart number before this league's reception rules; equals `value` when nothing moved it. */
  base: number
  /** Why it moved, when it did — e.g. a tight-end premium. */
  fitNote: string | null
  mode: 'dynasty' | 'redraft'
  numQbs: 1 | 2
}

export type PlayerDepth = {
  season: SectionState<PlayerSeason>
  nextGame: SectionState<PlayerNextGame>
  upcoming: SectionState<{ weeks: PlayerCardWeek[]; season: number }>
  news: SectionState<PlayerCardNews[]>
  /** League id → value, for leagues on the card. Null when not computed (locked viewer, no Sleeper id). */
  leagueValues: Record<string, LeagueValue> | null
}

/* ── the per-player, per-week part (cached) ─────────────────────────────── */

type SeasonRow = { week: number; opponent: string | null; projPpr: number | null; projComponents: Record<string, unknown> | null; statLine: unknown }

type SharedDepth = {
  seasonRows: SeasonRow[] | null
  nextGame: SectionState<PlayerNextGame>
  upcoming: SectionState<{ weeks: PlayerCardWeek[]; season: number }>
  news: SectionState<PlayerCardNews[]>
}

const shared = createSwrCache<SharedDepth>({ ttlMs: DEPTH_TTL_MS, cap: DEPTH_CAP })

/** Tests: drop the per-player cache. */
export function clearPlayerDepthCache(): void {
  shared.clear()
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

async function loadSeasonRows(sleeperId: string, season: number, throughWeek: number): Promise<SeasonRow[]> {
  const [projections, stats] = await Promise.all([
    prisma.fantasyProjection
      .findMany({
        // The provider feed the card already shows as "this week's projection" — never the AF mirror rows (playerProjections.ts).
        where: { sport: 'NFL', playerId: sleeperId, season: String(season), week: { lte: throughWeek }, source: { not: 'allfantasy' } },
        select: { week: true, projectedPoints: true, stats: true },
      })
      .catch(() => [] as Array<{ week: number; projectedPoints: number; stats: unknown }>),
    prisma.playerGameStat
      .findMany({
        where: { sportType: 'NFL', playerId: sleeperId, season, weekOrRound: { lte: throughWeek } },
        select: { weekOrRound: true, normalizedStatMap: true, opponent: true },
      })
      .catch(() => [] as Array<{ weekOrRound: number | null; normalizedStatMap: unknown; opponent: string | null }>),
  ])

  const byWeek = new Map<number, SeasonRow>()
  const row = (week: number) => {
    const existing = byWeek.get(week)
    if (existing) return existing
    const fresh: SeasonRow = { week, opponent: null, projPpr: null, projComponents: null, statLine: null }
    byWeek.set(week, fresh)
    return fresh
  }
  for (const p of projections) {
    const r = row(p.week)
    r.projPpr = Number.isFinite(p.projectedPoints) ? Math.round(p.projectedPoints * 10) / 10 : null
    // The vendor's component line sits one level down: the row's `stats` carries name/team at the top (playerProjections.ts).
    r.projComponents = asRecord(asRecord(p.stats)?.stats)
  }
  for (const s of stats) {
    if (s.weekOrRound == null) continue
    const r = row(s.weekOrRound)
    // Several sources can write a week; keep the richest line.
    const prevSize = Object.keys(asRecord(r.statLine) ?? {}).length
    const nextSize = Object.keys(asRecord(s.normalizedStatMap) ?? {}).length
    if (nextSize >= prevSize) {
      r.statLine = s.normalizedStatMap
      r.opponent = s.opponent ?? r.opponent
    }
  }
  return [...byWeek.values()].sort((a, b) => a.week - b.week)
}

async function loadShared(detail: PlayerDetail): Promise<SharedDepth> {
  const { player } = detail
  const sport = player.sport
  const sleeperId = player.sleeperId
  const week = detail.scheduleWeek
  const club = normalizeTeamAbbrev(player.team)
  const injuryNote = detail.injury.available ? detail.injury.data.description : null

  const [seasonRows, news, blurbs, schedule, odds] = await Promise.all([
    sport === 'NFL' && sleeperId && week ? loadSeasonRows(sleeperId, week.season, week.week).catch(() => null) : Promise.resolve(null),
    loadNews(player.name, sport).catch(() => ({ available: false as const, reason: 'News could not be read.' })),
    loadPlayerBlurbs(sleeperId, player.name, sport).catch(() => [] as PlayerCardNews[]),
    week ? loadSchedule(player.team, week.season, week.week, null, null, NEXT_GAMES).catch(() => null) : Promise.resolve(null),
    sport === 'NFL' && week && club
      ? readWeekMarketContextByTeam('NFL', week.season, week.week).catch(() => new Map<string, TeamMarketContext>())
      : Promise.resolve(new Map<string, TeamMarketContext>()),
  ])

  const merged = mergeNewsItems(news.available ? news.data : [], blurbs, injuryNote)
  const newsState: SectionState<PlayerCardNews[]> =
    merged.length > 0 ? { available: true, data: merged } : { available: false, reason: 'No recent item mentions this player.' }

  const quote = club ? odds.get(club) ?? null : null
  const game = detail.game.available ? detail.game.data : null
  const nextGame: SectionState<PlayerNextGame> = game
    ? {
        available: true,
        data: {
          opponent: quote?.opponent ?? game.opponent ?? null,
          home: quote?.isHome ?? game.home,
          kickoff: game.kickoff ?? null,
          market: quote
            ? { impliedTeamTotal: quote.impliedTeamTotal, spread: quote.spread, gameTotal: quote.gameTotal, winProbability: quote.winProbability, isStale: quote.isStale }
            : null,
        },
      }
    : { available: false, reason: detail.game.available ? 'No game this week.' : detail.game.reason }

  const upcoming: SharedDepth['upcoming'] =
    schedule && schedule.schedule.available
      ? { available: true, data: { weeks: schedule.schedule.data.weeks, season: schedule.schedule.data.season } }
      : { available: false, reason: schedule && !schedule.schedule.available ? schedule.schedule.reason : 'No schedule on file for this player.' }

  return { seasonRows, nextGame, upcoming, news: newsState }
}

/* ── the per-viewer part ─────────────────────────────────────────────────── */

function seasonView(rows: SeasonRow[] | null, season: number | null, scoring: Record<string, unknown> | null, leagueName: string | null): SectionState<PlayerSeason> {
  if (!rows || season == null) return { available: false, reason: 'No weekly projections or stat lines on file for this player.' }
  const league = scoring && leagueName ? scoring : null
  const weeks: SeasonWeek[] = rows.map((r) => {
    const played = r.statLine != null && Object.keys(asRecord(r.statLine) ?? {}).length > 0
    if (league) {
      const proj = r.projComponents ? computeLeagueProjectedPoints(r.projComponents, league) : null
      const act = played ? computeLeagueProjectedPoints(componentStats(r.statLine), league) : null
      return {
        week: r.week,
        opponent: r.opponent,
        projected: proj ? Math.round(proj.points * 10) / 10 : null,
        actual: act ? Math.round(act.points * 10) / 10 : null,
        played,
      }
    }
    return { week: r.week, opponent: r.opponent, projected: r.projPpr, actual: played ? statLinePpr(r.statLine) : null, played }
  })
  if (weeks.every((w) => w.projected == null && w.actual == null)) {
    return { available: false, reason: 'No weekly projections or stat lines on file for this player.' }
  }
  return {
    available: true,
    data: {
      season,
      scoring: league && leagueName ? { kind: 'league', leagueName } : { kind: 'ppr' },
      weeks,
      summary: summarizeSeason(weeks),
    },
  }
}

/**
 * League id → (Sleeper id → value) for several players across several leagues: one league read,
 * and one value-set read per distinct (variant, scoring, teams) format — leagues share formats.
 * The card uses it for one player; the league-mode shares board for twenty.
 */
export async function loadLeagueValueMap(sleeperIds: readonly string[], leagueIds: readonly string[]): Promise<Map<string, Map<string, LeagueValue>>> {
  const out = new Map<string, Map<string, LeagueValue>>()
  if (leagueIds.length === 0 || sleeperIds.length === 0) return out
  const leagues = await prisma.league
    .findMany({ where: { id: { in: [...leagueIds] } }, select: { id: true, settings: true, leagueType: true } })
    .catch(() => [] as Array<{ id: string; settings: unknown; leagueType: string | null }>)
  const [{ marketContextFor }, { getMarketValues, playerValueForLeague }] = await Promise.all([
    import('@/lib/trade-intel/marketContext'),
    import('@/lib/trade-intel/marketValueService'),
  ])
  const byContext = new Map<string, Promise<Awaited<ReturnType<typeof getMarketValues>>>>()
  await Promise.all(
    leagues.map(async (l) => {
      const s = asRecord(l.settings) ?? {}
      const teams = Number(s.leagueSize) || 12
      const ctx = marketContextFor(l.settings, l.leagueType, teams)
      const key = JSON.stringify(ctx)
      if (!byContext.has(key)) byContext.set(key, getMarketValues(ctx).catch(() => null))
      const values = await byContext.get(key)!
      if (!values) return
      const scoring = asRecord(s.scoring_settings ?? s.scoringSettings)
      const perPlayer = new Map<string, LeagueValue>()
      for (const id of sleeperIds) {
        const v = playerValueForLeague(values, id, scoring)
        if (!v) continue
        perPlayer.set(id, { value: v.adjusted, base: v.base, fitNote: v.fit?.reason ?? null, mode: values.mode, numQbs: values.numQbs })
      }
      out.set(l.id, perPlayer)
    }),
  )
  return out
}

async function loadLeagueValues(sleeperId: string, leagueIds: string[]): Promise<Record<string, LeagueValue>> {
  const map = await loadLeagueValueMap([sleeperId], leagueIds)
  const out: Record<string, LeagueValue> = {}
  for (const [leagueId, perPlayer] of map) {
    const v = perPlayer.get(sleeperId)
    if (v) out[leagueId] = v
  }
  return out
}

export async function getPlayerDepth(
  detail: PlayerDetail,
  opts: {
    /** The held league, when the card is in league mode: its scoring re-scores the season view. */
    heldLeagueId?: string | null
    /** False for a viewer without AF Pro: per-league values are neither computed nor sent. */
    includeValues?: boolean
  } = {},
): Promise<PlayerDepth> {
  const { player } = detail
  const sharedDepth = await shared.get(`${player.sport}:${player.externalId}:${detail.scheduleWeek?.season ?? 0}:${detail.scheduleWeek?.week ?? 0}`, () => loadShared(detail))

  // League mode: that league's own scoring on both sides of every week.
  let scoring: Record<string, unknown> | null = null
  let leagueName: string | null = null
  if (opts.heldLeagueId && sharedDepth.seasonRows) {
    const held = await prisma.league
      .findUnique({ where: { id: opts.heldLeagueId }, select: { name: true, settings: true } })
      .catch(() => null)
    scoring = held ? extractScoringSettings(held.settings) : null
    leagueName = held?.name ?? null
  }

  const slotLeagueIds = detail.leagues.available ? detail.leagues.data.map((l) => l.leagueId) : []
  const leagueValues =
    opts.includeValues !== false && player.sleeperId && slotLeagueIds.length > 0
      ? await loadLeagueValues(player.sleeperId, slotLeagueIds).catch(() => null)
      : null

  return {
    season: seasonView(sharedDepth.seasonRows, detail.scheduleWeek?.season ?? null, scoring, leagueName),
    nextGame: sharedDepth.nextGame,
    upcoming: sharedDepth.upcoming,
    news: sharedDepth.news,
    leagueValues,
  }
}
