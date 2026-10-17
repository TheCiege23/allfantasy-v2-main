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
 * Tide" / "ALA" for one college team. Rows are collapsed to one game by (sport, Eastern date, the
 * resolved PAIR of teams — unordered, because providers disagree on home/away at neutral sites)
 * through lib/follows/teamResolver, or every final would buzz five times.
 *
 * ⚠ ONE SIDE MAY BE UNKNOWN. A dry run over the 2026-09-26 slate found 22 games of a followable team
 * against a school outside our team list (Western Kentucky vs Mercyhurst) — requiring both sides to
 * resolve silently skipped all of them. Such a game is keyed on the one team we know; a team plays at
 * most once a day, so (sport, date, team) names one game.
 *
 * ⚠ A FINAL IS SENT ONLY WHEN EVERY PROVIDER REPORTING A FINAL AGREES ON THE SCORE. Providers settle
 * at different moments and occasionally publish a stale number with a final status; disagreement
 * waits for the next tick rather than announcing a score that is then corrected. And a team that
 * lands in TWO games on one date is a mis-merge or a mis-map — none of its games is sent.
 *
 * ONCE PER TEAM PER DAY, ATOMICALLY: each alert claims one `SportsDataCache` key (primary key) per
 * team before sending, so concurrent runs cannot both send it, and a game first seen with one side
 * unknown cannot be re-sent to that team when a later row names both. Adjacent dates are checked too,
 * because providers disagree on a game's calendar date when its kickoff time is TBD.
 */

export const SCORE_ALERT_SPORTS = ['NFL', 'NCAAF'] as const

/** Score alerts per person per day (separate from news). A Saturday of 30 college follows is 60 events. */
export const TEAM_SCORE_ALERTS_PER_DAY = 20

/** Sources whose team field is always "<School> <Mascot>", so a school-name prefix is safe. */
const PREFIX_SOURCES = new Set(['espn', 'espn_live'])

/** Only games that started recently: a final from a cron outage hours ago is history, not news. */
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
  /** Canonical abbreviation, or null when that side is a school outside our team list. */
  home: string | null
  away: string | null
  /** The provider's spelling, for a side that did not resolve. */
  homeName?: string
  awayName?: string
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

/** The ledger key for one team's alert of one kind on one date. */
export function ledgerKey(kind: ScoreEvent['kind'], sport: string, dateKey: string, team: string): string {
  return `team-follow-alert:${kind}:${sport}:${dateKey}:${team}`
}

/** A row oriented to its game: scores flipped when this provider has home and away the other way round. */
type Oriented = { row: GameRow; homeScore: number | null; awayScore: number | null }

type Game = {
  sport: string
  dateKey: string
  home: string | null
  away: string | null
  start: Date
  rows: Oriented[]
  /** Provider spellings of the unresolved side, for display. */
  otherNames: Array<{ source: string; name: string }>
}

/** Whose spelling of an unlisted school reads best: CFBD writes "Alabama A&M", TheSportsDB "Alabama A and M", api-sports "ALABAMA A&M". */
const NAME_SOURCE_ORDER = ['cfbd', 'espn', 'espn_live', 'thesportsdb', 'rolling_insights', 'api_sports']

function displayName(names: Array<{ source: string; name: string }>): string | undefined {
  const rank = (s: string) => (NAME_SOURCE_ORDER.indexOf(s) + NAME_SOURCE_ORDER.length + 1) % (NAME_SOURCE_ORDER.length + 1)
  return [...names].sort((a, b) => rank(a.source) - rank(b.source))[0]?.name
}

/**
 * Pure: collapse provider rows into games and decide which alerts are due. Nothing here knows what
 * was already sent — the ledger does that.
 */
