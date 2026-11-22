import type { PrismaClient } from '@prisma/client'

import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { leagueWeekFromSettings } from '@/lib/core-app/seasonTimeline'
import { readStoredTitleGame, storedBracketGames } from '@/lib/league-import/sleeper/bracketPlacements'
import { NATIVE_PLAYER_SCORE_SOURCE, nativeSeatMap } from '@/lib/redraft/nativePlayerWeeklyScores'
import type {
  StoryData,
  StoryDraftPick,
  StoryFixture,
  StoryPlayerWeek,
  StoryPlayoffGame,
  StoryStanding,
  StoryTeam,
  TeamKey,
} from './types'

/**
 * Read one league's story data out of Postgres — never a provider (scripts/check-db-first-api-boundary.mjs).
 *
 * Two shapes of league, two sets of tables, one `StoryData`:
 *
 * IMPORTED (Sleeper, ESPN, Yahoo, MFL, Fleaflicker, …)
 *   - fixtures:     `dw_matchup_facts` — keyed on OUR League.id with historical roster slots already
 *                   remapped to today's team (lib/core-app/leagueCareer.ts records why it is the only
 *                   table that can answer across seasons). An unplayed fixture is 0-0 with no winner
 *                   and is not a result (ADR F2.10 policy 3).
 *   - teams:        `LeagueTeam` by `(leagueId, externalId)` — the team bridge every reader uses.
 *   - playoffs:     `league_dynasty_seasons.metadata.playoffStructure` — the stored winners bracket,
 *                   with `canonicalRosterIdByHistoricalRosterId` to put each season's roster ids on
 *                   today's teams. The title game is `readStoredTitleGame`, never "the last round".
 *   - player weeks: `league_player_weekly_scores`, keyed on the PROVIDER league id of each season
 *                   (Sleeper issues a new one every season) and the provider's roster id.
 *   - draft picks:  `dw_draft_facts` — `managerId` is that season's roster id.
 *
 * NATIVE (AllFantasy-hosted)
 *   - fixtures, playoffs, standings: `redraft_matchups`, `redraft_playoff_matchups`, `redraft_rosters`.
 *   - player weeks: `league_player_weekly_scores` with source 'allfantasy', which the scoring engine
 *                   writes as it scores each native matchup (lib/redraft/nativePlayerWeeklyScores.ts):
 *                   keyed on OUR League.id, `rosterId` a seat hashed from the redraft roster id. Only
 *                   FINALIZED rows are read — a live week is not a fact yet. They are read, never
 *                   recomputed here: two scoring implementations is the bug, not the fix.
 *   - draft picks:  none yet, so the draft steal stays empty for native leagues.
 *
 * ⚠ AMBIGUOUS ROSTER MAPS ARE DROPPED, NOT GUESSED. Older stored seasons can map two historical roster
 * ids onto one of today's teams (bracketPlacements.ts `storedHistoricalRosterId`). A season whose map
 * does that loses the colliding ids: attributing another manager's season to a team is worse than
 * having no hook.
 */

type Db = PrismaClient

const SOURCES_IMPORTED = {
  fixtures: 'dw_matchup_facts',
  playoffs: 'league_dynasty_seasons.playoffStructure',
  playerWeeks: 'league_player_weekly_scores',
  draftPicks: 'dw_draft_facts',
  standings: 'dw_matchup_facts (this season)',
} as const

const SOURCES_NATIVE = {
  fixtures: 'redraft_matchups',
  playoffs: 'redraft_playoff_matchups',
  playerWeeks: 'league_player_weekly_scores (allfantasy)',
  draftPicks: 'none',
  standings: 'redraft_rosters',
} as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

/** historical roster id → today's team, with any id that collides with another removed. */
export function unambiguousRosterMap(raw: unknown): Map<string, TeamKey> {
  const out = new Map<string, TeamKey>()
  if (!isRecord(raw)) return out
  const counts = new Map<string, number>()
  for (const v of Object.values(raw)) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1)
  for (const [historical, canonical] of Object.entries(raw)) {
    if ((counts.get(String(canonical)) ?? 0) > 1) continue
    out.set(String(historical), String(canonical))
  }
  return out
}

