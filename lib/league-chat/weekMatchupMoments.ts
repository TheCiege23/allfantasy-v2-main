import 'server-only'

import type { PrismaClient } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { rotateForFairness, type RunBudget } from '@/lib/cron/runBudget'
import { isImportedPlatform, isNativePlatform } from '@/lib/league/isNativeLeague'
import { isScored } from '@/lib/core-app/currentWeek'
import { isEliminationFormat, pairRows, type MatchupRow } from '@/lib/core-app/weekBoard'
import { WEEK_FINALIZE_GRACE_MS, readWeekSlate } from '@/lib/redraft/weekFinalizer'
import { formatWinChance, isUpset, readOddsSnapshots } from '@/lib/share/weeklyUpset'
import { safeDisplayName } from '@/lib/chat-notifications/displayName'
import { readChimmySpeaksUp, type ChimmyMomentKind } from '@/lib/league-chat/chimmyIdentity'
import { CLOSE_FINISH_MAX_MARGIN } from '@/lib/league-chat/closeFinishRule'
import {
  chimmyMomentDedupeCacheKey,
  postChimmyMoment,
  type PostChimmyMomentResult,
} from '@/lib/league-chat/chimmyMoments'

/**
 * CLOSE FINISHES AND UPSETS — once a week's matchups are final, Chimmy says which games came down to
 * the wire and which favourites fell, in ONE post per league per week (`close_finish` / `upset`).
 *
 * Runs from the weekly-awards cron, right after the recap, inside the same run budget
 * (`runWeekMatchupMomentsSweep`). Postgres only: no provider is called anywhere in this file.
 *
 * ─── WHERE THE FINAL SCORES COME FROM (no second scorer) ────────────────────────────────────────
 *
 *   imported leagues  `WeeklyMatchup` — the table the Sleeper sync and the ESPN/Yahoo parity
 *                     collectors write, and the one the /core home's "Tuesday results review" and the
 *                     weekly-upset share card already read (lib/core-app/weekAll.ts,
 *                     lib/share/weeklyUpset.ts). Keyed on the PLATFORM league and roster ids; paired
 *                     with the week board's own `pairRows`.
 *   native leagues    `RedraftMatchup` rows the native scoring engine marks `final`
 *                     (lib/redraft/scoringEngine.ts, sealed by lib/redraft/weekFinalizer.ts).
 *
 * ⚠ The weekly RECAP itself reads Sleeper's week feed and the H2H cache (sleeperH2HService), which
 * exists only for Sleeper leagues. The recap's `narrowEscape` and this module's close finishes are the
 * same arithmetic — winner minus loser — over the same games; the threshold is shared too
 * (`CLOSE_FINISH_MAX_MARGIN` in lib/league-chat/closeFinishRule.ts, which the recap's "My call" reads).
 *
 * ─── WHEN A WEEK IS FINAL ───────────────────────────────────────────────────────────────────────
 *
 * The week in question is the latest one with any points on file, and it must be COMPLETE: every
 * paired imported row scored, or every native head-to-head `final`. Then the NFL slate for that week
 * must be over by the native finalizer's own rule (`readWeekSlate`: every game final, the last kickoff
 * at least `WEEK_FINALIZE_GRACE_MS` ago so Monday night and stat corrections have landed) and RECENT
 * (the last kickoff inside `FRESH_WEEK_MS`) — which is what stops a finished 2025 season from being
 * "news" the first Tuesday this runs in the offseason. NFL leagues only: the Tuesday cadence and the
 * slate check are both NFL-shaped.
 *
 * ─── THE SIGNALS AND THE THRESHOLDS ─────────────────────────────────────────────────────────────
 *
 * CLOSE FINISH: decided (not a tie) by at most `CLOSE_FINISH_MAX_MARGIN` = 3.0 points. Points, not a
 * percentage: the recap has called "≤ 3" the narrow escape since it was written, and two Chimmy posts
 * disagreeing about what "close" means would be worse than either threshold.
 *
 * UPSET, in order of trust:
 *   1. SAVED PRE-GAME ODDS — `matchup_odds_snapshots`, written by lib/core-app/matchupOddsSweep.ts
 *      while the week was still unplayed (never recomputed afterwards: a rebuilt number includes the
 *      game it is predicting). An upset is the repo's existing rule, `isUpset`: the winner was given
 *      at most `UPSET_MAX_WIN_PROBABILITY` (40%). When a snapshot exists it DECIDES — a 55% favourite
 *      who won is never called an upset because of the standings.
 *   2. STANDINGS AT KICKOFF — only when no snapshot exists for that game (every native league: the
 *      odds sweep reads WeeklyMatchup only; imported weeks before 2026-09-16). The record each team
 *      carried INTO the week, counted from the same final head-to-heads (weeks before this one, never
 *      the table after it): the winner must have been at least `UPSET_MIN_GAMES_BEHIND` (2) games
 *      behind the loser, with both teams at least `UPSET_MIN_GAMES_PLAYED` (3) games in, so a week-2
 *      1-0 over 0-1 is not an "upset".
 *   `RedraftMatchup.homeWinPct` / `homeProjected` exist but NOTHING writes them (census: readers only),
 *   so they are not a signal.
 *
 * A game with no nameable team on either side is left out rather than posted as "Team 4".
 */

