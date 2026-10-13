/**
 * OFFICIAL STAT CORRECTIONS, APPLIED TO WEEKS THAT ARE ALREADY FINAL.
 *
 * The NFL revises box scores for days after a game (a catch reassigned, a sack split). Before this, a
 * sealed week was never synced again (see app/api/redraft/score-sync/route.ts), so a correction that
 * arrived after the seal never reached an AllFantasy league. Now, for a league that has it on
 * (`League.settings.stat_correction_days`, default {@link DEFAULT_STAT_CORRECTION_DAYS}), a sealed week
 * is re-checked until that many days after its last game: stats are re-synced, every final matchup is
 * re-scored, and a matchup whose score moved is rewritten — which can flip a win into a loss, exactly as
 * on Sleeper or ESPN. Standings are rebuilt, the change is recorded for the league's Stat Corrections
 * screen, and the league is notified.
 *
 * 🛑 THE STAT ROW IS SHARED, SO THE DIFF IS NOT TAKEN ON STATS. `PlayerWeeklyScore` has no league; the
 * first league to re-sync a week updates it for every league, and the next league would see "no change"
 * in the stats. Each league instead compares its OWN stored result — the matchup's scores and the
 * per-player points kept in `lineupSnapshots.redraftScoring` — against a fresh score. That works no matter
 * which league refreshed the row first.
 *
 * Guards, each because getting it wrong rewrites a final result:
 *   - a matchup is rewritten only when BOTH teams re-score completely, every starter final. Incomplete
 *     data never overwrites a final score;
 *   - a commish-edited score (Edit Matchup Scores) is the commish's call and is left alone;
 *   - a commish's own stat correction for the league (leagueStatOverrides.ts) still wins over the feed;
 *   - specialty formats (guillotine chops, survivor, zombie…) are skipped: their weekly outcomes are not
 *     reversible by re-scoring. Rotisserie and category leagues are skipped too;
 *   - NFL only: it is the sport with official correction windows and week-keyed slates;
 *   - a week is re-checked at most every {@link RECHECK_INTERVAL_MS}, so the 5-minute cron does not
 *     re-sync a finished week 70 times a day;
 *   - the re-sync writes `isFinalized: false`; the rows are put back to final at once, so a sealed week
 *     never reads as open to anything else.
 */
import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { isSealedWeek } from './weekSealed'
import type { RosterScoreSummary } from './scoringEngine'

export const STAT_CORRECTION_DAYS_KEY = 'stat_correction_days'
export const DEFAULT_STAT_CORRECTION_DAYS = 3
export const MAX_STAT_CORRECTION_DAYS = 7
export const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
/** How many weeks behind the current one can still be inside a correction window. */
export const STAT_CORRECTION_LOOKBACK_WEEKS = 2
export const STAT_CORRECTION_EVENT = 'scoring.stat_correction.applied'

const DAY_MS = 24 * 60 * 60 * 1000
const EPS = 0.005

/** Days after a week's last game that corrections still apply; 0 is off. */
export function readStatCorrectionDays(settings: unknown): number {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  const raw = s[STAT_CORRECTION_DAYS_KEY]
  if (raw === undefined || raw === null || raw === '') return DEFAULT_STAT_CORRECTION_DAYS
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 && n <= MAX_STAT_CORRECTION_DAYS ? n : DEFAULT_STAT_CORRECTION_DAYS
}

export function parseStatCorrectionDays(raw: unknown): number | null {
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 && n <= MAX_STAT_CORRECTION_DAYS ? n : null
}

export type PlayerCorrection = {
  playerId: string
  playerName: string | null
  rosterId: string
  teamName: string | null
  pointsBefore: number
  pointsAfter: number
}