function isCompletedFact(f: { scoreA: number; scoreB: number; winnerTeamId: string | null }): boolean {
  return !(f.scoreA === 0 && f.scoreB === 0 && f.winnerTeamId == null)
}

/** Standings from this season's final games — the same rows the hooks quote, so they agree. */
export function standingsFromFixtures(fixtures: readonly StoryFixture[], season: number): StoryStanding[] {
  const by = new Map<TeamKey, StoryStanding>()
  const get = (k: TeamKey) => by.get(k) ?? (by.set(k, { team: k, wins: 0, losses: 0, ties: 0, pointsFor: 0 }), by.get(k)!)
  for (const f of fixtures) {
    if (!f.final || f.season !== season) continue
    const a = get(f.a)
    const b = get(f.b)
    a.pointsFor += f.scoreA
    b.pointsFor += f.scoreB
    if (f.scoreA === f.scoreB) {
      a.ties += 1
      b.ties += 1
    } else if (f.scoreA > f.scoreB) {
      a.wins += 1
      b.losses += 1
    } else {
      b.wins += 1
      a.losses += 1
    }
  }
  return [...by.values()]
}

export type LoadedLeague = {
  id: string
  name: string | null
  platform: string | null
  platformLeagueId: string | null
  sport: string | null
  season: number | null
  settings: unknown
}

export async function loadStoryData(prisma: Db, leagueId: string): Promise<{ league: LoadedLeague; data: StoryData } | null> {
  const league = (await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, platform: true, platformLeagueId: true, sport: true, season: true, settings: true },
  })) as LoadedLeague | null
  if (!league) return null
  const data = isNativePlatform(league.platform) ? await loadNative(prisma, league) : await loadImported(prisma, league)
  return data ? { league, data } : null
}

/* ─── Imported ──────────────────────────────────────────────────────────────────────────────── */

