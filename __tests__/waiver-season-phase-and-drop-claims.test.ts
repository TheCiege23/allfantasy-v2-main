// @vitest-environment node
/**
 * Claims on a dropped player, and the season-phase waiver rules, in the claim service and the
 * processor (lib/waiver-wire/process-engine.ts, claim-service.ts, season-phase-gate.ts).
 *
 *   - Claims on a player on waivers after a drop run in the league's own order — FAAB, rolling,
 *     reverse standings — and the team that dropped him cannot get him back.
 *   - Offseason: closed by default, or first-come free agency (no claims). Dynasty stays open.
 *   - Playoffs: every team by default; or only teams alive in the title bracket; or all rosters locked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  league: {} as Record<string, unknown>,
  engineConfig: {} as Record<string, unknown>,
  season: { id: 's1', status: 'active' } as { id: string; status: string } | null,
  completedSeasons: 0,
  redraftRosters: [] as Array<{ id: string; ownerId: string; isEliminated: boolean }>,
  claims: [] as unknown[],
  ranks: [] as Array<{ externalId: string; currentRank: number }>,
  drops: [] as Array<{ dropPlayerId: string; processedAt: Date; rosterId: string }>,
  effective: { waiverType: 'faab', normalizedWaiverType: 'faab', waiverEngineConfig: {}, allowZeroFaabBid: true } as Record<string, unknown>,
  claimUpdate: vi.fn(),
  claimCreate: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: async () => h.league },
    leagueWaiverSettings: { findUnique: async () => ({ waiverEngineConfig: h.engineConfig }) },
    redraftSeason: { findFirst: async () => h.season, count: async () => h.completedSeasons },
    redraftRoster: { findMany: async () => h.redraftRosters },
    waiverClaim: {
      findMany: async () => h.claims,
      update: h.claimUpdate,
      aggregate: async () => ({ _max: { priorityOrder: 0 } }),
      create: h.claimCreate,
    },
    roster: {
      findMany: async () => [
        { id: 'A', platformUserId: 'uA', redraftRosterId: 'rrA', playerData: [], waiverPriority: 1, faabRemaining: 100 },
        { id: 'B', platformUserId: 'uB', redraftRosterId: 'rrB', playerData: [], waiverPriority: 3, faabRemaining: 100 },
        { id: 'C', platformUserId: 'uC', redraftRosterId: 'rrC', playerData: [], waiverPriority: 2, faabRemaining: 100 },
      ],
      findFirst: async () => ({ id: 'A', platformUserId: 'uA' }),
      findUnique: async () => null,
      update: vi.fn(),
    },
    leagueTeam: { findMany: async () => h.ranks },
    waiverTransaction: {
      findMany: async ({ where }: { where: { dropPlayerId?: { in?: string[] } } }) =>
        h.drops.filter((d) => !where.dropPlayerId?.in || where.dropPlayerId.in.includes(d.dropPlayerId)),
      create: vi.fn(),
    },
    waiverRun: { create: async () => ({ id: 'run' }), update: async () => ({}) },
    waiverResult: { createMany: async () => ({}) },
    $transaction: async () => [],
  },
}))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ getEffectiveLeagueWaiverSettings: async () => h.effective }))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({ getLeagueWaiverState: async () => null, upsertLeagueWaiverStateAfterRun: async () => {} }))
vi.mock('@/lib/waiver-wire/run-hooks', () => ({ onWaiverRunComplete: async () => {} }))
vi.mock('@/lib/specialty-league/registry', () => ({ getSpecialtySpecByVariant: () => null }))
vi.mock('@/lib/survivor/SurvivorEffectEngine', () => ({ isWaiverFrozenForRoster: async () => false }))
vi.mock('@/lib/league/commissioner-roster-lock', () => ({ isCommissionerRosterLocked: async () => false }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: async () => {} }))
vi.mock('@/lib/ai-learning-system/recordEvent', () => ({ recordAfLearningEvent: vi.fn() }))
vi.mock('@/lib/ai-learning-system/resolveLeagueSport', () => ({ resolveLeagueSport: async () => 'NFL' }))
vi.mock('@/lib/league-runtime/redraftRosterMoveSync', () => ({ planRedraftRosterMoveWrites: async () => [] }))
vi.mock('@/lib/guillotine/blindWaiverCutoff', () => ({ guillotineClaimsCutoff: async () => null }))
// createClaim's other gates, all open.
vi.mock('@/lib/guillotine/guillotineGuard', () => ({ isRosterChopped: async () => false }))
vi.mock('@/lib/survivor/SurvivorRosterState', () => ({ isRosterCurrentlyEliminated: async () => false }))
vi.mock('@/lib/devy/waiver/DevyWaiverRules', () => ({ validateDevyWaiverClaim: async () => ({ allowed: true }) }))
vi.mock('@/lib/waiver-wire/transaction-eligibility', () => ({ assertWaiverClaimEligibility: async () => undefined }))
vi.mock('@/lib/waiver-wire/daily-schedule-gate', () => ({ loadDailyTransactionPolicy: async () => null }))
vi.mock('@/lib/waiver-wire/waiver-validation', () => ({
  assertClaimWithinLimits: async () => ({ ok: true }),
  assertClaimWithinPerRunLimit: async () => ({ ok: true }),
  assertWaiverSubmissionWindow: () => ({ ok: true }),
  assertDailyScheduleAllowsClaim: () => ({ ok: true }),
  conceptOverridesBlockWaivers: () => null,
}))

import { processWaiverClaimsForLeague } from '@/lib/waiver-wire/process-engine'
import { createClaim } from '@/lib/waiver-wire/claim-service'
import { DROPPER_RECLAIM_MESSAGE } from '@/lib/waiver-wire/dropped-player-waivers'
import { PHASE_REASONS, resolveWaiverPhasePolicy, resolveWaiverSeasonPhase } from '@/lib/waiver-wire/season-phase-policy'

const NOW = new Date('2026-10-20T15:00:00Z')

function claim(rosterId: string, faabBid: number, waiverPriority: number, platformUserId: string, addPlayerId = 'X') {
  return {
    id: `c-${rosterId}`, leagueId: 'L', rosterId, addPlayerId, dropPlayerId: null, faabBid, priorityOrder: 1, status: 'pending',
    createdAt: new Date('2026-10-20T10:00:00Z'), metadata: null,
    roster: { id: rosterId, platformUserId, playerData: [], faabRemaining: 100, waiverPriority },
  }
}

/** A dropped X (by A, 6h ago) wanted by A, B and C: A bids most, has priority 1 and is last in standings. */
function claimsOnDroppedX() {
  h.claims = [claim('A', 50, 1, 'uA'), claim('B', 30, 3, 'uB'), claim('C', 20, 2, 'uC')]
  // currentRank 1 = first place. A is worst (12), then B (10), then C (4).
  h.ranks = [{ externalId: 'uA', currentRank: 12 }, { externalId: 'uB', currentRank: 10 }, { externalId: 'uC', currentRank: 4 }]
  h.drops = [{ dropPlayerId: 'X', processedAt: new Date('2026-10-20T09:00:00Z'), rosterId: 'A' }]
}

