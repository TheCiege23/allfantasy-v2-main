/**
 * NBA and NHL redraft, every week of a season, through the production engines — the daily-sport
 * counterpart of `g43-nfl-redraft-full-season-simulation.test.ts`. The harness and the in-memory Prisma
 * it runs against are in `__tests__/redraft-season-simulation/`; this file only asserts.
 *
 * Invariants, checked at every step rather than snapshotted:
 *  - every team plays every regular-season week (one bye a week for an odd league, or its extra matchup);
 *  - each week's score is the sum of that day's starters only (daily lineups, daily scoring);
 *  - W + L + T and PF / PA agree with the results the matchup rows imply (head-to-head, median, extra);
 *  - the stored standings order follows the league's tiebreakers;
 *  - the playoff field is 4 under ten teams and 6 from ten, seeded from the standings, and locked;
 *  - league median and the regular season stop counting at the playoff start;
 *  - exactly one champion, a full final order, and a renewal into a fresh season.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ db: null as any }))
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return holder.db
  },
  get default() {
    return holder.db
  },
}))

import { createInMemoryPrisma } from './redraft-season-simulation/inMemoryPrisma'
import {
  runDailyRedraftFullSeason,
  type DailySimConfig,
  type DailySimResult,
  type StandingRow,
} from './redraft-season-simulation/dailyRedraftSeasonHarness'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  holder.db = createInMemoryPrisma()
  vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function run(config: Omit<DailySimConfig, 'setNow'>): Promise<DailySimResult> {
  return runDailyRedraftFullSeason(holder.db, { ...config, setNow: (now) => vi.setSystemTime(now) })
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** The league's tiebreakers, applied to the standings: win %, then points for, then points against. */
function tiebreakOrder(rows: StandingRow[], tiebreakers: string[]): string[] {
  const pct = (r: StandingRow) => (r.wins + r.ties / 2) / Math.max(1, r.wins + r.losses + r.ties)
  const keys = tiebreakers.filter((k) => ['win_pct', 'points_for', 'points_against', 'wins'].includes(k))
  return [...rows]
    .sort((a, b) => {
      for (const key of keys) {
        const d =
          key === 'win_pct' ? pct(b) - pct(a) :
          key === 'points_for' ? b.pointsFor - a.pointsFor :
          key === 'points_against' ? a.pointsAgainst - b.pointsAgainst :
          b.wins - a.wins
        if (Math.abs(d) > 1e-9) return d
      }
      return 0
    })
    .map((r) => r.rosterId)
}

function assertSchedule(result: DailySimResult) {
  const n = result.rosterIds.length
  const byes = new Map(result.rosterIds.map((id) => [id, 0]))
  for (let week = 1; week <= result.regularSeasonWeeks; week += 1) {
    const rows = result.schedule.filter((m) => m.week === week)
    const seen = rows.flatMap((m) => [m.homeRosterId, m.awayRosterId].filter(Boolean))
    expect(new Set(seen).size, `week ${week}: each team once`).toBe(seen.length)
    expect(new Set(seen).size, `week ${week}: every team scheduled`).toBe(n)
    const byeRows = rows.filter((m) => !m.awayRosterId)
    expect(byeRows.length, `week ${week}: byes`).toBe(n % 2)
    for (const b of byeRows) byes.set(b.homeRosterId, byes.get(b.homeRosterId)! + 1)
  }
  expect(result.schedule.every((m) => m.week <= result.regularSeasonWeeks), 'no regular rows in playoff weeks').toBe(true)
  if (n % 2) {
    const counts = [...byes.values()]
    expect(Math.max(...counts) - Math.min(...counts), 'byes spread evenly').toBeLessThanOrEqual(1)
  }
}