export function detectScoreEvents(rows: readonly GameRow[], indexBySport: Map<string, TeamIndex>, now: Date): ScoreEvent[] {
  const full = new Map<string, Game>()
  const half = new Map<string, Game & { conflict?: boolean }>()
  for (const r of rows) {
    if (!r.startTime) continue
    const index = indexBySport.get(r.sport)
    if (!index) continue
    // Schedule fields name one team each, so bare school names are accepted; only ESPN, which always
    // writes "<School> <Mascot>", may match by prefix (see resolveTeam's `noPrefix`).
    const opts = { exactNames: true, noPrefix: !PREFIX_SOURCES.has(r.source) }
    const h = resolveTeam(index, r.homeTeam, opts)
    const a = resolveTeam(index, r.awayTeam, opts)
    if ((!h && !a) || h === a) continue
    const dateKey = easternDateKey(r.startTime)
    if (h && a) {
      const key = `${r.sport}|${dateKey}|${[h, a].sort().join('|')}`
      const g = full.get(key) ?? { sport: r.sport, dateKey, home: h, away: a, start: r.startTime, rows: [], otherNames: [] }
      const same = g.home === h
      g.rows.push({ row: r, homeScore: same ? r.homeScore : r.awayScore, awayScore: same ? r.awayScore : r.homeScore })
      full.set(key, g)
    } else {
      const team = (h ?? a)!
      const key = `${r.sport}|${dateKey}|${team}`
      const g = half.get(key) ?? { sport: r.sport, dateKey, home: h, away: a, start: r.startTime, rows: [], otherNames: [] }
      // The known team must sit on the same side in every row, or the scores cannot be lined up.
      if ((g.home === null) !== (h === null)) g.conflict = true
      g.rows.push({ row: r, homeScore: r.homeScore, awayScore: r.awayScore })
      g.otherNames.push({ source: r.source, name: h ? r.awayTeam : r.homeTeam })
      half.set(key, g)
    }
  }

  // A team in two games on one date is a mis-merge or a mis-map: send none of its games.
  const gamesPerTeamDay = new Map<string, number>()
  for (const g of full.values()) {
    for (const t of [g.home!, g.away!]) {
      const k = `${g.sport}|${g.dateKey}|${t}`
      gamesPerTeamDay.set(k, (gamesPerTeamDay.get(k) ?? 0) + 1)
    }
  }
  const games: Game[] = [...full.values()].filter(
    (g) => gamesPerTeamDay.get(`${g.sport}|${g.dateKey}|${g.home}`) === 1 && gamesPerTeamDay.get(`${g.sport}|${g.dateKey}|${g.away}`) === 1,
  )
  // A one-sided game is only used when no source named both teams — the full game already covers it.
  for (const [key, g] of half) {
    if (g.conflict || gamesPerTeamDay.has(key)) continue
    games.push(g)
  }

  const events: ScoreEvent[] = []
  for (const g of games) {
    const age = now.getTime() - g.start.getTime()
    if (age < 0) continue
    const other = displayName(g.otherNames)
    const names = g.home ? (g.away ? {} : { awayName: other }) : { homeName: other }
    const base = { sport: g.sport, dateKey: g.dateKey, home: g.home, away: g.away, ...names }
    const finals = g.rows.filter((o) => normalizeGameStatus(o.row.status) === 'final' && o.homeScore != null && o.awayScore != null)
    if (finals.length > 0) {
      if (age > FINAL_WINDOW_MS) continue
      const agreed = finals.every((o) => o.homeScore === finals[0].homeScore && o.awayScore === finals[0].awayScore)
      if (!agreed) continue
      events.push({ kind: 'final', ...base, homeScore: finals[0].homeScore!, awayScore: finals[0].awayScore! })
      continue
    }
    if (age > HALFTIME_WINDOW_MS) continue
    const half = g.rows.find((o) => o.row.source === 'espn' && espnSaysHalftime(o.row.raw) && o.homeScore != null && o.awayScore != null)
    if (half) {
      events.push({ kind: 'halftime', ...base, homeScore: half.homeScore!, awayScore: half.awayScore! })
    }
  }
  return events
}

/**
 * Claim one team's alert so no other run sends it. false = already claimed (here or on an adjacent
 * date — providers disagree on the calendar day of a TBD kickoff).
 */
async function claimTeam(e: ScoreEvent, team: string, now: Date): Promise<boolean> {
  const adjacent = [-1, 1].map((d) => ledgerKey(e.kind, e.sport, shiftDateKey(e.dateKey, d), team))
  const existing = await prisma.sportsDataCache.findFirst({ where: { cacheKey: { in: adjacent } }, select: { cacheKey: true } })
  if (existing) return false
  try {
    await prisma.sportsDataCache.create({
      data: {
        cacheKey: ledgerKey(e.kind, e.sport, e.dateKey, team),
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
  const home = e.home ? names.get(e.home) ?? e.home : e.homeName ?? 'Home'
  const away = e.away ? names.get(e.away) ?? e.away : e.awayName ?? 'Away'
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
  out.games = new Set(events.map((e) => `${e.sport}|${e.dateKey}|${e.home ?? e.homeName}|${e.away ?? e.awayName}`)).size

  for (const e of events) {
    if (input.budget?.exhausted()) break
    const teams = [e.home, e.away].filter((t): t is string => t != null)
    // Claim only teams someone follows, so a later follower is not locked out of today's alert.
    const claimed: string[] = []
    const followers = new Set<string>()
    // Followers of a team whose alert already went out (e.g. from a row that named only that team):
    // someone following both teams was told then and must not be told again now.
    const toldAlready = new Set<string>()
    let followed = false
    for (const team of teams) {
      const ids = await listFollowerIdsForTeam(e.sport, team).catch(() => null)
      if (!ids?.length) continue
      followed = true
      if (!(await claimTeam(e, team, now).catch(() => false))) {
        for (const id of ids) toldAlready.add(id)
        continue
      }
      claimed.push(team)
      // Someone following BOTH teams gets one alert, not two.
      for (const id of ids) followers.add(id)
    }
    for (const id of toldAlready) followers.delete(id)
    if (claimed.length === 0) {
      if (followed) out.alreadySent++
      continue
    }
    const allowed = await withinDailyCap([...followers], { provider: 'team_score_alerts', limit: TEAM_SCORE_ALERTS_PER_DAY })
    out.capped += followers.size - allowed.length
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
      dedupePrefix: `team-score:${e.kind}:${e.sport}:${e.dateKey}:${claimed.join('-')}`,
      meta: { sport: e.sport, home: e.home, away: e.away, homeScore: e.homeScore, awayScore: e.awayScore, kind: e.kind },
    }).catch(() => {})
    out.sent++
    out.recipients += allowed.length
  }
  return out
}
