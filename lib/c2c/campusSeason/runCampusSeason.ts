/**
 * Runs the college side of an NFL C2C league in the "separate" standings model (owner's decision,
 * 2026-11-24). One tick, from the score-sync cron:
 *
 *  1. creates the college season and its regular-season schedule once the pro season has teams (the same
 *     generator as the pro side: divisions, games per week, odd-team byes);
 *  2. scores every college week that has kicked off, from the CFBD college week itself, using each team's
 *     campus lineup as saved for the NFL week that college week falls in (lib/c2c/footballCampusWeekSnapshot);
 *  3. seals a week 48 hours after its last kickoff;
 *  4. rebuilds the college standings (median included when the league plays one);
 *  5. seeds and plays the college playoff, and crowns the college champion.
 *
 * Rules live in ./campusSeasonRules.ts (pure). Nothing here touches the pro side's tables.
 */
import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { collegeLineupSport, DEVY_COLLEGE_SCORING_KEY, isScoringDevyLeague } from '@/lib/c2c/collegeLineupLeague'
import { campusPointsForCfbWeek } from '@/lib/c2c/campusScoring'
import { cfbWeeksByNflWeek } from '@/lib/c2c/campusWeeks'
import { getC2CConfig } from '@/lib/merged-devy-c2c/C2CLeagueConfig'
import { generateSchedule } from '@/lib/redraft/scheduleEngine'
import { readGamesPerWeek } from '@/lib/schedule-runtime/gamesPerWeek'
import { statedMedianGame } from '@/lib/core-app/medianGame'
import { loadSeasonRosterDivisions } from '@/lib/league/divisions/loadLeagueDivisions'
import {
  campusBracketRound,
  campusPlayoffWinner,
  computeCampusStandings,
  readCampusSeasonShape,
  type CampusGame,
} from './campusSeasonRules'

const SEAL_AFTER_MS = 48 * 60 * 60 * 1000

export type CampusTickResult =
  | { status: 'skipped'; reason: string }
  | { status: 'ok'; created: boolean; weeksScored: number[]; weeksSealed: number[]; playoffRoundCreated: number | null; championRosterId: string | null }

type Db = PrismaClient

export type CollegeWeek = { week: number; firstStart: number; lastStart: number }

/** College weeks of a season from the CFBD regular-season schedule, and the NFL week each one falls in. */
export async function loadCollegeCalendar(db: Pick<PrismaClient, 'sportsGame'>, season: number): Promise<{ weeks: Map<number, CollegeWeek>; nflWeekOf: (cfbWeek: number) => number }> {
  const [cfb, nfl] = await Promise.all([
    db.sportsGame.findMany({ where: { sport: 'NCAAF', source: 'cfbd', season, seasonType: 'regular' }, select: { week: true, startTime: true } }),
    db.sportsGame.findMany({ where: { sport: { in: ['NFL', 'nfl'] }, season, OR: [{ seasonType: 'regular' }, { seasonType: null }] }, select: { week: true, startTime: true } }),
  ])
  const weeks = new Map<number, CollegeWeek>()
  for (const g of cfb) {
    if (g.week == null || g.startTime == null) continue
    const t = new Date(g.startTime).getTime()
    if (!Number.isFinite(t)) continue
    const w = weeks.get(g.week) ?? { week: g.week, firstStart: t, lastStart: t }
    w.firstStart = Math.min(w.firstStart, t)
    w.lastStart = Math.max(w.lastStart, t)
    weeks.set(g.week, w)
  }
  const nflOf = new Map<number, number>()
  for (const [nflWeek, cfbWeeks] of cfbWeeksByNflWeek(nfl, cfb)) for (const c of cfbWeeks) nflOf.set(c, nflWeek)
  // A college week before NFL week 1 (late August) uses the week-1 lineup; one after the NFL calendar
  // known so far uses the latest NFL week on file.
  const lastNfl = Math.max(1, ...nflOf.values())
  const nflWeekOf = (cfbWeek: number) => {
    const known = nflOf.get(cfbWeek)
    if (known != null) return known
    const earlier = [...nflOf.entries()].filter(([c]) => c < cfbWeek).map(([, n]) => n)
    return earlier.length ? Math.max(...earlier) : Math.min(1, lastNfl)
  }
  return { weeks, nflWeekOf }
}

const toGame = (m: { week: number; homeRosterId: string; awayRosterId: string | null; homeScore: number; awayScore: number; status: string; kind: string }): CampusGame => ({ ...m })