function assertWeeks(result: DailySimResult) {
  for (const snap of result.weeks) {
    const h2h = snap.matchups.filter((m) => m.awayRosterId)
    expect(h2h.every((m) => m.status === 'final'), `week ${snap.week}: every game final`).toBe(true)
    for (const m of h2h) {
      expect(m.homeScore, `week ${snap.week} home ${m.homeRosterId}: daily starters only`).toBeCloseTo(snap.dailyStarterPoints.get(m.homeRosterId)!, 1)
      expect(m.awayScore, `week ${snap.week} away ${m.awayRosterId}: daily starters only`).toBeCloseTo(snap.dailyStarterPoints.get(m.awayRosterId)!, 1)
    }
    for (const row of snap.standings) {
      const want = snap.expectedRecords.get(row.rosterId)!
      const label = `week ${snap.week} ${row.rosterId}`
      expect({ w: row.wins, l: row.losses, t: row.ties }, `${label}: record`).toEqual({ w: want.wins, l: want.losses, t: want.ties })
      expect(row.pointsFor, `${label}: PF`).toBeCloseTo(round2(want.pointsFor), 1)
      expect(row.pointsAgainst, `${label}: PA`).toBeCloseTo(round2(want.pointsAgainst), 1)
    }
    // Every team's games so far: one a week, plus a median game a week when median is on.
    for (const row of snap.standings) {
      const games = row.wins + row.losses + row.ties
      const byeWeeks = result.schedule.filter((m) => m.week <= snap.week && !m.awayRosterId && m.homeRosterId === row.rosterId).length
      const extraWeeks = result.config.extraMatchup ? byeWeeks : 0
      expect(games, `week ${snap.week} ${row.rosterId}: games played`).toBe(
        (snap.week - byeWeeks) + extraWeeks + (result.config.medianGame ? snap.week : 0),
      )
    }
    // Standings order: the stored rank is the league's tiebreak order. The last regular week's advance
    // generates the bracket, which keeps a seed for the qualifiers only.
    const ranked = snap.standings.filter((r) => r.playoffSeed != null)
    const stored = [...ranked].sort((a, b) => a.playoffSeed! - b.playoffSeed!).map((r) => r.rosterId)
    const want = tiebreakOrder(snap.standings, result.tiebreakers).slice(0, ranked.length)
    const describeRows = (ids: string[]) =>
      ids.map((id) => snap.standings.find((r) => r.rosterId === id)!).map((r) => `${r.rosterId} ${r.wins}-${r.losses}-${r.ties} ${r.pointsFor}`)
    expect(describeRows(stored), `week ${snap.week}: standings order`).toEqual(describeRows(want))
  }
}

function assertPlayoffs(result: DailySimResult) {
  const n = result.rosterIds.length
  const expectedField = Math.min(n >= 10 ? 6 : 4, n % 2 ? n - 1 : n)
  expect(result.playoffTeams, 'playoff field rule').toBe(expectedField)
  expect(result.weeks.at(-1)!.seasonStatus, 'bracket opened at the end of the regular season').toBe('playoffs')
  expect(result.bracket.structure, 'bracket generated').not.toBeNull()

  // The field: the top N by the league's tiebreakers.
  const seeds = [...result.bracket.seeds].sort((a, b) => a.seed - b.seed)
  expect(seeds.map((s) => s.seed)).toEqual(Array.from({ length: expectedField }, (_, i) => i + 1))
  expect(seeds.map((s) => s.rosterId), 'seeds follow the standings').toEqual(
    tiebreakOrder(result.standingsAtPlayoffStart, result.tiebreakers).slice(0, expectedField),
  )
  expect(result.bracket.structure!.byes, 'first-round byes').toBe(expectedField === 6 ? 2 : 0)

  // Seeds lock and the regular season stops counting: W-L-T and seeds never move in the playoffs.
  const atStart = new Map(result.standingsAtPlayoffStart.map((r) => [r.rosterId, r]))
  for (const week of result.playoffWeeks) {
    for (const row of week.standings) {
      const before = atStart.get(row.rosterId)!
      expect({ w: row.wins, l: row.losses, t: row.ties, seed: row.playoffSeed }, `playoff week ${week.week} ${row.rosterId}`).toEqual({
        w: before.wins,
        l: before.losses,
        t: before.ties,
        seed: seeds.find((s) => s.rosterId === row.rosterId)?.seed ?? null,
      })
    }
  }

  // Consolation / third place: every team that misses the bracket, or loses in it, is placed.
  expect(result.bracket.structure!.thirdPlaceGame, 'third-place game').toBe(true)
  if (n > expectedField) expect(result.bracket.structure!.lowerBracket, 'lower bracket').toBe('consolation')
}