async function loadImported(prisma: Db, league: LoadedLeague): Promise<StoryData | null> {
  const [facts, teamRows, dynastySeasons] = await Promise.all([
    prisma.matchupFact.findMany({
      where: { leagueId: league.id },
      select: { season: true, weekOrPeriod: true, teamA: true, teamB: true, scoreA: true, scoreB: true, winnerTeamId: true },
    }),
    prisma.leagueTeam.findMany({ where: { leagueId: league.id }, select: { externalId: true, teamName: true, ownerName: true } }),
    prisma.leagueDynastySeason.findMany({
      where: { leagueId: league.id },
      select: { season: true, platformLeagueId: true, metadata: true },
    }),
  ])

  const teams = new Map<TeamKey, StoryTeam>()
  for (const t of teamRows) {
    const key = String(t.externalId ?? '')
    const label = t.teamName?.trim() || t.ownerName?.trim()
    if (key && label) teams.set(key, { key, name: label })
  }

  const season =
    league.season ?? (facts.length ? Math.max(...facts.map((f) => f.season ?? 0)) : new Date().getUTCFullYear())

  const fixtures: StoryFixture[] = facts
    .filter((f) => f.season != null)
    .map((f) => ({
      season: f.season as number,
      week: f.weekOrPeriod,
      a: String(f.teamA),
      b: String(f.teamB),
      scoreA: f.scoreA,
      scoreB: f.scoreB,
      final: isCompletedFact(f),
    }))

  // This week: the league's own marker, else the first week of this season with an unplayed game.
  const unplayed = fixtures.filter((f) => f.season === season && !f.final).map((f) => f.week)
  const marker = leagueWeekFromSettings(league.settings) ?? (unplayed.length ? Math.min(...unplayed) : null)
  /*
   * ⚠ A PLATFORM'S WEEK MARKER LAGS THE GAMES. Sleeper does not advance `current_week` until
   * Wednesday (lib/core-app/leagueWeekProgress.ts), so on a Tuesday the marker still names a week
   * whose every game is final. Hooks are for the games ahead, so a fully played marker week moves on
   * to the next week that has games.
   */
  const markerWeekGames = fixtures.filter((f) => f.season === season && f.week === marker)
  const week =
    marker != null && markerWeekGames.length > 0 && markerWeekGames.every((f) => f.final) && unplayed.some((w) => w > marker)
      ? Math.min(...unplayed.filter((w) => w > marker))
      : marker
  const matchups =
    week == null
      ? []
      : fixtures
          .filter((f) => f.season === season && f.week === week && teams.has(f.a) && teams.has(f.b) && f.a !== f.b)
          .map((f) => ({ a: f.a, b: f.b }))
  // A week whose games are already final is not "this week" any more for hooks about it.
  const lastFinal = Math.max(0, ...fixtures.filter((f) => f.season === season && f.final).map((f) => f.week))

  /* Playoffs and roster maps, per stored season. */
  const mapBySeason = new Map<number, Map<string, TeamKey>>()
  const providerIdBySeason = new Map<number, string>()
  const playoffs: StoryPlayoffGame[] = []
  for (const ds of dynastySeasons) {
    const ps = isRecord(ds.metadata) ? ds.metadata.playoffStructure : null
    const map = unambiguousRosterMap(isRecord(ps) ? ps.canonicalRosterIdByHistoricalRosterId : null)
    mapBySeason.set(ds.season, map)
    providerIdBySeason.set(ds.season, ds.platformLeagueId)
    const title = readStoredTitleGame(ps)
    for (const g of storedBracketGames(ps)) {
      if (g.w == null || g.l == null) continue
      const winner = map.get(String(g.w))
      const loser = map.get(String(g.l))
      if (!winner || !loser) continue
      playoffs.push({
        season: ds.season,
        round: g.r ?? 0,
        winner,
        loser,
        title: Boolean(title && title.championRosterId === g.w && title.runnerUpRosterId === g.l),
      })
    }
  }
  if (league.platformLeagueId) providerIdBySeason.set(season, league.platformLeagueId)
  /** This season's roster ids are today's ids unless a stored map says otherwise. */
  const toTeam = (s: number, rosterId: string | number | null | undefined): TeamKey | null => {
    if (rosterId == null) return null
    const id = String(rosterId)
    const map = mapBySeason.get(s)
    if (map && map.size > 0) return map.get(id) ?? null
    return s === season ? id : null
  }

  /* Player weeks — this season's played weeks and all of last season. */
  const playerWeeks: StoryPlayerWeek[] = []
  for (const s of [season, season - 1]) {
    const providerId = providerIdBySeason.get(s)
    if (!providerId) continue
    const rows = await prisma.leaguePlayerWeeklyScore.findMany({
      where: {
        leagueId: providerId,
        seasonYear: s,
        ...(s === season ? { week: { lte: lastFinal } } : {}),
      },
      select: { week: true, playerId: true, rosterId: true, points: true, isStarter: true },
    })
    for (const r of rows) {
      const team = toTeam(s, r.rosterId)
      if (!team) continue
      playerWeeks.push({ season: s, week: r.week, team, playerId: r.playerId, points: r.points, starter: r.isStarter })
    }
  }

  /* Draft picks for this season and last. */
  const draftRows = await prisma.draftFact.findMany({
    where: { leagueId: league.id, season: { in: [season, season - 1] } },
    select: { season: true, round: true, pickNumber: true, playerId: true, managerId: true, metadata: true },
  })
  const playerNames = new Map<string, string>()
  const draftPicks: StoryDraftPick[] = []
  for (const d of draftRows) {
    const meta = isRecord(d.metadata) ? d.metadata : null
    const snap = meta && isRecord(meta.playerSnapshot) ? meta.playerSnapshot : null
    if (snap && typeof snap.name === 'string' && snap.name.trim()) playerNames.set(d.playerId, snap.name.trim())
    const rosterKey = meta && typeof meta.selectionRosterId === 'string' ? meta.selectionRosterId : d.managerId
    const team = d.season != null ? toTeam(d.season, rosterKey) : null
    if (!team || d.season == null) continue
    draftPicks.push({ season: d.season, round: d.round, pick: d.pickNumber, team, playerId: d.playerId })
  }

  /* Names for everyone else who could appear, from our own player table. */
  const unnamed = [...new Set(playerWeeks.map((w) => w.playerId))].filter((id) => !playerNames.has(id))
  if (unnamed.length > 0) {
    const players = await prisma.sportsPlayer.findMany({
      where: { sleeperId: { in: unnamed } },
      select: { sleeperId: true, name: true },
    })
    for (const p of players) if (p.sleeperId && p.name?.trim() && !playerNames.has(p.sleeperId)) playerNames.set(p.sleeperId, p.name.trim())
  }

  return {
    leagueId: league.id,
    sport: String(league.sport ?? 'NFL'),
    season,
    week,
    teams,
    matchups,
    fixtures,
    playoffs,
    playerWeeks,
    draftPicks,
    standings: standingsFromFixtures(fixtures, season),
    playerNames,
    sources: { ...SOURCES_IMPORTED },
  }
}