/** One tick for one league. Safe to run repeatedly; every step is idempotent. */
export async function runCampusSeasonTick(leagueId: string, opts: { now?: Date; db?: Db } = {}): Promise<CampusTickResult> {
  const db = opts.db ?? defaultPrisma
  const now = (opts.now ?? new Date()).getTime()

  const league = await db.league.findUnique({ where: { id: leagueId }, select: { id: true, platform: true, sport: true, leagueVariant: true, leagueType: true, settings: true } })
  if (!league || !isNativePlatform(league.platform) || collegeLineupSport(league) !== 'football') return { status: 'skipped', reason: 'not a native NFL C2C or scoring devy league' }
  // A scoring devy league always plays its college lineup as its own season; C2C only on "separate".
  if (!isScoringDevyLeague(league)) {
    const config = await getC2CConfig(leagueId).catch(() => null)
    if (config?.standingsModel !== 'separate') return { status: 'skipped', reason: 'standings model is not separate' }
  }

  const proSeason = await db.redraftSeason.findFirst({ where: { leagueId }, orderBy: { season: 'desc' }, select: { id: true, season: true, medianGame: true } })
  if (!proSeason) return { status: 'skipped', reason: 'no season yet' }
  const rosters = await db.redraftRoster.findMany({ where: { seasonId: proSeason.id }, select: { id: true, ownerId: true }, orderBy: { id: 'asc' } })
  if (rosters.length < 2) return { status: 'skipped', reason: 'fewer than two teams' }

  const shape = readCampusSeasonShape(league.settings, rosters.length)
  const medianGame = statedMedianGame(league.settings) ?? proSeason.medianGame === true

  // 1. The season and its regular-season schedule, once.
  let campus = await db.c2CCampusSeason.findUnique({ where: { leagueId_season: { leagueId, season: proSeason.season } } })
  let created = false
  if (!campus) {
    const divisions = await loadSeasonRosterDivisions(leagueId, rosters).catch(() => null)
    const slots = generateSchedule(rosters, shape.regularSeasonWeeks, shape.regularSeasonWeeks + 1, 'NCAAF', {
      medianGame: false,
      divisionByRoster: divisions?.byRoster ?? null,
      divisionRivalsTwice: divisions?.rivalsTwice === true,
      gamesPerWeek: readGamesPerWeek(league.settings),
    }).filter((s) => s.type !== 'median' && s.week <= shape.regularSeasonWeeks)
    campus = await db.c2CCampusSeason.create({
      data: {
        leagueId,
        season: proSeason.season,
        redraftSeasonId: proSeason.id,
        regularSeasonWeeks: shape.regularSeasonWeeks,
        playoffTeams: shape.playoffTeams,
        matchups: {
          create: slots.map((s) => ({ week: s.week, homeRosterId: s.home, awayRosterId: s.away, kind: s.away ? 'regular' : 'bye' })),
        },
      },
    })
    created = true
  }

  const { weeks, nflWeekOf } = await loadCollegeCalendar(db, proSeason.season)

  // 2-3. Score every week that has kicked off and is not sealed; seal 48 hours after its last kickoff.
  const open = await db.c2CCampusMatchup.findMany({ where: { campusSeasonId: campus.id, status: { not: 'final' } }, orderBy: [{ week: 'asc' }] })
  const weeksScored = new Set<number>()
  const weeksSealed = new Set<number>()
  for (const m of open) {
    const cal = weeks.get(m.week)
    if (!cal || cal.firstStart > now) continue
    const seal = now >= cal.lastStart + SEAL_AFTER_MS
    const points = await campusPointsForCfbWeek(db as never, {
      season: proSeason.season,
      cfbWeek: m.week,
      snapshotNflWeek: nflWeekOf(m.week),
      homeRosterId: m.homeRosterId,
      awayRosterId: m.awayRosterId ?? m.homeRosterId,
    })
    await db.c2CCampusMatchup.update({
      where: { id: m.id },
      data: {
        homeScore: points?.home.points ?? 0,
        awayScore: m.awayRosterId ? points?.away.points ?? 0 : 0,
        status: seal ? 'final' : 'active',
        detail: points ? ({ cfbWeeks: points.cfbWeeks, home: points.home, ...(m.awayRosterId ? { away: points.away } : {}) } as object) : undefined,
      },
    })
    weeksScored.add(m.week)
    if (seal) weeksSealed.add(m.week)
  }

  // 4. Standings from every final regular-season game.
  const all = (await db.c2CCampusMatchup.findMany({ where: { campusSeasonId: campus.id } })).map((m) => ({ ...toGame(m), playoffRound: m.playoffRound }))
  const rosterIds = rosters.map((r) => r.id)
  const standings = computeCampusStandings({ rosterIds, games: all, medianGame })
  const regular = all.filter((g) => g.kind !== 'playoff')
  const regularDone = regular.length > 0 && regular.every((g) => g.status === 'final')
  const seeded = regularDone && shape.playoffTeams >= 2 ? standings.slice(0, shape.playoffTeams).map((r) => r.rosterId) : []
  for (const row of standings) {
    const seed = seeded.indexOf(row.rosterId)
    const data = {
      wins: row.wins, losses: row.losses, ties: row.ties,
      medianWins: row.medianWins, medianLosses: row.medianLosses, medianTies: row.medianTies,
      pointsFor: row.pointsFor, pointsAgainst: row.pointsAgainst, rank: row.rank, seed: seed >= 0 ? seed + 1 : null,
    }
    await db.c2CCampusStanding.upsert({
      where: { campusSeasonId_rosterId: { campusSeasonId: campus.id, rosterId: row.rosterId } },
      create: { campusSeasonId: campus.id, rosterId: row.rosterId, ...data },
      update: data,
    })
  }

  // 5. Playoffs.
  let playoffRoundCreated: number | null = null
  let championRosterId: string | null = campus.championRosterId
  if (regularDone && campus.status !== 'complete') {
    if (seeded.length < 2) {
      // No college playoff: the regular-season leader is the college champion.
      championRosterId = standings[0]?.rosterId ?? null
      await db.c2CCampusSeason.update({ where: { id: campus.id }, data: { status: 'complete', championRosterId } })
    } else {
      const playoffGames = all.filter((g) => g.kind === 'playoff')
      const lastRound = Math.max(0, ...playoffGames.map((g) => g.playoffRound ?? 0))
      const roundGames = playoffGames.filter((g) => (g.playoffRound ?? 0) === lastRound)
      const roundDone = lastRound === 0 || roundGames.every((g) => g.status === 'final')
      if (roundDone) {
        const alive = lastRound === 0 ? seeded : roundGames.map((g) => campusPlayoffWinner(g, seeded))
        if (lastRound > 0 && alive.length === 1) {
          championRosterId = alive[0]!
          await db.c2CCampusSeason.update({ where: { id: campus.id }, data: { status: 'complete', championRosterId } })
        } else {
          const round = lastRound + 1
          const week = shape.regularSeasonWeeks + round
          const games = campusBracketRound({ round, seeded, alive })
          await db.c2CCampusMatchup.createMany({
            data: games.map((g) => ({
              campusSeasonId: campus!.id,
              week,
              homeRosterId: g.homeRosterId,
              awayRosterId: g.awayRosterId,
              kind: 'playoff',
              playoffRound: round,
              bracketSlot: g.bracketSlot,
              // A first-round bye advances without playing.
              status: g.awayRosterId ? 'scheduled' : 'final',
            })),
          })
          if (campus.status !== 'playoffs') await db.c2CCampusSeason.update({ where: { id: campus.id }, data: { status: 'playoffs' } })
          playoffRoundCreated = round
        }
      }
    }
  }

  return { status: 'ok', created, weeksScored: [...weeksScored], weeksSealed: [...weeksSealed], playoffRoundCreated, championRosterId }
}