export { CLOSE_FINISH_MAX_MARGIN }
export const UPSET_MIN_GAMES_BEHIND = 2
export const UPSET_MIN_GAMES_PLAYED = 3
/** A week whose last kickoff is older than this is history, not news. */
export const FRESH_WEEK_MS = 8 * 24 * 60 * 60 * 1000
/** Lines per section; the rest are counted, not listed. */
const MAX_PER_SECTION = 3
/** The cron fires weekly, so a different league leads each fire. */
const ROTATION_PERIOD_MS = 7 * 24 * 60 * 60 * 1000

// ─── Pure: detection ───────────────────────────────────────────────────────────────────────────

export type TeamRecord = { wins: number; losses: number; ties: number }

export type WeekSide = {
  rosterId: string
  /** A name fit for league chat, or null when nothing is on file. */
  name: string | null
  points: number
  /** This team's pre-game win probability as SAVED before kickoff, or null. */
  winProbability: number | null
  /** This team's record going into the week, or null when unknown. */
  record: TeamRecord | null
}

export type WeekGame = { a: WeekSide; b: WeekSide }

export type CloseFinish = {
  winner: string
  loser: string
  winnerPoints: number
  loserPoints: number
  margin: number
}

export type Upset =
  | (CloseFinish & { signal: 'saved_odds'; winProbability: number })
  | (CloseFinish & { signal: 'standings'; winnerRecord: TeamRecord; loserRecord: TeamRecord; gamesBehind: number })

export type WeekMoments = {
  season: number
  week: number
  closeFinishes: CloseFinish[]
  upsets: Upset[]
}

const round2 = (n: number) => Math.round(n * 100) / 100

function played(r: TeamRecord): number {
  return r.wins + r.losses + r.ties
}

/** Games the winner trailed the loser by, going in. A tie counts half a win and half a loss. */
export function gamesBehind(winner: TeamRecord, loser: TeamRecord): number {
  const w = { won: winner.wins + winner.ties / 2, lost: winner.losses + winner.ties / 2 }
  const l = { won: loser.wins + loser.ties / 2, lost: loser.losses + loser.ties / 2 }
  return (l.won - w.won + (w.lost - l.lost)) / 2
}

