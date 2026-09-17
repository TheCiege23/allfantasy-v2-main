import 'server-only'

import { prisma } from '@/lib/prisma'
import { leagueDisplayName } from './leagueHome'
import { NO_CAREER_FILTER, normalizeCareerSport, type CareerFilter } from './careerModel'
import { weeklyRecords, type CareerGame, type CareerRecordsData } from './careerRecordBook'

export type { CareerRecord, CareerRecordsData, CareerRival } from './careerRecordBook'

/**
 * Career records — the WEEKLY half of the record book behind
 * `/core/career?view=records`: single weeks, margins, streaks and rivalries.
 * The season, trade and draft halves are pure functions in
 * `careerRecordBook.ts`, fed by the stored profile and `careerHistory.ts`.
 *
 * ── Two tables, and why both ─────────────────────────────────────────────────
 *
 * ⚠ `MatchupFact` IS THE HISTORY; `WeeklyMatchup` IS ONLY THE LIVE SEASON. This
 * file used to read `WeeklyMatchup` alone, which is keyed on the PROVIDER league
 * id — and Sleeper issues a new id every season, so it can only ever answer for
 * the current one (2025–2026 measured). Every "career" record was really a
 * this-season record. `MatchupFact` is keyed on OUR `League.id` with historical
 * roster slots remapped to today's team, which is what lets it answer 2019.
 *
 * Merged per (league, season): a season `MatchupFact` covers is taken from there
 * only; `WeeklyMatchup` fills the seasons it does not, so the live season still
 * counts before a backfill has run for it.
 *
 * ── What each row means ─────────────────────────────────────────────────────
 *
 * ⚠ AN UNPLAYED FIXTURE IS NOT A 0-0 GAME. `MatchupFact` marks it as both scores
 * zero with no winner (ADR F2.10 policy 3); `WeeklyMatchup` as both scores zero.
 * Both are excluded — otherwise every manager on the product would carry a
 * lowest-ever week of 0.0.
 *
 * ⚠ `teamA`/`teamB` AND `rosterId` ARE PROVIDER SLOT IDS, resolved to a team
 * through `(league, externalId)` on `LeagueTeam`. They are not canonical ids.
 *
 * ⚠ THE TRADE RECORD MOVED OUT. It used to count `LeagueTrade` by league id
 * alone, and a trade history is (league, manager) — so trades logged by the
 * OTHER members of a league counted as yours. See `careerRecordBook.tradeRecords`.
 */

const EMPTY: CareerRecordsData = {
  records: [],
  weeksCounted: 0,
  leaguesCounted: 0,
  missing: [],
  rivals: [],
  weeklySeasons: [],
}

/**
 * Records the design asks for that no table can back yet, with the reason.
 * Both are real gaps in what is written, not in what is queryable.
 */
export const WEEKLY_MISSING: CareerRecordsData['missing'] = [
  {
    label: 'Most waiver adds in a season',
    section: 'seasons',
    reason:
      'waiver claims are stored per league as settings and pending claims, not as a per-manager transaction ledger we can count across seasons',
  },
  {
    label: 'Most leagues rostering one player at once',
    section: 'seasons',
    reason:
      'roster snapshots are current-state only — there is no historical roster table to ask "in week 9 of 2024, how many of my teams held him"',
  },
]

type TeamRow = {
  leagueId: string
  externalId: string
  ownerName: string | null
  teamName: string | null
  platformUserId: string | null
  claimedByUserId: string | null
}

/**
 * Your points per game against everyone's in the same league-seasons — the
 * "versus your leagues" comparison. Only league-seasons you have games in count,
 * and every team-game in them counts once.
 */
export type LeagueScoring = {
  yourPoints: number
  yourGames: number
  leaguePoints: number
  leagueTeamGames: number
  leagueSeasons: number
}

export type CareerGamesResult = { games: CareerGame[]; scoring: LeagueScoring }

const NO_GAMES: CareerGamesResult = {
  games: [],
  scoring: { yourPoints: 0, yourGames: 0, leaguePoints: 0, leagueTeamGames: 0, leagueSeasons: 0 },
}

