/**
 * Official stat corrections applied to sealed weeks (lib/redraft/statCorrections.ts). What must hold:
 *   - the diff is per league, against the league's OWN stored result — not against the shared stat row;
 *   - a final result is rewritten only from a COMPLETE fresh score, and never over a commish edit;
 *   - only inside the league's window after the week's last game, at most every six hours per week;
 *   - specialty, rotisserie, imported and non-NFL leagues are left alone; 0 days turns it off;
 *   - the re-sync's un-finalized rows are put back to final;
 *   - a change rebuilds standings, lands in the ledger and is announced.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  diffMatchup,
  isCompleteScore,
  parseStatCorrectionDays,
  readStatCorrectionDays,
  recheckStatCorrectionsForSeason,
  STAT_CORRECTION_EVENT,
  type StatCorrectionDeps,
} from '@/lib/redraft/statCorrections'
import type { RosterScoreSummary } from '@/lib/redraft/scoringEngine'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const summary = (rosterId: string, points: number, players: Array<[string, number]>, extra: Partial<RosterScoreSummary> = {}): RosterScoreSummary => ({
  rosterId,
  starterCount: players.length,
  scoredStarterCount: players.length,
  points,
  missingPlayerIds: [],
  allFinal: true,
  players: players.map(([playerId, p]) => ({ playerId, points: p })),
  ...extra,
})

const snapshot = (home: Array<[string, number]>, away: Array<[string, number]>) => ({
  redraftScoring: {
    home: { players: home.map(([playerId, points]) => ({ playerId, points })) },
    away: { players: away.map(([playerId, points]) => ({ playerId, points })) },
  },
})

describe('the window setting', () => {
  it('defaults to 3 days, accepts 0..7, and tolerates junk', () => {
    expect(readStatCorrectionDays({})).toBe(3)
    expect(readStatCorrectionDays({ stat_correction_days: 0 })).toBe(0)
    expect(readStatCorrectionDays({ stat_correction_days: 7 })).toBe(7)
    expect(readStatCorrectionDays({ stat_correction_days: 'x' })).toBe(3)
    expect(parseStatCorrectionDays(8)).toBeNull()
    expect(parseStatCorrectionDays(1.5)).toBeNull()
    expect(parseStatCorrectionDays('2')).toBe(2)
  })
})

describe('diffMatchup', () => {
  it('names the player whose points moved and flags a flipped result', () => {
    const d = diffMatchup({
      matchupId: 'm1',
      homeRosterId: 'A',
      awayRosterId: 'B',
      storedHome: 100,
      storedAway: 101,
      snapshot: snapshot([['qb', 60], ['wr', 40]], [['rb', 101]]),
      home: summary('A', 103, [['qb', 60], ['wr', 43]]),
      away: summary('B', 101, [['rb', 101]]),
    })
    expect(d.changed).toBe(true)
    expect(d.players).toEqual([{ playerId: 'wr', rosterId: 'A', pointsBefore: 40, pointsAfter: 43 }])
    expect(d.matchup).toMatchObject({ before: { home: 100, away: 101 }, after: { home: 103, away: 101 }, resultFlipped: true })
  })

  it('no change, no correction; an old snapshot without players still reports the score', () => {
    const same = diffMatchup({ matchupId: 'm', homeRosterId: 'A', awayRosterId: 'B', storedHome: 90, storedAway: 80, snapshot: {}, home: summary('A', 90, []), away: summary('B', 80, []) })
    expect(same.changed).toBe(false)
    const moved = diffMatchup({ matchupId: 'm', homeRosterId: 'A', awayRosterId: 'B', storedHome: 90, storedAway: 80, snapshot: {}, home: summary('A', 92, [['x', 92]]), away: summary('B', 80, []) })
    expect(moved.changed).toBe(true)
    expect(moved.players).toEqual([])
    expect(moved.matchup.resultFlipped).toBe(false)
  })

  it('a fresh score is complete only with every starter scored and final', () => {
    expect(isCompleteScore(summary('A', 1, [['a', 1]]))).toBe(true)
    expect(isCompleteScore(summary('A', 1, [['a', 1]], { allFinal: false }))).toBe(false)
    expect(isCompleteScore(summary('A', 1, [['a', 1]], { missingPlayerIds: ['b'] }))).toBe(false)
  })
})

describe('recheckStatCorrectionsForSeason', () => {
  const NOW = new Date('2026-10-13T12:00:00Z')
  const LAST_KICKOFF = '2026-10-13T00:15:00Z' // Monday night; inside a 3-day window
  let state: {
    settings: Record<string, unknown>
    platform: string
    variant: string | null
    sport: string
    claim: { expiresAt: Date } | null
    matchups: Array<Record<string, unknown>>
    events: Array<Record<string, unknown>>
    finalizedReset: number
  }
  let db: Record<string, any>
  let deps: StatCorrectionDeps & { [k: string]: any }
  const fresh: Record<string, RosterScoreSummary> = {}

  beforeEach(() => {
    state = {
      settings: {},
      platform: 'allfantasy',
      variant: null,
      sport: 'NFL',
      claim: null,
      matchups: [
        { id: 'm1', homeRosterId: 'A', awayRosterId: 'B', homeScore: 100, awayScore: 101, status: 'final', isMedianMatchup: false, lineupSnapshots: snapshot([['wr', 40]], [['rb', 101]]) },
        { id: 'm2', homeRosterId: 'C', awayRosterId: 'D', homeScore: 70, awayScore: 60, status: 'final', isMedianMatchup: false, lineupSnapshots: { commissionerEdit: { by: 'u' } } },
      ],
      events: [],
      finalizedReset: 0,
    }
    fresh.A = summary('A', 103, [['wr', 43]])
    fresh.B = summary('B', 101, [['rb', 101]])
    fresh.C = summary('C', 10, [['x', 10]])
    fresh.D = summary('D', 90, [['y', 90]])
    db = {
      redraftSeason: { findFirst: vi.fn(async () => ({ id: 'S1', leagueId: 'L1', season: 2026, sport: state.sport })) },
      league: { findFirst: vi.fn(async () => ({ platform: state.platform, settings: state.settings, leagueVariant: state.variant })) },
      redraftMatchup: { findMany: vi.fn(async ({ where }: { where: { week: number } }) => (where.week === 6 ? state.matchups : [])) },
      sportsDataCache: {
        findUnique: vi.fn(async () => state.claim),
        upsert: vi.fn(async ({ create }: { create: { expiresAt: Date } }) => {
          state.claim = { expiresAt: create.expiresAt }
        }),
      },
      redraftRosterPlayer: { findMany: vi.fn(async () => [{ playerId: 'wr', playerName: 'Wade WR', rosterId: 'A' }, { playerId: 'rb', playerName: 'Ray RB', rosterId: 'B' }]) },
      playerWeeklyScore: { updateMany: vi.fn(async () => { state.finalizedReset += 1; return { count: 2 } }) },
      redraftRoster: { findMany: vi.fn(async () => [{ id: 'A', teamName: 'Aces', ownerName: 'a' }, { id: 'B', teamName: null, ownerName: 'Bee' }]) },
      leagueEvent: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { state.events.push(data) }) },
    }
    deps = {
      prisma: db as never,
      now: () => NOW,
      syncWeekStats: vi.fn(async () => ({ rateLimited: false })),
      scoreRoster: vi.fn(async ({ rosterId }: { rosterId: string }) => fresh[rosterId]!),
      updateMatchup: vi.fn(async () => undefined),
      updateStandings: vi.fn(async () => undefined),
      readLastKickoff: vi.fn(async ({ week }: { week: number }) => (week === 6 ? LAST_KICKOFF : null)),
      notify: vi.fn(async () => undefined),
      isSpecialtyFormat: (v: string | null) => v === 'guillotine',
    }
  })

  const run = () => recheckStatCorrectionsForSeason({ seasonId: 'S1', currentWeek: 7 }, deps)

  it('rewrites the changed matchup, leaves the commish-edited one, rebuilds standings, records and announces', async () => {
    const r = await run()
    expect(r).toMatchObject({ skipped: null, weeksChecked: [6], matchupsChanged: 1, playersCorrected: 1 })
    expect(deps.updateMatchup).toHaveBeenCalledTimes(1)
    expect(deps.updateMatchup).toHaveBeenCalledWith('m1')
    expect(deps.updateStandings).toHaveBeenCalledWith('S1', 6)
    expect(state.finalizedReset).toBe(1)
    expect(state.events).toHaveLength(1)
    expect(state.events[0]).toMatchObject({ leagueId: 'L1', eventType: STAT_CORRECTION_EVENT })
    expect((state.events[0]!.payload as any).corrections).toEqual([
      { playerId: 'wr', rosterId: 'A', pointsBefore: 40, pointsAfter: 43, playerName: 'Wade WR', teamName: 'Aces' },
    ])
    expect((state.events[0]!.payload as any).matchups[0]).toMatchObject({ homeTeam: 'Aces', awayTeam: 'Bee', resultFlipped: true })
    expect(deps.notify).toHaveBeenCalledTimes(1)
  })

  it('never rewrites a final result from an incomplete fresh score', async () => {
    fresh.A = summary('A', 0, [], { missingPlayerIds: ['wr'], starterCount: 1, scoredStarterCount: 0 })
    const r = await run()
    expect(r.matchupsChanged).toBe(0)
    expect(deps.updateMatchup).not.toHaveBeenCalled()
    expect(state.events).toEqual([])
  })

  it('no change: nothing written, nothing announced', async () => {
    fresh.A = summary('A', 100, [['wr', 40]])
    const r = await run()
    expect(r).toMatchObject({ weeksChecked: [6], matchupsChanged: 0 })
    expect(deps.updateStandings).not.toHaveBeenCalled()
    expect(deps.notify).not.toHaveBeenCalled()
  })

  it('outside the window, on an open week, or inside the six-hour throttle: no re-sync', async () => {
    deps.now = () => new Date('2026-10-17T12:00:00Z') // > 3 days after the last kickoff
    expect((await run()).weeksChecked).toEqual([])
    deps.now = () => NOW
    state.matchups[0]!.status = 'active' // week not sealed
    expect((await run()).weeksChecked).toEqual([])
    state.matchups[0]!.status = 'final'
    state.claim = { expiresAt: new Date(NOW.getTime() + 60_000) }
    expect((await run()).weeksChecked).toEqual([])
    expect(deps.syncWeekStats).not.toHaveBeenCalled()
  })

  it('claims the week before calling the provider, so a second tick does not re-sync', async () => {
    await run()
    await run()
    expect(deps.syncWeekStats).toHaveBeenCalledTimes(1)
  })

  it.each([
    [{ settings: { stat_correction_days: 0 } }, 'off'],
    [{ platform: 'sleeper' }, 'not_native'],
    [{ sport: 'NBA' }, 'sport_not_supported'],
    [{ variant: 'guillotine' }, 'format_not_supported'],
    [{ settings: { scoring_mode: 'roto' } }, 'format_not_supported'],
  ])('%j is skipped (%s)', async (patch, reason) => {
    Object.assign(state, patch)
    const r = await run()
    expect(r.skipped).toBe(reason)
    expect(deps.syncWeekStats).not.toHaveBeenCalled()
  })

  it('a rate-limited provider leaves the week for the next interval', async () => {
    deps.syncWeekStats = vi.fn(async () => ({ rateLimited: true }))
    const r = await run()
    expect(r.weeksChecked).toEqual([])
    expect(deps.updateMatchup).not.toHaveBeenCalled()
  })
})