/** The close finishes and upsets in one final week. PURE. */
export function detectWeekMoments(season: number, week: number, games: readonly WeekGame[]): WeekMoments {
  const closeFinishes: CloseFinish[] = []
  const upsets: Upset[] = []
  for (const g of games) {
    if (!Number.isFinite(g.a.points) || !Number.isFinite(g.b.points)) continue
    if (g.a.points <= 0 && g.b.points <= 0) continue
    const [w, l] = g.a.points > g.b.points ? [g.a, g.b] : [g.b, g.a]
    const margin = round2(w.points - l.points)
    if (margin <= 0) continue // a tie was not decided by anything
    if (!w.name || !l.name) continue
    const base: CloseFinish = { winner: w.name, loser: l.name, winnerPoints: w.points, loserPoints: l.points, margin }

    // 1. Saved odds decide whenever they exist — the winner's own row, else the complement of the loser's.
    const odds =
      w.winProbability != null && Number.isFinite(w.winProbability)
        ? w.winProbability
        : l.winProbability != null && Number.isFinite(l.winProbability)
          ? 1 - l.winProbability
          : null
    let upset: Upset | null = null
    if (odds != null) {
      if (isUpset({ pointsFor: w.points, pointsAgainst: l.points, won: true }, odds)) {
        upset = { ...base, signal: 'saved_odds', winProbability: odds }
      }
    } else if (w.record && l.record && played(w.record) >= UPSET_MIN_GAMES_PLAYED && played(l.record) >= UPSET_MIN_GAMES_PLAYED) {
      // 2. No saved odds for this game: the standings each team carried into it.
      const gb = gamesBehind(w.record, l.record)
      if (gb >= UPSET_MIN_GAMES_BEHIND) upset = { ...base, signal: 'standings', winnerRecord: w.record, loserRecord: l.record, gamesBehind: gb }
    }

    if (upset) upsets.push(upset)
    else if (margin <= CLOSE_FINISH_MAX_MARGIN) closeFinishes.push(base)
  }
  closeFinishes.sort((x, y) => x.margin - y.margin)
  upsets.sort((x, y) => {
    const ox = x.signal === 'saved_odds' ? x.winProbability : 1
    const oy = y.signal === 'saved_odds' ? y.winProbability : 1
    if (ox !== oy) return ox - oy
    const gx = x.signal === 'standings' ? x.gamesBehind : 0
    const gy = y.signal === 'standings' ? y.gamesBehind : 0
    return gy - gx || x.margin - y.margin
  })
  return { season, week, closeFinishes, upsets }
}

// ─── Pure: the words ───────────────────────────────────────────────────────────────────────────

/** Deterministic per league-week, so a re-render or a retry says the same thing. */
function pick<T>(pool: readonly T[], seed: string): T {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return pool[h % pool.length]!
}

function score(g: CloseFinish): string {
  // A margin under a tenth needs the second decimal, or "101.2–101.2" reads as a tie.
  const d = g.margin < 0.1 ? 2 : 1
  return `${g.winnerPoints.toFixed(d)}–${g.loserPoints.toFixed(d)}`
}

function marginText(m: number): string {
  return m < 0.1 ? m.toFixed(2) : m.toFixed(1)
}

