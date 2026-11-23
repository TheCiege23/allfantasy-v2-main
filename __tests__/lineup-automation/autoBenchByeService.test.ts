/**
 * The hourly "bench my starters on bye" run and the owner's switch (lib/lineup-automation).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const m = vi.hoisted(() => {
  const state = {
    league: {} as Record<string, unknown>,
    roster: {} as Record<string, unknown>,
  }
  return {
    state,
    prisma: {
      $queryRaw: vi.fn(async () => [{ id: 'r1', leagueId: 'L' }]),
      league: { findUnique: vi.fn(async () => state.league) },
      roster: {
        findFirst: vi.fn(async () => state.roster),
        update: vi.fn(async () => ({})),
      },
    },
    lock: vi.fn(),
    players: vi.fn(),
    persist: vi.fn(),
    notify: vi.fn(async () => ({})),
    swap: vi.fn(),
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/roster-lineup-engine/lineupLockService', () => ({ resolveFullLineupLockContext: m.lock }))
vi.mock('@/lib/roster-lineup-engine/lineupService', () => ({ persistRosterLineupWithEngine: m.persist }))
vi.mock('@/lib/player-data/getNormalizedPlayerData', () => ({ getNormalizedPlayerData: m.players }))
vi.mock('@/lib/player-data/serializeUnifiedPlayerForApi', () => ({ serializeUnifiedPlayerForApi: (r: unknown) => r }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: m.notify }))
// The plan / opt-in / commissioner decision is aiSwapPolicy's own suite; here it is an input.
vi.mock('@/lib/lineup-automation/aiSwapPolicy', async (orig) => ({
  ...(await orig<typeof import('@/lib/lineup-automation/aiSwapPolicy')>()),
  aiSwapAllowedForTeam: m.swap,
}))
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({ getRosterTemplateForLeague: async () => ({ slots: [] }) }))
vi.mock('@/lib/sport-defaults/LeagueVariantRegistry', () => ({ getFormatTypeForVariant: () => 'standard' }))
vi.mock('@/lib/league/lineupStarterSlots', () => ({
  resolveLineupStarterSlots: () => [
    { index: 0, label: 'QB', allowedPositions: ['QB'], isFlexible: false },
    { index: 1, label: 'RB', allowedPositions: ['RB'], isFlexible: false },
  ],
}))

import { runAutoBenchByes, runByeStarterSweep, setAutoBenchBye, AUTO_BENCH_BYE_ACTION } from '@/lib/lineup-automation/autoBenchByeService'

const playerData = {
  lineup_sections: { starters: [{ id: 'qb', position: 'QB', slotIndex: 0 }, { id: 'rb-bye', position: 'RB', slotIndex: 1 }], bench: [{ id: 'rb-good', position: 'RB' }], ir: [], taxi: [], devy: [] },
  starters: ['qb', 'rb-bye'],
}
const on = { auto_bench_bye: { on: true, byUserId: 'owner', since: '2026-10-27T00:00:00.000Z' } }

beforeEach(() => {
  vi.clearAllMocks()
  m.state.league = { id: 'L', name: 'Dynasty', sport: 'NFL', season: 2026, status: 'in_season', lifecycleState: 'in_season', platform: 'allfantasy', settings: { current_week: 7 }, bestBallMode: false, lockAllMoves: false, leagueType: 'dynasty', leagueVariant: null }
  m.state.roster = { id: 'r1', platformUserId: 'owner', playerData, settings: on }
  m.lock.mockResolvedValue({ locked: false, lockedPlayerIds: [] })
  m.players.mockResolvedValue([
    { id: 'qb', name: 'Quarterback', position: 'QB', projectedPoints: 20, product: { byeWeek: 10 } },
    { id: 'rb-bye', name: 'Bye Back', position: 'RB', projectedPoints: 15, product: { byeWeek: 7 } },
    { id: 'rb-good', name: 'Good Back', position: 'RB', projectedPoints: 9, product: { byeWeek: 12 } },
  ])
  m.persist.mockResolvedValue({ ok: true })
  m.swap.mockResolvedValue({ allowed: true, reason: 'owner_opted_in' })
  m.prisma.$queryRaw.mockResolvedValue([{ id: 'r1', leagueId: 'L' }])
})

describe('runAutoBenchByes', () => {
  it('swaps the starter on bye as a system save on the owner’s behalf, and tells the owner', async () => {
    const r = await runAutoBenchByes()
    expect(r).toMatchObject({ teams: 1, swapped: 1 })
    const args = m.persist.mock.calls[0][0]
    expect(args).toMatchObject({ leagueId: 'L', rosterId: 'r1', source: 'system', actorUserId: 'owner', expectedOwnerUserId: 'owner', expectedStarters: ['qb', 'rb-bye'], season: 2026, week: 7 })
    expect(args.automationAudit).toMatchObject({ action: AUTO_BENCH_BYE_ACTION, metadata: { changes: [{ slot: 'RB', in: 'rb-good', out: 'rb-bye' }] } })
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ userIds: ['owner'], type: 'auto_bench_bye', body: 'Bye Back (bye) → Good Back at RB' }))
  })

  it('writes nothing when no starter is on bye', async () => {
    m.players.mockResolvedValue([
      { id: 'qb', position: 'QB', projectedPoints: 20, product: { byeWeek: 10 } },
      { id: 'rb-bye', position: 'RB', projectedPoints: 15, product: { byeWeek: 9 } },
      { id: 'rb-good', position: 'RB', projectedPoints: 9, product: { byeWeek: 12 } },
    ])
    expect(await runAutoBenchByes()).toMatchObject({ swapped: 0, unchanged: 1 })
    expect(m.persist).not.toHaveBeenCalled()
  })

  it('ignores a setting left by a previous owner', async () => {
    m.state.roster = { ...m.state.roster, platformUserId: 'new-owner' }
    expect((await runAutoBenchByes()).skipped.not_owner_setting).toBe(1)
    expect(m.persist).not.toHaveBeenCalled()
  })

  it('leaves a team AllFantasy or Chimmy runs to that run', async () => {
    m.state.league = { ...m.state.league, settings: { current_week: 7, af_managed_lineups: { r1: { since: 'x', byUserId: 'c' } } } }
    expect((await runAutoBenchByes()).skipped.managed_by_autopilot).toBe(1)
  })

  it('skips an imported league, a daily-lineup league and a locked lineup', async () => {
    m.state.league = { ...m.state.league, platform: 'sleeper' }
    expect((await runAutoBenchByes()).skipped.not_native).toBe(1)
    m.state.league = { ...m.state.league, platform: 'allfantasy', sport: 'NBA', settings: { current_week: 7, sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true } } }
    expect((await runAutoBenchByes()).skipped.daily_lineups).toBe(1)
    m.state.league = { ...m.state.league, sport: 'NFL', settings: { current_week: 7 } }
    m.lock.mockResolvedValue({ locked: true, lockedPlayerIds: [] })
    expect((await runAutoBenchByes()).skipped.lineup_locked).toBe(1)
  })
})

/*
 * 🛑 THIS SWITCH WAS FREE (2026-11-23). Benching a starter for a manager is an AI swap: AF Pro / Supreme, the
 * manager's own switch on, the commissioner's league switch not off (lib/lineup-automation/aiSwapPolicy.ts).
 */