/** Every native NFL C2C league on the separate model. Used by the score-sync cron. */
export async function runCampusSeasonTicks(opts: { now?: Date; db?: Db; limit?: number } = {}): Promise<{ leagues: number; ok: number; failed: number; missingTables?: boolean }> {
  const db = opts.db ?? defaultPrisma
  const [c2c, devy] = await Promise.all([
    db.c2CLeagueConfig.findMany({ where: { standingsModel: 'separate' }, select: { leagueId: true }, take: opts.limit ?? 200 }),
    db.league.findMany({
      where: { OR: [{ leagueVariant: { in: ['devy', 'devy_dynasty'] } }, { leagueType: 'devy' }], settings: { path: [DEVY_COLLEGE_SCORING_KEY], equals: true } },
      select: { id: true },
      take: opts.limit ?? 200,
    }),
  ])
  const rows = [...new Set([...c2c.map((r) => r.leagueId), ...devy.map((r) => r.id)])].map((leagueId) => ({ leagueId }))
  let ok = 0
  let failed = 0
  for (const { leagueId } of rows) {
    try {
      const result = await runCampusSeasonTick(leagueId, opts)
      if (result.status === 'ok') ok++
    } catch (e) {
      // The college season tables ship with migration 20261124230000_c2c_campus_season. Until it is
      // applied, stop quietly instead of failing every league every tick.
      if ((e as { code?: string })?.code === 'P2021') return { leagues: rows.length, ok, failed, missingTables: true }
      failed++
      console.warn('[c2c-campus-season] tick failed', { leagueId, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return { leagues: rows.length, ok, failed }
}