/* ─── Native ────────────────────────────────────────────────────────────────────────────────── */

/** Open seats carry placeholder owner ids, which are not a person and do not carry history. */
function nativeIdentity(r: { id: string; ownerId: string }): TeamKey {
  return /^(open-slot|orphan|roster:|local-)/.test(r.ownerId) ? `roster:${r.id}` : `owner:${r.ownerId}`
}

async function loadNative(prisma: Db, league: LoadedLeague): Promise<StoryData | null> {
  const seasons = await prisma.redraftSeason.findMany({
    where: { leagueId: league.id },
    orderBy: { season: 'desc' },
    select: { id: true, season: true, currentWeek: true, sport: true },
  })
  const current = seasons[0]
  if (!current) return null

  const [rosters, matchups, playoffRows] = await Promise.all([
    prisma.redraftRoster.findMany({
      where: { leagueId: league.id },
      select: { id: true, seasonId: true, ownerId: true, ownerName: true, teamName: true, wins: true, losses: true, ties: true, pointsFor: true },
    }),
    prisma.redraftMatchup.findMany({
      where: { leagueId: league.id, isMedianMatchup: false, awayRosterId: { not: null } },
      select: { id: true, seasonId: true, week: true, status: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true },
    }),
    prisma.redraftPlayoffMatchup.findMany({
      where: { season: { leagueId: league.id }, winnerRosterId: { not: null } },
      select: {
        seasonId: true,
        homeRosterId: true,
        awayRosterId: true,
        winnerRosterId: true,
        nextMatchupId: true,
        round: { select: { roundNumber: true } },
      },
    }),
  ])

  const seasonOf = new Map(seasons.map((s) => [s.id, s.season]))
  const keyOfRoster = new Map(rosters.map((r) => [r.id, nativeIdentity(r)]))
  const teams = new Map<TeamKey, StoryTeam>()
  for (const r of rosters.filter((x) => x.seasonId === current.id)) {
    const key = nativeIdentity(r)
    const label = r.teamName?.trim() || r.ownerName?.trim()
    if (label) teams.set(key, { key, name: label })
  }

  const fixtures: StoryFixture[] = []
  for (const m of matchups) {
    const s = seasonOf.get(m.seasonId)
    const a = keyOfRoster.get(m.homeRosterId)
    const b = m.awayRosterId ? keyOfRoster.get(m.awayRosterId) : undefined
    if (s == null || !a || !b) continue
    fixtures.push({ season: s, week: m.week, a, b, scoreA: m.homeScore, scoreB: m.awayScore, final: m.status === 'final' })
  }

  // This week: the earliest week from the season's marker on that still has an unfinished game.
  const open = matchups
    .filter((m) => m.seasonId === current.id && m.status !== 'final' && m.week >= Math.max(1, current.currentWeek || 1))
    .map((m) => m.week)
  const week = open.length ? Math.min(...open) : null
  const weekMatchups =
    week == null
      ? []
      : matchups
          .filter((m) => m.seasonId === current.id && m.week === week)
          .flatMap((m) => {
            const a = keyOfRoster.get(m.homeRosterId)
            const b = m.awayRosterId ? keyOfRoster.get(m.awayRosterId) : undefined
            return a && b && teams.has(a) && teams.has(b) ? [{ a, b, matchupId: m.id }] : []
          })

  // Title game: the season's last round, only when it holds exactly one decided game.
  const lastRound = new Map<string, number>()
  for (const p of playoffRows) lastRound.set(p.seasonId, Math.max(lastRound.get(p.seasonId) ?? 0, p.round.roundNumber))
  const finalsPerSeason = new Map<string, number>()
  for (const p of playoffRows) {
    if (p.round.roundNumber === lastRound.get(p.seasonId) && !p.nextMatchupId) {
      finalsPerSeason.set(p.seasonId, (finalsPerSeason.get(p.seasonId) ?? 0) + 1)
    }
  }
  const playoffs: StoryPlayoffGame[] = []
  for (const p of playoffRows) {
    const s = seasonOf.get(p.seasonId)
    const winnerKey = p.winnerRosterId ? keyOfRoster.get(p.winnerRosterId) : undefined
    const loserId = p.winnerRosterId === p.homeRosterId ? p.awayRosterId : p.homeRosterId
    const loserKey = loserId ? keyOfRoster.get(loserId) : undefined
    if (s == null || !winnerKey || !loserKey) continue
    playoffs.push({
      season: s,
      round: p.round.roundNumber,
      winner: winnerKey,
      loser: loserKey,
      title: p.round.roundNumber === lastRound.get(p.seasonId) && !p.nextMatchupId && finalsPerSeason.get(p.seasonId) === 1,
    })
  }

  const standings: StoryStanding[] = rosters
    .filter((r) => r.seasonId === current.id)
    .map((r) => ({ team: nativeIdentity(r), wins: r.wins, losses: r.losses, ties: r.ties, pointsFor: r.pointsFor }))

  /*
   * Player weeks — this season and last, finalized rows only. A row's seat is resolved against THAT
   * season's rosters; a seat no roster of the season hashes to (or two do) is dropped, not guessed.
   */
  const recent = seasons.filter((s) => s.season === current.season || s.season === current.season - 1)
  const scoreRows = recent.length
    ? await prisma.leaguePlayerWeeklyScore.findMany({
        where: {
          leagueId: league.id,
          source: NATIVE_PLAYER_SCORE_SOURCE,
          seasonYear: { in: recent.map((s) => s.season) },
          isFinalized: true,
        },
        select: { seasonYear: true, week: true, playerId: true, rosterId: true, points: true, isStarter: true },
      })
    : []
  const seatsBySeason = new Map<number, Map<number, string>>()
  for (const s of recent) seatsBySeason.set(s.season, nativeSeatMap(rosters.filter((r) => r.seasonId === s.id).map((r) => r.id)))
  const playerWeeks: StoryPlayerWeek[] = []
  for (const r of scoreRows) {
    const rosterId = r.rosterId == null ? undefined : seatsBySeason.get(r.seasonYear)?.get(r.rosterId)
    const team = rosterId ? keyOfRoster.get(rosterId) : undefined
    if (!team) continue
    playerWeeks.push({ season: r.seasonYear, week: r.week, team, playerId: r.playerId, points: r.points, starter: r.isStarter })
  }

  /* Names from the league's own roster rows — the name the manager saw on his roster. */
  const playerNames = new Map<string, string>()
  const ids = [...new Set(playerWeeks.map((w) => w.playerId))]
  if (ids.length > 0) {
    const named = await prisma.redraftRosterPlayer.findMany({
      where: { rosterId: { in: rosters.map((r) => r.id) }, playerId: { in: ids } },
      select: { playerId: true, playerName: true },
    })
    for (const n of named) if (n.playerName?.trim() && !playerNames.has(n.playerId)) playerNames.set(n.playerId, n.playerName.trim())
  }

  return {
    leagueId: league.id,
    sport: String(current.sport ?? league.sport ?? 'NFL'),
    season: current.season,
    week,
    teams,
    matchups: weekMatchups,
    fixtures,
    playoffs,
    playerWeeks,
    draftPicks: [],
    standings,
    playerNames,
    sources: { ...SOURCES_NATIVE },
  }
}
