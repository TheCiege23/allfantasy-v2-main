import 'server-only'

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import type { RunBudget } from '@/lib/cron/runBudget'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { normalizeGameStatus } from '@/lib/scores/gameScoreProviders'
import { getTeamIndex, listFollowerIdsForTeam, listTeamsForSport } from '@/lib/follows/teamFollows'
import { resolveTeam, type TeamIndex } from '@/lib/follows/teamResolver'
import { withinDailyCap } from '@/lib/follows/teamFollowAlerts'

/**
 * Score alerts for followed teams — phase 2 of team follows (owner's call, 2026-10-03): a FINAL
 * score, and a HALFTIME score where the live feed says so. NFL and college football only: they are
 * the sports whose games `SportsGame` carries with live status today.
 *
 * DB-FIRST: reads only `SportsGame` (written by the scores crons); never calls a provider. Run at the
 * end of /api/cron/import-scores, so it sees each tick's fresh rows.
 *
 * ⚠ ONE GAME IS 4–6 ROWS. Every provider writes its own row with its own team spelling — measured
 * 2026-10-03: "BUF" (api_sports), "Buffalo Bills" (espn, thesportsdb), "ALABAMA" / "Alabama Crimson
 * Tide" / "ALA" for one college team. Rows are collapsed to one game by (sport, Eastern date,
 * resolved home, resolved away) through lib/follows/teamResolver, or every final would buzz five
 * times. A team that does not resolve drops the row: no alert beats a wrong one.
 *
 * ⚠ A FINAL IS SENT ONLY WHEN EVERY PROVIDER REPORTING A FINAL AGREES ON THE SCORE. Providers settle
 * at different moments and occasionally publish a stale number with a final status; disagreement
 * waits for the next tick rather than announcing a score that is then corrected.
 *
 * ONCE PER GAME, ATOMICALLY: each alert claims a `SportsDataCache` key (primary key) before sending,
 * so concurrent cron runs cannot both send it — and adjacent dates are checked too, because providers
 * disagree on a game's calendar date when its kickoff time is TBD.
 */

export const SCORE_ALERT_SPORTS = ['NFL', 'NCAAF'] as const

/** Score alerts per person per day (separate from news). A Saturday of 30 college follows is 60 events. */
export const TEAM_SCORE_ALERTS_PER_DAY = 20

/** Only games that started recently: a final from a cron outage hours ago is history, not news. */
/** Sources whose team field is always "<School> <Mascot>", so a school-name prefix is safe. */
const PREFIX_SOURCES = new Set(['espn', 'espn_live'])

const FINAL_WINDOW_MS = 9 * 60 * 60 * 1000
const HALFTIME_WINDOW_MS = 4 * 60 * 60 * 1000
const LEDGER_TTL_MS = 14 * 24 * 60 * 60 * 1000

export type GameRow = {
  sport: string
  source: string
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  status: string | null
  startTime: Date | null
  raw: unknown
}

export type ScoreEvent = {
  kind: 'final' | 'halftime'
  sport: string
  dateKey: string
  home: string
  away: string
  homeScore: number
  awayScore: number
}

/** The game's calendar date in US Eastern — the day the schedule says it was played. */
export function easternDateKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