function setType(t: string) {
  h.effective = { waiverType: t, normalizedWaiverType: t, waiverEngineConfig: {}, allowZeroFaabBid: true }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  h.league = { id: 'L', rosterSize: 20, sport: 'NFL', settings: {}, timezone: 'UTC', waiverHours: 24, lifecycleState: 'in_season', leagueType: 'redraft', isDynasty: false }
  h.engineConfig = {}
  h.season = { id: 's1', status: 'active' }
  h.completedSeasons = 0
  h.redraftRosters = []
  h.claims = []
  h.ranks = []
  h.drops = []
  h.claimUpdate.mockReturnValue({})
  h.claimCreate.mockResolvedValue({ id: 'new' })
  setType('faab')
})

const winner = (results: Array<{ rosterId: string; success: boolean }>) => results.find((r) => r.success)?.rosterId ?? null
const failed = (results: Array<{ rosterId: string; success: boolean; message?: string }>, rosterId: string) =>
  results.find((r) => r.rosterId === rosterId && !r.success)?.message

describe('claims on a dropped player wait for his waiver period, then follow the waiver type', () => {
  // X was dropped by A at 09:00 with a 24h period: he clears 2026-10-21T09:00Z.
  const AFTER_CLEAR = new Date('2026-10-21T09:00:01Z')
  const claimOnX = (c: { id: string }) => h.claimUpdate.mock.calls.some(([arg]) => (arg as { where: { id: string } }).where.id === c.id)

  it('a run before he clears leaves the other claims on him pending and untouched; the dropper is refused', async () => {
    claimsOnDroppedX()
    const results = await processWaiverClaimsForLeague('L')
    expect(results.map((r) => r.rosterId)).toEqual(['A'])
    expect(failed(results, 'A')).toBe(DROPPER_RECLAIM_MESSAGE)
    // B's and C's claims are not failed, not awarded, not written at all.
    expect(claimOnX({ id: 'c-B' })).toBe(false)
    expect(claimOnX({ id: 'c-C' })).toBe(false)
  })

  it('a run before he clears with only other teams claiming him processes nothing, and opens no run', async () => {
    claimsOnDroppedX()
    h.claims = h.claims.filter((c) => (c as { rosterId: string }).rosterId !== 'A')
    const runCreate = vi.spyOn((await import('@/lib/prisma')).prisma.waiverRun as { create: () => Promise<unknown> }, 'create')
    expect(await processWaiverClaimsForLeague('L')).toEqual([])
    expect(h.claimUpdate).not.toHaveBeenCalled()
    expect(runCreate).not.toHaveBeenCalled()
    runCreate.mockRestore()
  })

  it('an unreadable hold processes nothing this run, rather than run a held claim early', async () => {
    claimsOnDroppedX()
    const { prisma } = await import('@/lib/prisma')
    const read = vi.spyOn(prisma.waiverTransaction as { findMany: () => Promise<unknown> }, 'findMany').mockRejectedValueOnce(new Error('db down'))
    vi.spyOn(console, 'warn').mockImplementationOnce(() => {})
    expect(await processWaiverClaimsForLeague('L')).toEqual([])
    expect(h.claimUpdate).not.toHaveBeenCalled()
    read.mockRestore()
  })

  it('other claims in the same run are not held up by him', async () => {
    claimsOnDroppedX()
    h.claims = [claim('B', 30, 3, 'uB'), claim('C', 20, 2, 'uC', 'Y')]
    const results = await processWaiverClaimsForLeague('L')
    expect(results.map((r) => [r.rosterId, r.success])).toEqual([['C', true]])
  })

  it.each([
    ['faab', 'B'], // the higher bid
    ['rolling', 'C'], // the better priority
    ['reverse_standings', 'B'], // the worse standing
  ])('%s: the first run after he clears processes the claims on him, and %s wins', async (type, expected) => {
    setType(type)
    claimsOnDroppedX()
    h.claims = h.claims.filter((c) => (c as { rosterId: string }).rosterId !== 'A')
    // Before: pending.
    expect(await processWaiverClaimsForLeague('L')).toEqual([])
    // The first run after: both compete under the league's rules.
    vi.setSystemTime(AFTER_CLEAR)
    const results = await processWaiverClaimsForLeague('L')
    expect(winner(results)).toBe(expected)
    expect(results).toHaveLength(2)
    expect(results.find((r) => r.rosterId !== expected)?.message).toBe('Player no longer available (awarded to another team in this run).')
  })

  it.each(['faab', 'rolling', 'reverse_standings'])('positive control (%s): with no drop on record the claims run at once', async (type) => {
    setType(type)
    claimsOnDroppedX()
    h.drops = []
    expect(winner(await processWaiverClaimsForLeague('L'))).toBe('A')
  })

  it('once he has cleared waivers, the old owner may claim him like anyone', async () => {
    claimsOnDroppedX()
    h.drops = [{ dropPlayerId: 'X', processedAt: new Date('2026-10-19T14:00:00Z'), rosterId: 'A' }]
    expect(winner(await processWaiverClaimsForLeague('L'))).toBe('A')
  })

  it('an FCFS league has no waiver period, so the hold never applies', async () => {
    setType('fcfs')
    claimsOnDroppedX()
    const results = await processWaiverClaimsForLeague('L')
    expect(failed(results, 'A')).toBeUndefined()
    expect(results).toHaveLength(3)
  })
})