function recordText(r: TeamRecord): string {
  return r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`
}

function upsetLine(u: Upset): string {
  if (u.signal === 'saved_odds') {
    return `${u.winner} beat ${u.loser} ${score(u)} as a ${formatWinChance(u.winProbability)} underdog.`
  }
  return `${u.winner} (${recordText(u.winnerRecord)} going in) took down ${u.loser} (${recordText(u.loserRecord)}), ${score(u)}.`
}

function closeLine(c: CloseFinish): string {
  return `${c.winner} edged ${c.loser} by ${marginText(c.margin)}, ${score(c)}.`
}

/**
 * What Chimmy says: the upsets first (the post is labelled "Upset" when there are any), then the close
 * finishes, each with the real score. '' when the week had neither. PURE.
 */
export function buildWeekMomentsText(moments: WeekMoments, seed: string): string {
  const { week, upsets, closeFinishes } = moments
  if (upsets.length === 0 && closeFinishes.length === 0) return ''
  const s = `${seed}:${moments.season}:${week}`
  const lines: string[] = [
    upsets.length > 0
      ? pick([`Week ${week}: not every favorite held.`, `Week ${week} had upsets, and I have the receipts.`], `${s}:head`)
      : pick([`Week ${week} came down to the wire.`, `Week ${week} had some nail-biters.`], `${s}:head`),
  ]
  if (upsets.length > 0) {
    lines.push('', upsets.length === 1 ? '😱 Upset' : '😱 Upsets')
    lines.push(...upsets.slice(0, MAX_PER_SECTION).map((u) => `  ${upsetLine(u)}`))
    if (upsets.length > MAX_PER_SECTION) lines.push(`  …and ${upsets.length - MAX_PER_SECTION} more.`)
  }
  if (closeFinishes.length > 0) {
    lines.push('', closeFinishes.length === 1 ? '⏱️ Close finish' : '⏱️ Close finishes')
    lines.push(...closeFinishes.slice(0, MAX_PER_SECTION).map((c) => `  ${closeLine(c)}`))
    if (closeFinishes.length > MAX_PER_SECTION) {
      lines.push(`  …and ${closeFinishes.length - MAX_PER_SECTION} more decided by ${CLOSE_FINISH_MAX_MARGIN} points or less.`)
    }
  }
  lines.push(
    '',
    upsets.length > 0
      ? pick(['That is why they play the games.', 'Pre-game odds do not score points. Rosters do.'], `${s}:close`)
      : pick(['Survive and advance.', 'A win is a win. Bank it.'], `${s}:close`),
  )
  return lines.join('\n')
}

/** The kind the combined post goes out under — whatever it leads with. */
export function weekMomentsKind(moments: WeekMoments): ChimmyMomentKind {
  return moments.upsets.length > 0 ? 'upset' : 'close_finish'
}

export function weekMomentsDedupeKey(season: number, week: number): string {
  return `wk:${season}:${week}`
}

// ─── Pure: which week is final, and the records going into it ──────────────────────────────────

type ImportedRow = Pick<MatchupRow, 'week' | 'rosterId' | 'matchupId' | 'pointsFor' | 'pointsAgainst' | 'win'>

/**
 * The latest week with any points on file, when EVERY paired row of it is scored; otherwise null
 * (the week is still being played). A row without an opponent (`matchupId` null) is not a matchup.
 */
export function latestCompleteImportedWeek(rows: readonly ImportedRow[]): number | null {
  const paired = rows.filter((r) => r.matchupId != null)
  let latest: number | null = null
  for (const r of paired) if (isScored(r) && (latest == null || r.week > latest)) latest = r.week
  if (latest == null) return null
  const week = latest
  return paired.filter((r) => r.week === week).every((r) => isScored(r)) ? week : null
}

/** Each roster's W-L-T from these head-to-heads. */
export function recordsFrom(pairs: ReadonlyArray<{ a: { rosterId: string; points: number }; b: { rosterId: string; points: number } }>): Map<string, TeamRecord> {
  const out = new Map<string, TeamRecord>()
  const rec = (id: string) => {
    const r = out.get(id) ?? { wins: 0, losses: 0, ties: 0 }
    out.set(id, r)
    return r
  }
  for (const { a, b } of pairs) {
    if (a.points <= 0 && b.points <= 0) continue
    if (a.points > b.points) {
      rec(a.rosterId).wins += 1
      rec(b.rosterId).losses += 1
    } else if (b.points > a.points) {
      rec(b.rosterId).wins += 1
      rec(a.rosterId).losses += 1
    } else {
      rec(a.rosterId).ties += 1
      rec(b.rosterId).ties += 1
    }
  }
  return out
}

type NativeMatchupRow = {
  week: number
  type: string | null
  homeRosterId: string
  awayRosterId: string | null
  homeScore: number
  awayScore: number
  status: string
  isMedianMatchup: boolean | null
}

/**
 * The latest native week whose every head-to-head is `final`, provided no later week has started.
 * Median-game rows and byes (no away roster) are not head-to-heads.
 */
export function latestFinalNativeWeek(matchups: readonly NativeMatchupRow[]): number | null {
  const h2h = matchups.filter((m) => m.awayRosterId && !m.isMedianMatchup)
  const started = (m: NativeMatchupRow) => m.status === 'final' || m.status === 'active' || m.homeScore > 0 || m.awayScore > 0
  const weeks = [...new Set(h2h.map((m) => m.week))].sort((x, y) => x - y)
  let target: number | null = null
  for (const w of weeks) {
    const rows = h2h.filter((m) => m.week === w)
    if (rows.length > 0 && rows.every((m) => m.status === 'final')) target = w
  }
  if (target == null) return null
  const t = target
  return h2h.some((m) => m.week > t && started(m)) ? null : t
}

// ─── Reading one league's final week (Postgres only) ───────────────────────────────────────────

const LEAGUE_SELECT = {
  id: true,
  name: true,
  platform: true,
  platformLeagueId: true,
  sport: true,
  leagueType: true,
  settings: true,
} as const

export type MomentLeague = {
  id: string
  name: string | null
  platform: string | null
  platformLeagueId: string | null
  sport: unknown
  leagueType: string | null
  settings: unknown
}

export type WeekMomentUnit =
  | { source: 'imported'; league: MomentLeague; platformLeagueId: string; season: number }
  | { source: 'native'; league: MomentLeague; seasonId: string; season: number }

type LoadedWeek = { season: number; week: number; games: WeekGame[] }

function publicName(...candidates: Array<string | null | undefined>): string | null {
  const name = safeDisplayName(candidates, '')
  return name ? name : null
}

async function loadImportedWeek(unit: Extract<WeekMomentUnit, { source: 'imported' }>): Promise<LoadedWeek | null> {
  const pid = unit.platformLeagueId
  const raw = await prisma.weeklyMatchup.findMany({
    where: { leagueId: pid, seasonYear: unit.season },
    select: { week: true, rosterId: true, matchupId: true, pointsFor: true, pointsAgainst: true, win: true },
  })
  const rows: MatchupRow[] = raw.map((r) => ({ ...r, leagueId: pid, seasonYear: unit.season }))
  const week = latestCompleteImportedWeek(rows)
  if (week == null) return null

  const pairs = pairRows(rows)
  const side = (r: MatchupRow) => ({ rosterId: r.rosterId, points: r.pointsFor })
  const records = recordsFrom(pairs.filter((p) => p.week < week).map((p) => ({ a: side(p.a), b: side(p.b) })))
  const weekPairs = pairs.filter((p) => p.week === week)
  if (weekPairs.length === 0) return null
  const rosterIds = [...new Set(weekPairs.flatMap((p) => [p.a.rosterId, p.b.rosterId]))]

  const [teams, snapshots] = await Promise.all([
    prisma.leagueTeam.findMany({
      where: { leagueId: unit.league.id, externalId: { in: rosterIds } },
      select: { externalId: true, teamName: true, ownerName: true },
    }),
    // Unreadable odds are no odds — the standings fallback then speaks, and says it is standings.
    readOddsSnapshots(rosterIds.map((rosterId) => ({ leagueId: pid, rosterId })), unit.season, week).catch(() => []),
  ])
  const nameOf = new Map(teams.map((t) => [t.externalId, publicName(t.teamName, t.ownerName)]))
  const oddsOf = new Map(snapshots.map((s) => [s.rosterId, s.winProbability]))
  const toSide = (r: MatchupRow): WeekSide => ({
    rosterId: r.rosterId,
    name: nameOf.get(r.rosterId) ?? null,
    points: r.pointsFor,
    winProbability: oddsOf.get(r.rosterId) ?? null,
    record: records.get(r.rosterId) ?? { wins: 0, losses: 0, ties: 0 },
  })
  return { season: unit.season, week, games: weekPairs.map((p) => ({ a: toSide(p.a), b: toSide(p.b) })) }
}

async function loadNativeWeek(unit: Extract<WeekMomentUnit, { source: 'native' }>): Promise<LoadedWeek | null> {
  const matchups = (await prisma.redraftMatchup.findMany({
    where: { seasonId: unit.seasonId },
    select: {
      week: true,
      type: true,
      homeRosterId: true,
      awayRosterId: true,
      homeScore: true,
      awayScore: true,
      status: true,
      isMedianMatchup: true,
    },
  })) as NativeMatchupRow[]
  const week = latestFinalNativeWeek(matchups)
  if (week == null) return null

  const h2h = matchups.filter((m) => m.awayRosterId && !m.isMedianMatchup)
  // Standings at kickoff: regular-season head-to-heads already final before this week.
  const before = h2h.filter(
    (m) => m.week < week && m.status === 'final' && (m.type == null || m.type === 'regular'),
  )
  const records = recordsFrom(
    before.map((m) => ({ a: { rosterId: m.homeRosterId, points: m.homeScore }, b: { rosterId: m.awayRosterId as string, points: m.awayScore } })),
  )
  const weekGames = h2h.filter((m) => m.week === week)
  const rosters = await prisma.redraftRoster.findMany({
    where: { seasonId: unit.seasonId },
    select: { id: true, teamName: true, ownerName: true },
  })
  const nameOf = new Map(rosters.map((r) => [r.id, publicName(r.teamName, r.ownerName)]))
  const toSide = (rosterId: string, points: number): WeekSide => ({
    rosterId,
    name: nameOf.get(rosterId) ?? null,
    points,
    // No saved odds exist for a native league (the odds sweep reads WeeklyMatchup only).
    winProbability: null,
    record: records.get(rosterId) ?? { wins: 0, losses: 0, ties: 0 },
  })
  return {
    season: unit.season,
    week,
    games: weekGames.map((m) => ({ a: toSide(m.homeRosterId, m.homeScore), b: toSide(m.awayRosterId as string, m.awayScore) })),
  }
}

/** Slate reads are per NFL season-week, not per league: one read serves every league in a fire. */
export type SlateCache = Map<string, Promise<boolean>>

/** The NFL week is over (every game final, past the finalizer's grace) and recent enough to be news. */
async function nflWeekIsOverAndFresh(season: number, week: number, now: Date, cache: SlateCache): Promise<boolean> {
  const key = `${season}:${week}`
  let hit = cache.get(key)
  if (!hit) {
    hit = readWeekSlate(prisma as unknown as PrismaClient, { sport: 'NFL', season, week, seasonType: 'regular', now })
      .then((slate) => {
        if (slate.games === 0 || slate.unfinished > 0 || !slate.lastStartTime) return false
        const last = Date.parse(slate.lastStartTime)
        if (!Number.isFinite(last)) return false
        const age = now.getTime() - last
        return age >= WEEK_FINALIZE_GRACE_MS && age <= FRESH_WEEK_MS
      })
      .catch(() => false)
    cache.set(key, hit)
  }
  return hit
}

export type WeekMomentOutcome =
  | PostChimmyMomentResult
  | { posted: false; reason: 'disabled' | 'not_nfl' | 'not_head_to_head' | 'not_final' | 'no_moments' }

function isNfl(sport: unknown): boolean {
  return String(sport ?? '').toUpperCase() === 'NFL'
}

/**
 * One league's week: read it, decide it, post it — at most once per league per week. Never throws.
 */
export async function postWeekMatchupMoments(
  unit: WeekMomentUnit,
  opts: { now?: Date; slateCache?: SlateCache } = {},
): Promise<WeekMomentOutcome> {
  const now = opts.now ?? new Date()
  const league = unit.league
  try {
    // Cheapest refusals first: a switched-off league costs no reads at all.
    if (!readChimmySpeaksUp(league.settings)) return { posted: false, reason: 'disabled' }
    if (!isNfl(league.sport)) return { posted: false, reason: 'not_nfl' }
    if (isEliminationFormat(league.leagueType)) return { posted: false, reason: 'not_head_to_head' }

    const loaded = unit.source === 'imported' ? await loadImportedWeek(unit) : await loadNativeWeek(unit)
    if (!loaded) return { posted: false, reason: 'not_final' }
    if (!(await nflWeekIsOverAndFresh(loaded.season, loaded.week, now, opts.slateCache ?? new Map()))) {
      return { posted: false, reason: 'not_final' }
    }

    const moments = detectWeekMoments(loaded.season, loaded.week, loaded.games)
    const text = buildWeekMomentsText(moments, league.id)
    if (!text) return { posted: false, reason: 'no_moments' }

    /*
     * ONE POST PER LEAGUE PER WEEK, whichever kind it leads with. The helper dedupes per kind, so a
     * week posted as `close_finish` must also stop a later read that found an upset (odds that landed
     * late) from posting again as `upset`: both keys are checked first.
     */
    const dedupeKey = weekMomentsDedupeKey(loaded.season, loaded.week)
    const keys = (['close_finish', 'upset'] as const).map((k) => chimmyMomentDedupeCacheKey(league.id, k, dedupeKey))
    const already = await prisma.sportsDataCache.findMany({
      where: { cacheKey: { in: keys }, expiresAt: { gt: now } },
      select: { cacheKey: true },
    })
    if (already.length > 0) return { posted: false, reason: 'duplicate' }

    return await postChimmyMoment({
      leagueId: league.id,
      kind: weekMomentsKind(moments),
      dedupeKey,
      text,
      card: {
        weekMoments: {
          v: 1,
          season: moments.season,
          week: moments.week,
          closeFinishes: moments.closeFinishes,
          upsets: moments.upsets,
        },
      },
      messageType: 'system',
      now,
    })
  } catch (e) {
    console.warn('[weekMatchupMoments] league week failed', {
      error: e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : typeof e,
    })
    return { posted: false, reason: 'error' }
  }
}

// ─── The sweep the weekly-awards cron runs ─────────────────────────────────────────────────────

/** The leagues that could have a final week: imported NFL leagues on WeeklyMatchup, native NFL seasons with a final matchup. */
export async function listWeekMomentUnits(now: Date = new Date()): Promise<WeekMomentUnit[]> {
  const units: WeekMomentUnit[] = []

  const latest = await prisma.weeklyMatchup.aggregate({ _max: { seasonYear: true } })
  const season = latest._max.seasonYear ?? null
  if (season != null) {
    const grouped = await prisma.weeklyMatchup.groupBy({ by: ['leagueId'], where: { seasonYear: season } })
    const pids = grouped.map((g) => g.leagueId).filter((id): id is string => Boolean(id))
    if (pids.length > 0) {
      const leagues = (await prisma.league.findMany({
        where: { platformLeagueId: { in: pids }, sport: 'NFL' },
        select: LEAGUE_SELECT,
      })) as MomentLeague[]
      for (const l of leagues) {
        if (!l.platformLeagueId || !isImportedPlatform(l.platform)) continue
        units.push({ source: 'imported', league: l, platformLeagueId: l.platformLeagueId, season })
      }
    }
  }

  // The NFL season a date belongs to: January's playoffs are still last year's season.
  const nflSeason = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).getUTCFullYear()
  const seasons = (await prisma.redraftSeason.findMany({
    where: {
      season: { gte: nflSeason },
      sport: { equals: 'NFL', mode: 'insensitive' },
      schedule: { some: { status: 'final' } },
    },
    orderBy: { season: 'desc' },
    select: { id: true, season: true, leagueId: true, league: { select: LEAGUE_SELECT } },
  })) as Array<{ id: string; season: number; leagueId: string; league: MomentLeague | null }>
  const seen = new Set<string>()
  for (const s of seasons) {
    if (!s.league || seen.has(s.leagueId) || !isNativePlatform(s.league.platform)) continue
    seen.add(s.leagueId)
    units.push({ source: 'native', league: s.league, seasonId: s.id, season: s.season })
  }
  return units
}

export type WeekMomentsSweepCounts = {
  leagues: number
  posted: number
  noMoments: number
  notFinal: number
  duplicate: number
  disabled: number
  dailyCap: number
  skipped: number
  failed: number
  skippedForTime: number
}

/**
 * Walk every candidate league, rotated so a different one leads each week, and stop the moment the
 * shared cron budget is spent — the leftover is reported, never silently dropped.
 */
export async function runWeekMatchupMomentsSweep(deps: { budget: RunBudget; now?: Date }): Promise<WeekMomentsSweepCounts> {
  const now = deps.now ?? new Date()
  const counts: WeekMomentsSweepCounts = {
    leagues: 0,
    posted: 0,
    noMoments: 0,
    notFinal: 0,
    duplicate: 0,
    disabled: 0,
    dailyCap: 0,
    skipped: 0,
    failed: 0,
    skippedForTime: 0,
  }
  let units: WeekMomentUnit[]
  try {
    units = await listWeekMomentUnits(now)
  } catch {
    counts.failed += 1
    return counts
  }
  counts.leagues = units.length
  const ordered = rotateForFairness(units, ROTATION_PERIOD_MS, () => now.getTime())
  const slateCache: SlateCache = new Map()
  for (let i = 0; i < ordered.length; i += 1) {
    if (deps.budget.exhausted()) {
      counts.skippedForTime = ordered.length - i
      break
    }
    const r = await postWeekMatchupMoments(ordered[i]!, { now, slateCache })
    if (r.posted) counts.posted += 1
    else if (r.reason === 'no_moments') counts.noMoments += 1
    else if (r.reason === 'not_final') counts.notFinal += 1
    else if (r.reason === 'duplicate') counts.duplicate += 1
    else if (r.reason === 'disabled') counts.disabled += 1
    else if (r.reason === 'daily_cap') counts.dailyCap += 1
    else if (r.reason === 'error') counts.failed += 1
    else counts.skipped += 1
  }
  return counts
}