function shiftDateKey(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** ESPN's own live state says halftime. The other providers carry no period, so only ESPN can. */
export function espnSaysHalftime(raw: unknown): boolean {
  const name = (raw as { status?: { type?: { name?: unknown } } } | null)?.status?.type?.name
  return name === 'STATUS_HALFTIME'
}

export function ledgerKey(e: Pick<ScoreEvent, 'kind' | 'sport' | 'dateKey' | 'home' | 'away'>, dateKey = e.dateKey): string {
  return `team-follow-alert:${e.kind}:${e.sport}:${dateKey}:${e.home}:${e.away}`
}

/**
 * Pure: collapse provider rows into games and decide which alerts are due. Nothing here knows what
 * was already sent — the ledger does that.
 */
export function detectScoreEvents(rows: readonly GameRow[], indexBySport: Map<string, TeamIndex>, now: Date): ScoreEvent[] {
  const games = new Map<string, { sport: string; dateKey: string; home: string; away: string; start: Date; rows: GameRow[] }>()
  for (const r of rows) {
    if (!r.startTime) continue
    const index = indexBySport.get(r.sport)
    if (!index) continue
    // Schedule fields name one team each, so bare school names/codes are accepted; only ESPN, which
    // always writes "<School> <Mascot>", may match by prefix (see resolveTeam's `noPrefix`).
    const opts = { exactNames: true, noPrefix: !PREFIX_SOURCES.has(r.source) }
    const home = resolveTeam(index, r.homeTeam, opts)
    const away = resolveTeam(index, r.awayTeam, opts)
    if (!home || !away || home === away) continue
    const dateKey = easternDateKey(r.startTime)
    const key = `${r.sport}|${dateKey}|${home}|${away}`
    const g = games.get(key) ?? { sport: r.sport, dateKey, home, away, start: r.startTime, rows: [] }
    g.rows.push(r)
    games.set(key, g)
  }

  const events: ScoreEvent[] = []
  for (const g of games.values()) {
    const age = now.getTime() - g.start.getTime()
    if (age < 0) continue
    const finals = g.rows.filter(
      (r) => normalizeGameStatus(r.status) === 'final' && r.homeScore != null && r.awayScore != null,
    )
    if (finals.length > 0) {
      if (age > FINAL_WINDOW_MS) continue
      const agreed = finals.every((r) => r.homeScore === finals[0].homeScore && r.awayScore === finals[0].awayScore)
      if (!agreed) continue
      events.push({ kind: 'final', sport: g.sport, dateKey: g.dateKey, home: g.home, away: g.away, homeScore: finals[0].homeScore!, awayScore: finals[0].awayScore! })
      continue
    }
    if (age > HALFTIME_WINDOW_MS) continue
    const half = g.rows.find((r) => r.source === 'espn' && espnSaysHalftime(r.raw) && r.homeScore != null && r.awayScore != null)
    if (half) {
      events.push({ kind: 'halftime', sport: g.sport, dateKey: g.dateKey, home: g.home, away: g.away, homeScore: half.homeScore!, awayScore: half.awayScore! })
    }
  }
  return events
}

/** Claim an alert so no other run sends it. false = already claimed (here or on an adjacent date). */
async function claim(e: ScoreEvent, now: Date): Promise<boolean> {
  const adjacent = [-1, 1].map((d) => ledgerKey(e, shiftDateKey(e.dateKey, d)))
  const existing = await prisma.sportsDataCache.findFirst({ where: { cacheKey: { in: adjacent } }, select: { cacheKey: true } })
  if (existing) return false
  try {
    await prisma.sportsDataCache.create({
      data: {
        cacheKey: ledgerKey(e),
        expiresAt: new Date(now.getTime() + LEDGER_TTL_MS),
        data: { sentAt: now.toISOString(), homeScore: e.homeScore, awayScore: e.awayScore } as Prisma.InputJsonValue,
      },
    })
    return true
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false
    throw err
  }
}

export function scoreAlertText(e: ScoreEvent, names: Map<string, string>): { title: string; body: string } {
  const home = names.get(e.home) ?? e.home
  const away = names.get(e.away) ?? e.away
  const line = `${away} ${e.awayScore}, ${home} ${e.homeScore}`
  if (e.kind === 'halftime') {
    const lead = e.homeScore === e.awayScore ? 'Tied at the half.' : `${e.homeScore > e.awayScore ? home : away} lead at the half.`
    return { title: `Halftime: ${line}`, body: lead }
  }
  const result =
    e.homeScore === e.awayScore
      ? `${away} and ${home} tie ${e.awayScore}–${e.homeScore}.`
      : `${e.homeScore > e.awayScore ? home : away} win ${Math.max(e.homeScore, e.awayScore)}–${Math.min(e.homeScore, e.awayScore)}.`
  return { title: `Final: ${line}`, body: result }
}

export async function dispatchTeamScoreAlerts(input: { now?: Date; budget?: RunBudget } = {}): Promise<{
  games: number
  events: number
  sent: number
  recipients: number
  capped: number
  alreadySent: number
}> {
  const now = input.now ?? new Date()
  const out = { games: 0, events: 0, sent: 0, recipients: 0, capped: 0, alreadySent: 0 }

  const rows = (await prisma.sportsGame
    .findMany({
      where: {
        sport: { in: [...SCORE_ALERT_SPORTS] },
        startTime: { gte: new Date(now.getTime() - FINAL_WINDOW_MS), lte: now },
        status: { not: null },
      },
      select: { sport: true, source: true, homeTeam: true, awayTeam: true, homeScore: true, awayScore: true, status: true, startTime: true, raw: true },
    })
    .catch(() => [])) as GameRow[]
  if (rows.length === 0) return out

  const indexBySport = new Map<string, TeamIndex>()
  const namesBySport = new Map<string, Map<string, string>>()
  for (const s of SCORE_ALERT_SPORTS) {
    const index = await getTeamIndex(s)
    if (index) indexBySport.set(s, index)
    namesBySport.set(s, new Map((await listTeamsForSport(s)).map((t) => [t.abbr, t.name])))
  }

  const events = detectScoreEvents(rows, indexBySport, now)
  out.events = events.length
  out.games = new Set(events.map((e) => `${e.sport}|${e.dateKey}|${e.home}|${e.away}`)).size

  for (const e of events) {
    if (input.budget?.exhausted()) break
    const [h, a] = await Promise.all([
      listFollowerIdsForTeam(e.sport, e.home).catch(() => null),
      listFollowerIdsForTeam(e.sport, e.away).catch(() => null),
    ])
    // Someone following BOTH teams gets one alert, not two.
    const followers = [...new Set([...(h ?? []), ...(a ?? [])])]
    if (followers.length === 0) continue
    if (!(await claim(e, now).catch(() => false))) {
      out.alreadySent++
      continue
    }
    const allowed = await withinDailyCap(followers, { provider: 'team_score_alerts', limit: TEAM_SCORE_ALERTS_PER_DAY })
    out.capped += followers.length - allowed.length
    if (allowed.length === 0) continue
    const { title, body } = scoreAlertText(e, namesBySport.get(e.sport) ?? new Map())
    await dispatchNotification({
      userIds: allowed,
      category: 'followed_team_scores',
      type: e.kind === 'final' ? 'team_final_score' : 'team_halftime_score',
      title,
      body,
      leagueId: null,
      severity: 'medium',
      dedupePrefix: `team-score:${ledgerKey(e)}`,
      meta: { sport: e.sport, home: e.home, away: e.away, homeScore: e.homeScore, awayScore: e.awayScore, kind: e.kind },
    }).catch(() => {})
    out.sent++
    out.recipients += allowed.length
  }
  return out
}