describe('createClaim', () => {
  it('refuses the dropping team inside the waiver period, and lets another team claim', async () => {
    h.drops = [{ dropPlayerId: 'X', processedAt: new Date('2026-10-20T09:00:00Z'), rosterId: 'A' }]
    await expect(createClaim('L', 'A', { addPlayerId: 'X' } as never)).rejects.toThrow(DROPPER_RECLAIM_MESSAGE)
    h.drops = [{ dropPlayerId: 'X', processedAt: new Date('2026-10-20T09:00:00Z'), rosterId: 'B' }]
    await expect(createClaim('L', 'A', { addPlayerId: 'X' } as never)).resolves.toEqual({ id: 'new' })
    // Filed as an ordinary pending claim, to wait for the first run after he clears.
    expect(h.claimCreate.mock.calls[0][0].data).toMatchObject({ leagueId: 'L', rosterId: 'A', addPlayerId: 'X', status: 'pending' })
  })

  it('refuses every claim in a closed offseason and in a first-come offseason', async () => {
    h.league = { ...h.league, lifecycleState: 'offseason' }
    await expect(createClaim('L', 'A', { addPlayerId: 'X' } as never)).rejects.toThrow(PHASE_REASONS.offseason_closed)
    h.engineConfig = { offseason_waiver_rules: 'fcfs' }
    await expect(createClaim('L', 'A', { addPlayerId: 'X' } as never)).rejects.toThrow(PHASE_REASONS.offseason_fcfs)
    expect(h.claimCreate).not.toHaveBeenCalled()
  })

  it('positive control: the same claim in season is filed', async () => {
    await expect(createClaim('L', 'A', { addPlayerId: 'X' } as never)).resolves.toEqual({ id: 'new' })
  })
})