export type MatchupCorrection = {
  matchupId: string
  homeRosterId: string
  awayRosterId: string
  homeTeam: string | null
  awayTeam: string | null
  before: { home: number; away: number }
  after: { home: number; away: number }
  resultFlipped: boolean
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function outcome(home: number, away: number): 'home' | 'away' | 'tie' {
  return home > away ? 'home' : away > home ? 'away' : 'tie'
}

function snapshotPlayers(snapshot: unknown, side: 'home' | 'away'): Map<string, number> | null {
  const scoring = (snapshot as Record<string, any> | null)?.redraftScoring?.[side]
  const players = scoring?.players
  if (!Array.isArray(players)) return null
  return new Map(players.map((p: { playerId: string; points: number }) => [String(p.playerId), Number(p.points)]))
}

/** A fresh score usable to rewrite a final result: every starter scored, every line final. */
export function isCompleteScore(s: RosterScoreSummary): boolean {
  return s.missingPlayerIds.length === 0 && s.starterCount > 0 && s.scoredStarterCount === s.starterCount && s.allFinal
}

/**
 * What moved in one matchup, comparing the league's stored result with a fresh score. Per-player
 * detail needs a stored per-player snapshot; an older snapshot without one still reports the scores.
 * Exported for tests.
 */
export function diffMatchup(input: {
  matchupId: string
  homeRosterId: string
  awayRosterId: string
  storedHome: number
  storedAway: number
  snapshot: unknown
  home: RosterScoreSummary
  away: RosterScoreSummary
}): { changed: boolean; players: Array<Omit<PlayerCorrection, 'playerName' | 'teamName'>>; matchup: Omit<MatchupCorrection, 'homeTeam' | 'awayTeam'> } {
  const after = { home: round2(input.home.points), away: round2(input.away.points) }
  const before = { home: round2(input.storedHome), away: round2(input.storedAway) }
  const changed = Math.abs(after.home - before.home) >= EPS || Math.abs(after.away - before.away) >= EPS
  const players: Array<Omit<PlayerCorrection, 'playerName' | 'teamName'>> = []
  for (const [side, summary, rosterId] of [
    ['home', input.home, input.homeRosterId],
    ['away', input.away, input.awayRosterId],
  ] as const) {
    const stored = snapshotPlayers(input.snapshot, side)
    if (!stored) continue
    for (const p of summary.players ?? []) {
      const was = stored.get(p.playerId)
      if (was === undefined || Math.abs(was - p.points) >= EPS) {
        players.push({ playerId: p.playerId, rosterId, pointsBefore: round2(was ?? 0), pointsAfter: round2(p.points) })
      }
    }
  }
  return {
    changed,
    players,
    matchup: {
      matchupId: input.matchupId,
      homeRosterId: input.homeRosterId,
      awayRosterId: input.awayRosterId,
      before,
      after,
      resultFlipped: outcome(before.home, before.away) !== outcome(after.home, after.away),
    },
  }
}

export type StatCorrectionDeps = {
  prisma?: PrismaClient
  now?: () => Date
  syncWeekStats: (args: { seasonId: string; week: number }) => Promise<{ rateLimited?: boolean } | void>
  scoreRoster?: (args: { leagueId: string; rosterId: string; week: number; seasonYear: number }) => Promise<RosterScoreSummary>
  updateMatchup?: (matchupId: string) => Promise<unknown>
  updateStandings?: (seasonId: string, throughWeek: number) => Promise<unknown>
  readLastKickoff?: (args: { sport: string; season: number; week: number }) => Promise<string | null>
  notify?: (args: { leagueId: string; week: number; matchups: MatchupCorrection[]; players: PlayerCorrection[] }) => Promise<unknown>
  isSpecialtyFormat?: (leagueVariant: string | null) => boolean
}

export type StatCorrectionRecheckResult = {
  seasonId: string
  skipped: null | 'season_not_found' | 'not_native' | 'off' | 'sport_not_supported' | 'format_not_supported'
  weeksChecked: number[]
  matchupsChanged: number
  playersCorrected: number
}

export async function recheckStatCorrectionsForSeason(
  params: { seasonId: string; currentWeek: number },
  deps: StatCorrectionDeps,
): Promise<StatCorrectionRecheckResult> {
  const db = deps.prisma ?? (defaultPrisma as unknown as PrismaClient)
  const now = deps.now?.() ?? new Date()
  const result: StatCorrectionRecheckResult = { seasonId: params.seasonId, skipped: null, weeksChecked: [], matchupsChanged: 0, playersCorrected: 0 }

  const season = await db.redraftSeason.findFirst({
    where: { id: params.seasonId },
    select: { id: true, leagueId: true, season: true, sport: true },
  })
  if (!season) return { ...result, skipped: 'season_not_found' }
  const league = await db.league.findFirst({
    where: { id: season.leagueId },
    select: { platform: true, settings: true, leagueVariant: true },
  })
  if (!league || !isNativePlatform(league.platform)) return { ...result, skipped: 'not_native' }
  const days = readStatCorrectionDays(league.settings)
  if (days === 0) return { ...result, skipped: 'off' }
  if (String(season.sport ?? '').toUpperCase() !== 'NFL') return { ...result, skipped: 'sport_not_supported' }
  const settings = (league.settings ?? {}) as Record<string, any>
  const scoringMode = settings.scoring_mode ?? settings.scoringSettings?.scoringMode ?? 'points'
  const specialty = deps.isSpecialtyFormat
    ? deps.isSpecialtyFormat(league.leagueVariant ?? null)
    : await defaultIsSpecialtyFormat(league.leagueVariant ?? null)
  if (scoringMode !== 'points' || specialty) return { ...result, skipped: 'format_not_supported' }

  const scoreRoster = deps.scoreRoster ?? (await import('./scoringEngine')).scoreRosterForWeek
  const updateMatchup = deps.updateMatchup ?? (await import('./scoringEngine')).updateMatchupScores
  const updateStandings = deps.updateStandings ?? (await import('./standingsEngine')).updateStandings
  const readLastKickoff = deps.readLastKickoff ?? defaultReadLastKickoff(db)

  const allChanges: MatchupCorrection[] = []
  for (let week = params.currentWeek; week >= Math.max(1, params.currentWeek - STAT_CORRECTION_LOOKBACK_WEEKS); week -= 1) {
    const matchups = await db.redraftMatchup.findMany({
      where: { seasonId: season.id, week },
      select: {
        id: true,
        homeRosterId: true,
        awayRosterId: true,
        homeScore: true,
        awayScore: true,
        status: true,
        isMedianMatchup: true,
        lineupSnapshots: true,
      },
    })
    if (!isSealedWeek(matchups)) continue
    const lastKickoff = await readLastKickoff({ sport: 'NFL', season: season.season, week })
    if (!lastKickoff || now.getTime() > new Date(lastKickoff).getTime() + days * DAY_MS) continue

    // At most one re-check per week per interval: claimed BEFORE the provider call.
    const claimKey = `stat-corrections:recheck:${season.id}:${week}`
    const claim = await db.sportsDataCache.findUnique({ where: { cacheKey: claimKey }, select: { expiresAt: true } })
    if (claim && claim.expiresAt.getTime() > now.getTime()) continue
    await db.sportsDataCache.upsert({
      where: { cacheKey: claimKey },
      create: { cacheKey: claimKey, data: { at: now.toISOString() }, expiresAt: new Date(now.getTime() + RECHECK_INTERVAL_MS) },
      update: { data: { at: now.toISOString() }, expiresAt: new Date(now.getTime() + RECHECK_INTERVAL_MS) },
    })

    const synced = await deps.syncWeekStats({ seasonId: season.id, week })
    if (synced && synced.rateLimited) continue
    result.weeksChecked.push(week)

    // The re-sync un-finalized the rows; the week is sealed, so they are final again at once.
    const rosterPlayers = await db.redraftRosterPlayer.findMany({
      where: { roster: { seasonId: season.id } },
      select: { playerId: true, playerName: true, rosterId: true },
    })
    const playerIds = [...new Set(rosterPlayers.map((p) => p.playerId))]
    if (playerIds.length > 0) {
      await db.playerWeeklyScore.updateMany({
        where: { week, season: season.season, playerId: { in: playerIds }, isFinalized: false },
        data: { isFinalized: true },
      })
    }

    const weekChanges: MatchupCorrection[] = []
    const weekPlayers: PlayerCorrection[] = []
    const nameOf = new Map(rosterPlayers.map((p) => [p.playerId, p.playerName]))
    const rosterIds = [...new Set(matchups.flatMap((m) => [m.homeRosterId, m.awayRosterId].filter(Boolean) as string[]))]
    const teams = await db.redraftRoster.findMany({ where: { id: { in: rosterIds } }, select: { id: true, teamName: true, ownerName: true } })
    const teamName = (id: string) => {
      const t = teams.find((x) => x.id === id)
      return t?.teamName?.trim() || t?.ownerName?.trim() || null
    }

    for (const m of matchups) {
      if (!m.awayRosterId || m.isMedianMatchup || m.status !== 'final') continue
      const snap = (m.lineupSnapshots ?? {}) as Record<string, unknown>
      if (snap.commissionerEdit) continue
      const [home, away] = await Promise.all([
        scoreRoster({ leagueId: season.leagueId, rosterId: m.homeRosterId, week, seasonYear: season.season }),
        scoreRoster({ leagueId: season.leagueId, rosterId: m.awayRosterId, week, seasonYear: season.season }),
      ])
      if (!isCompleteScore(home) || !isCompleteScore(away)) continue
      const diff = diffMatchup({
        matchupId: m.id,
        homeRosterId: m.homeRosterId,
        awayRosterId: m.awayRosterId,
        storedHome: m.homeScore,
        storedAway: m.awayScore,
        snapshot: m.lineupSnapshots,
        home,
        away,
      })
      if (!diff.changed) continue
      await updateMatchup(m.id)
      weekChanges.push({ ...diff.matchup, homeTeam: teamName(m.homeRosterId), awayTeam: teamName(m.awayRosterId) })
      weekPlayers.push(
        ...diff.players.map((p) => ({ ...p, playerName: nameOf.get(p.playerId) ?? null, teamName: teamName(p.rosterId) })),
      )
    }

    if (weekChanges.length === 0) continue
    result.matchupsChanged += weekChanges.length
    result.playersCorrected += weekPlayers.length
    allChanges.push(...weekChanges)
    await updateStandings(season.id, Math.max(week, params.currentWeek - 1))
    await db.leagueEvent.create({
      data: {
        leagueId: season.leagueId,
        eventType: STAT_CORRECTION_EVENT,
        title: `Stat corrections — week ${week}`,
        payload: JSON.parse(
          JSON.stringify({ source: 'official', seasonId: season.id, week, matchups: weekChanges, corrections: weekPlayers }),
        ),
        visibility: 'league',
      },
    })
    await (deps.notify ?? defaultNotify)({ leagueId: season.leagueId, week, matchups: weekChanges, players: weekPlayers }).catch(
      () => undefined,
    )
  }
  return result
}

async function defaultIsSpecialtyFormat(leagueVariant: string | null): Promise<boolean> {
  if (!leagueVariant) return false
  const { getSpecialtySpecByVariant } = await import('@/lib/specialty-league/registry')
  return Boolean(getSpecialtySpecByVariant(leagueVariant))
}

function defaultReadLastKickoff(db: PrismaClient) {
  return async (args: { sport: string; season: number; week: number }) => {
    const { readWeekSlate } = await import('./weekFinalizer')
    const slate = await readWeekSlate(db, { ...args, seasonType: 'regular' })
    return slate.unfinished === 0 ? slate.lastStartTime : null
  }
}

async function defaultNotify(args: { leagueId: string; week: number; matchups: MatchupCorrection[] }) {
  const flipped = args.matchups.filter((m) => m.resultFlipped).length
  const { publishLeagueFanoutEvent } = await import('@/lib/league-events/publisher')
  await publishLeagueFanoutEvent({
    leagueId: args.leagueId,
    eventType: 'scoring_correction',
    title: `Stat corrections — week ${args.week}`,
    message:
      flipped > 0
        ? `Official stat corrections changed ${args.matchups.length} matchup score(s); ${flipped} result(s) flipped. Standings are updated.`
        : `Official stat corrections changed ${args.matchups.length} matchup score(s). Standings are updated.`,
    category: 'league_announcements',
    visibility: 'all_members',
    actorUserId: null,
    meta: { week: args.week, matchupIds: args.matchups.map((m) => m.matchupId) },
    dedupeKey: `stat_corrections:${args.leagueId}:w${args.week}:${Date.now()}`,
  })
}