/** Every played game of yours, facts first, live weeks filling the gaps. */
export async function loadCareerGames(userId: string, filter: CareerFilter = NO_CAREER_FILTER): Promise<CareerGamesResult> {
  const claimed = await prisma.leagueTeam
    .findMany({
      where: { claimedByUserId: userId },
      select: {
        externalId: true,
        league: { select: { id: true, name: true, platform: true, sport: true, platformLeagueId: true } },
      },
    })
    .catch(() => [])

  type LeagueInfo = { id: string; name: string; providerId: string | null; slots: Set<string> }
  const leagues = new Map<string, LeagueInfo>()
  for (const t of claimed) {
    const l = t.league
    if (!l?.id || !t.externalId) continue
    // The same three league-level fields the profile rows are filtered on.
    const platform = String(l.platform ?? 'unknown').toLowerCase()
    const sport = normalizeCareerSport(l.sport ? String(l.sport) : null)
    const leagueKey = (l.name ?? '').trim().toLowerCase()
    if (filter.platform && platform !== filter.platform) continue
    if (filter.sport && sport !== filter.sport) continue
    if (filter.league && leagueKey !== filter.league) continue
    const info = leagues.get(l.id) ?? {
      id: l.id,
      name: leagueDisplayName(l.name),
      providerId: l.platformLeagueId || null,
      slots: new Set<string>(),
    }
    info.slots.add(String(t.externalId))
    leagues.set(l.id, info)
  }
  if (leagues.size === 0) return NO_GAMES

  const leagueIds = [...leagues.keys()]
  const providerIds = [...leagues.values()].map((l) => l.providerId).filter((p): p is string => !!p)
  const leagueByProvider = new Map<string, LeagueInfo>()
  for (const l of leagues.values()) if (l.providerId) leagueByProvider.set(l.providerId, l)

  const seasonRange =
    filter.fromSeason != null || filter.toSeason != null
      ? {
          ...(filter.fromSeason != null ? { gte: filter.fromSeason } : {}),
          ...(filter.toSeason != null ? { lte: filter.toSeason } : {}),
        }
      : undefined

  type WeekRow = {
    leagueId: string
    rosterId: string
    seasonYear: number
    week: number
    matchupId: number | null
    pointsFor: number
    pointsAgainst: number
    win: number
  }

  const [facts, weeks, teams] = await Promise.all([
    prisma.matchupFact
      .findMany({
        where: { leagueId: { in: leagueIds }, ...(seasonRange ? { season: seasonRange } : {}) },
        select: {
          leagueId: true,
          season: true,
          weekOrPeriod: true,
          teamA: true,
          teamB: true,
          scoreA: true,
          scoreB: true,
          winnerTeamId: true,
        },
        // A whole sixty-league, eight-season career is ~40k games league-wide.
        take: 120_000,
      })
      .catch(() => []),
    providerIds.length
      ? prisma.weeklyMatchup
          .findMany({
            where: { leagueId: { in: providerIds }, ...(seasonRange ? { seasonYear: seasonRange } : {}) },
            select: {
              leagueId: true,
              rosterId: true,
              seasonYear: true,
              week: true,
              matchupId: true,
              pointsFor: true,
              pointsAgainst: true,
              win: true,
            },
            take: 80_000,
          })
          .catch(() => [] as WeekRow[])
      : Promise.resolve([] as WeekRow[]),
    prisma.leagueTeam
      .findMany({
        where: { leagueId: { in: leagueIds } },
        select: {
          leagueId: true,
          externalId: true,
          ownerName: true,
          teamName: true,
          platformUserId: true,
          claimedByUserId: true,
        },
      })
      .catch(() => [] as TeamRow[]),
  ])

  const teamBySlot = new Map<string, TeamRow>()
  const mySlotUserIds = new Set<string>()
  for (const t of teams) {
    teamBySlot.set(`${t.leagueId}:${t.externalId}`, t)
    if (t.claimedByUserId === userId && t.platformUserId) mySlotUserIds.add(t.platformUserId)
  }
  const opponent = (leagueId: string, slot: string): { key: string | null; name: string | null } => {
    const t = teamBySlot.get(`${leagueId}:${slot}`)
    if (t?.claimedByUserId === userId) return { key: null, name: null }
    if (t?.platformUserId && mySlotUserIds.has(t.platformUserId)) return { key: null, name: null }
    const name = t?.ownerName?.trim() || t?.teamName?.trim() || null
    if (t?.platformUserId) return { key: `u:${t.platformUserId}`, name }
    return { key: t ? `r:${leagueId}:${slot}` : null, name }
  }

  const games: CareerGame[] = []
  const factSeasons = new Set<string>()
  const leagueTotals = new Map<string, { points: number; teamGames: number }>()
  const addLeague = (k: string, points: number, teamGames: number) => {
    const held = leagueTotals.get(k) ?? { points: 0, teamGames: 0 }
    held.points += points
    held.teamGames += teamGames
    leagueTotals.set(k, held)
  }

  for (const f of facts) {
    if (f.season == null) continue
    if (f.scoreA === 0 && f.scoreB === 0 && f.winnerTeamId == null) continue
    // A zero is an eliminated or empty team, not a score — see the note on `myScore` below.
    addLeague(`${f.leagueId}:${f.season}`, f.scoreA + f.scoreB, (f.scoreA > 0 ? 1 : 0) + (f.scoreB > 0 ? 1 : 0))
    const league = leagues.get(f.leagueId)
    if (!league) continue
    const aMine = league.slots.has(String(f.teamA))
    const bMine = league.slots.has(String(f.teamB))
    if (aMine === bMine) continue
    factSeasons.add(`${f.leagueId}:${f.season}`)
    const mySlot = String(aMine ? f.teamA : f.teamB)
    const theirSlot = String(aMine ? f.teamB : f.teamA)
    const myScore = aMine ? f.scoreA : f.scoreB
    const oppScore = aMine ? f.scoreB : f.scoreA
    /*
     * ⚠ A ZERO FOR YOUR TEAM IS NOT A GAME YOU PLAYED. Measured on the production
     * copy: the "lowest single week" came back 0.0 from a guillotine league, where
     * an eliminated team keeps a fixture and scores nothing. No lineup ever set
     * scores zero in a real week; counting it would hand that manager a record
     * low and a loss streak they never played.
     */
    if (myScore <= 0) continue
    const result: CareerGame['result'] =
      f.winnerTeamId != null
        ? String(f.winnerTeamId) === mySlot
          ? 'W'
          : 'L'
        : myScore > oppScore
          ? 'W'
          : myScore < oppScore
            ? 'L'
            : 'T'
    const opp = opponent(f.leagueId, theirSlot)
    games.push({
      leagueId: f.leagueId,
      leagueName: league.name,
      season: f.season,
      week: f.weekOrPeriod,
      myScore,
      oppScore,
      result,
      oppKey: opp.key,
      oppName: opp.name,
    })
  }

  // Live weeks for the seasons no backfill has covered yet.
  const byGame = new Map<string, WeekRow[]>()
  for (const w of weeks) {
    if (w.pointsFor <= 0 && w.pointsAgainst <= 0) continue
    const league = leagueByProvider.get(w.leagueId)
    if (!league || factSeasons.has(`${league.id}:${w.seasonYear}`)) continue
    if (w.pointsFor > 0) addLeague(`${league.id}:${w.seasonYear}`, w.pointsFor, 1)
    const k = `${w.leagueId}|${w.seasonYear}|${w.week}|${w.matchupId ?? `solo:${w.rosterId}`}`
    const list = byGame.get(k)
    if (list) list.push(w)
    else byGame.set(k, [w])
  }
  for (const list of byGame.values()) {
    for (const w of list) {
      const league = leagueByProvider.get(w.leagueId)!
      if (!league.slots.has(String(w.rosterId))) continue
      if (w.pointsFor <= 0) continue
      const other = list.length === 2 ? list.find((x) => x !== w) ?? null : null
      const opp = other ? opponent(league.id, String(other.rosterId)) : { key: null, name: null }
      const result: CareerGame['result'] =
        w.win === 1 ? 'W' : w.pointsAgainst > w.pointsFor ? 'L' : w.pointsFor > w.pointsAgainst ? 'W' : 'T'
      games.push({
        leagueId: league.id,
        leagueName: league.name,
        season: w.seasonYear,
        week: w.week,
        myScore: w.pointsFor,
        oppScore: w.pointsAgainst,
        result,
        oppKey: opp.key,
        oppName: opp.name,
      })
    }
  }

  /*
   * ⚠ ONE GAME PER PROVIDER LEAGUE, WHICHEVER ROW IT CAME THROUGH. Measured on the
   * production copy: one account's 93 claimed league rows are 65 Sleeper leagues,
   * and 16 of those carry the same matchup facts under two `League.id`s (a
   * re-import beside a shadow league). Without this every one of those games —
   * and every meeting with a rival in them — counted twice.
   */
  const providerOf = (leagueId: string) => leagues.get(leagueId)?.providerId ?? leagueId
  const seenGames = new Set<string>()
  const unique = games.filter((g) => {
    const k = `${providerOf(g.leagueId)}|${g.season}|${g.week}|${g.myScore}|${g.oppScore}`
    if (seenGames.has(k)) return false
    seenGames.add(k)
    return true
  })
  games.length = 0
  games.push(...unique)
  games.sort((a, b) => a.season - b.season || a.week - b.week || a.leagueId.localeCompare(b.leagueId))

  const mineSeasons = new Set(games.map((g) => `${g.leagueId}:${g.season}`))
  const scoring: LeagueScoring = { ...NO_GAMES.scoring }
  for (const g of games) {
    scoring.yourPoints += g.myScore
    scoring.yourGames += 1
  }
  for (const [k, v] of leagueTotals) {
    if (!mineSeasons.has(k)) continue
    scoring.leaguePoints += v.points
    scoring.leagueTeamGames += v.teamGames
    scoring.leagueSeasons += 1
  }
  return { games, scoring }
}

export async function getCareerRecords(
  userId: string,
  filter: CareerFilter = NO_CAREER_FILTER,
): Promise<CareerRecordsData> {
  const { games } = await loadCareerGames(userId, filter)
  if (games.length === 0) return { ...EMPTY, missing: WEEKLY_MISSING }

  const { records, rivals } = weeklyRecords(games)

  const weeklySeasonsMap = new Map<number, { season: number; weeks: number; leagues: Set<string> }>()
  for (const g of games) {
    const held = weeklySeasonsMap.get(g.season) ?? { season: g.season, weeks: 0, leagues: new Set<string>() }
    held.weeks += 1
    held.leagues.add(g.leagueId)
    weeklySeasonsMap.set(g.season, held)
  }

  return {
    records,
    weeksCounted: games.length,
    leaguesCounted: new Set(games.map((g) => g.leagueId)).size,
    missing: WEEKLY_MISSING,
    rivals: rivals.slice(0, 12),
    weeklySeasons: [...weeklySeasonsMap.values()]
      .map((s) => ({ season: s.season, weeks: s.weeks, leagues: s.leagues.size }))
      .sort((a, b) => b.season - a.season),
  }
}