describe('the playoff rules in a waiver run', () => {
  beforeEach(() => {
    h.season = { id: 's1', status: 'playoffs' }
    h.claims = [claim('A', 50, 1, 'uA', 'Y'), claim('B', 30, 2, 'uB', 'Z')]
    h.redraftRosters = [
      { id: 'rrA', ownerId: 'uA', isEliminated: true },
      { id: 'rrB', ownerId: 'uB', isEliminated: false },
      { id: 'rrC', ownerId: 'uC', isEliminated: false },
    ]
  })

  it('default: waivers keep running for every team, eliminated or not', async () => {
    const results = await processWaiverClaimsForLeague('L')
    expect(results.filter((r) => r.success).map((r) => r.rosterId).sort()).toEqual(['A', 'B'])
  })

  it('alive only: a team out of the title bracket is refused, an alive one is not', async () => {
    h.engineConfig = { playoff_waiver_rules: 'alive_only' }
    const results = await processWaiverClaimsForLeague('L')
    expect(failed(results, 'A')).toBe(PHASE_REASONS.playoffs_eliminated)
    expect(results.find((r) => r.rosterId === 'B')?.success).toBe(true)
  })

  it('locked: every claim fails with the reason', async () => {
    h.engineConfig = { playoff_waiver_rules: 'locked' }
    const results = await processWaiverClaimsForLeague('L')
    expect(results.every((r) => !r.success && r.message === PHASE_REASONS.playoffs_locked)).toBe(true)
    expect(results).toHaveLength(2)
  })

  it('positive control: the locked rule outside the playoffs changes nothing', async () => {
    h.engineConfig = { playoff_waiver_rules: 'locked' }
    h.season = { id: 's1', status: 'active' }
    expect((await processWaiverClaimsForLeague('L')).every((r) => r.success)).toBe(true)
  })
})