describe('runAutoBenchByes needs AI swap', () => {
  it.each(['owner_not_pro', 'owner_off', 'league_off'])('does nothing when AI swap is not allowed (%s)', async (reason) => {
    m.swap.mockResolvedValue({ allowed: false, reason })
    expect((await runAutoBenchByes()).skipped[reason]).toBe(1)
    expect(m.persist).not.toHaveBeenCalled()
  })
})

/*
 * 🛑 THE BYE RULE WAS ONLY CHECKED ON A SAVE. A lineup set at the draft started Kyren Williams in his bye
 * week in two leagues on 2026-11-22, and unclaimed seats started bye players nobody could move.
 */
describe('runByeStarterSweep', () => {
  const sweepRows = () => {
    m.prisma.$queryRaw.mockReset()
    m.prisma.$queryRaw
      .mockResolvedValueOnce([{ id: 'L' }])
      .mockResolvedValueOnce([{ rosterId: 'r1', names: ['Bye Back'] }])
  }

  it('fixes an unclaimed seat, through the lineup engine, and alerts nobody', async () => {
    sweepRows()
    m.state.roster = { id: 'r1', platformUserId: 'open-slot-L-3', playerData, settings: {} }
    const r = await runByeStarterSweep()
    expect(r).toMatchObject({ leagues: 1, teams: 1, aiSeatsSwapped: 1, managersAlerted: 0 })
    expect(m.persist.mock.calls[0][0]).toMatchObject({ rosterId: 'r1', source: 'system', actorUserId: 'open-slot-L-3' })
    expect(m.persist.mock.calls[0][0].automationAudit.metadata.changes).toEqual([{ slot: 'RB', in: 'rb-good', out: 'rb-bye' }])
    expect(m.notify).not.toHaveBeenCalled()
  })

  it('fixes a seat marked aiManaged the same way', async () => {
    sweepRows()
    m.state.roster = { id: 'r1', platformUserId: 'orphan-test-r1', playerData, settings: { aiManaged: true } }
    expect((await runByeStarterSweep()).aiSeatsSwapped).toBe(1)
  })

  it('alerts a manager and moves nothing', async () => {
    sweepRows()
    m.state.roster = { id: 'r1', platformUserId: 'owner', playerData, settings: {} }
    const r = await runByeStarterSweep()
    expect(r).toMatchObject({ aiSeatsSwapped: 0, managersAlerted: 1 })
    expect(m.persist).not.toHaveBeenCalled()
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({
      userIds: ['owner'], type: 'starter_on_bye', category: 'lineup_alerts',
      body: expect.stringContaining('Bye Back is on bye in Week 7'),
      dedupePrefix: 'bye-starter:L:r1:2026:7:Bye Back',
    }))
  })

  it('leaves a manager with the bye switch AND AI swap to runAutoBenchByes', async () => {
    sweepRows()
    const r = await runByeStarterSweep()
    expect(r.skipped.owner_auto_bench_on).toBe(1)
    expect(m.notify).not.toHaveBeenCalled()
  })

  it('[control] alerts a manager whose bye switch is on but who lacks AI swap', async () => {
    sweepRows()
    m.swap.mockResolvedValue({ allowed: false, reason: 'owner_not_pro' })
    expect((await runByeStarterSweep()).managersAlerted).toBe(1)
    expect(m.persist).not.toHaveBeenCalled()
  })

  it('leaves a team the autopilot runs to that run', async () => {
    sweepRows()
    m.state.league = { ...m.state.league, settings: { current_week: 7, af_managed_lineups: { r1: { since: 'x', byUserId: 'c' } } } }
    expect((await runByeStarterSweep()).skipped.managed_by_autopilot).toBe(1)
  })
})

describe('setAutoBenchBye', () => {
  it('saves the switch with the owner on the team, keeping other settings', async () => {
    m.state.roster = { id: 'r1', settings: { other: 1 } }
    expect(await setAutoBenchBye('L', 'owner', true)).toEqual({ ok: true, on: true })
    const data = (m.prisma.roster.update.mock.calls[0][0] as { data: { settings: Record<string, unknown> } }).data.settings
    expect(data).toMatchObject({ other: 1, auto_bench_bye: { on: true, byUserId: 'owner' } })
  })

  it('refuses a bad value, a non-owner and an imported league', async () => {
    expect(await setAutoBenchBye('L', 'owner', 'yes')).toMatchObject({ ok: false, status: 400 })
    m.prisma.roster.findFirst.mockResolvedValueOnce(null as never)
    expect(await setAutoBenchBye('L', 'stranger', true)).toMatchObject({ ok: false, status: 403 })
    m.state.league = { ...m.state.league, platform: 'sleeper' }
    expect(await setAutoBenchBye('L', 'owner', true)).toMatchObject({ ok: false, status: 409 })
  })
})