function assertChampion(result: DailySimResult) {
  expect(result.final.seasonStatus).toBe('complete')
  expect(result.final.championships, 'one championship row').toHaveLength(1)
  const structure = result.final.bracketStructure!
  const champion = structure.championRosterId
  expect(result.bracket.seeds.map((s) => s.rosterId)).toContain(champion)
  const finals = structure.finalStandings as Array<{ rosterId: string; finish: number; champion: boolean }>
  expect(finals.filter((r) => r.champion), 'exactly one champion').toHaveLength(1)
  expect(finals.find((r) => r.champion)!.rosterId).toBe(champion)
  expect(finals.find((r) => r.finish === 1)!.rosterId).toBe(champion)
  expect(new Set(finals.map((r) => r.rosterId)).size, 'every team finishes once').toBe(result.rosterIds.length)
  expect(finals.map((r) => r.finish).sort((a, b) => a - b), 'finishes 1..n').toEqual(
    Array.from({ length: result.rosterIds.length }, (_, i) => i + 1),
  )
  expect(structure.runnerUpRosterId).not.toBe(champion)
  expect(structure.thirdPlaceRosterId, 'third place decided').toBeTruthy()
}

function assertRollover(result: DailySimResult) {
  const { rollover } = result
  expect(rollover.leagueSeason, 'league moved to next season').toBe(2027)
  expect(rollover.nextSeason, 'fresh season row').not.toBeNull()
  expect(rollover.nextSeason!.status).toBe('setup')
  expect(rollover.nextRosters).toHaveLength(result.rosterIds.length)
  for (const r of rollover.nextRosters) {
    expect({ w: r.wins, l: r.losses, t: r.ties, pf: r.pointsFor, seed: r.playoffSeed, out: r.isEliminated }).toEqual({
      w: 0, l: 0, t: 0, pf: 0, seed: null, out: false,
    })
  }
  expect(rollover.nextRosterPlayers, 'no player carried into a redraft').toHaveLength(0)
  expect(rollover.nextDraft, 'next draft created').not.toBeNull()
  expect(rollover.nextDraft!.status).toBe('pre_draft')
  expect(rollover.nextDraft!.id).not.toBe(rollover.previousDraft!.id)
  // A redraft carries nothing into next year's order but the commissioner's choice; with none, random.
  const orderMode = rollover.result.draft?.orderMode ?? rollover.result.orderMode
  expect(orderMode, 'draft order mode').toBe(result.config.renewDraftOrder ?? 'random')
  const order = (rollover.nextDraft!.slotOrder as Array<{ slot: number; rosterId: string }>) ?? []
  expect(order.map((s) => s.slot)).toEqual(Array.from({ length: result.rosterIds.length }, (_, i) => i + 1))
}

function assertAll(result: DailySimResult) {
  const draftable = result.draft.picks / result.rosterIds.length
  expect(result.draft.uniquePlayers, 'no player drafted twice').toBe(result.draft.picks)
  expect(Number.isInteger(draftable)).toBe(true)
  expect(result.weeks).toHaveLength(result.regularSeasonWeeks)
  assertSchedule(result)
  assertWeeks(result)
  assertPlayoffs(result)
  assertChampion(result)
  assertRollover(result)
}

describe.each(['NBA', 'NHL'] as const)('%s redraft full season (daily lineups, daily scoring)', (sport) => {
  it.each([4, 10, 20])('%i teams, league defaults', async (teamCount) => {
    assertAll(await run({ sport, teamCount, renewDraftOrder: 'random' }))
  }, 180_000)

  it('7 teams: a bye every week, league median on', async () => {
    assertAll(await run({ sport, teamCount: 7, medianGame: true, renewDraftOrder: 'standings' }))
  }, 180_000)

  it('7 teams: the extra matchup instead of the bye', async () => {
    assertAll(await run({ sport, teamCount: 7, extraMatchup: true, renewDraftOrder: 'random' }))
  }, 180_000)

  it('renews with no draft order chosen, on the default saved order method (manual)', async () => {
    assertAll(await run({ sport, teamCount: 4 }))
  }, 180_000)
})