describe('season phase and policy (pure)', () => {
  it('reads the phase from the lifecycle and the latest season', () => {
    expect(resolveWaiverSeasonPhase({ lifecycleState: 'in_season', latestSeasonStatus: 'active', hasCompletedSeason: false })).toBe('regular')
    expect(resolveWaiverSeasonPhase({ lifecycleState: 'in_season', latestSeasonStatus: 'playoffs', hasCompletedSeason: false })).toBe('playoffs')
    expect(resolveWaiverSeasonPhase({ lifecycleState: 'playoffs', latestSeasonStatus: null, hasCompletedSeason: false })).toBe('playoffs')
    for (const s of ['completed', 'offseason', 'renewal_pending']) {
      expect(resolveWaiverSeasonPhase({ lifecycleState: s, latestSeasonStatus: 'complete', hasCompletedSeason: true })).toBe('offseason')
    }
    // Back before next season's draft: offseason. A brand-new league before its first draft: not.
    expect(resolveWaiverSeasonPhase({ lifecycleState: 'pre_draft', latestSeasonStatus: 'setup', hasCompletedSeason: true })).toBe('offseason')
    expect(resolveWaiverSeasonPhase({ lifecycleState: 'pre_draft', latestSeasonStatus: 'setup', hasCompletedSeason: false })).toBe('regular')
  })

  const base = { offseasonRule: 'closed' as const, playoffRule: 'all_teams' as const, dynastyFamily: false, eliminated: null }

  it('offseason: closed by default; FCFS opens first-come adds and no claims; dynasty stays open', () => {
    expect(resolveWaiverPhasePolicy({ ...base, phase: 'offseason' })).toMatchObject({ claimsAllowed: false, immediateAddsAllowed: false, code: 'offseason_closed' })
    expect(resolveWaiverPhasePolicy({ ...base, phase: 'offseason', offseasonRule: 'fcfs' })).toMatchObject({
      claimsAllowed: false, immediateAddsAllowed: true, firstComeAdds: true, code: 'offseason_fcfs',
    })
    expect(resolveWaiverPhasePolicy({ ...base, phase: 'offseason', dynastyFamily: true })).toMatchObject({ claimsAllowed: true, immediateAddsAllowed: true, code: null })
  })

  it('playoffs: an unknown bracket state never blocks under alive-only', () => {
    expect(resolveWaiverPhasePolicy({ ...base, phase: 'playoffs', playoffRule: 'alive_only' }).code).toBeNull()
    expect(resolveWaiverPhasePolicy({ ...base, phase: 'playoffs', playoffRule: 'alive_only', eliminated: false }).code).toBeNull()
    expect(resolveWaiverPhasePolicy({ ...base, phase: 'playoffs', playoffRule: 'alive_only', eliminated: true }).code).toBe('playoffs_eliminated')
    expect(resolveWaiverPhasePolicy({ ...base, phase: 'regular', playoffRule: 'locked' }).code).toBeNull()
  })

  it('claim refusals read as closed waivers (the claims route maps them to WAIVER_CLOSED)', () => {
    for (const reason of Object.values(PHASE_REASONS)) expect(reason.toLowerCase().startsWith('waiver claims are closed')).toBe(true)
  })
})
