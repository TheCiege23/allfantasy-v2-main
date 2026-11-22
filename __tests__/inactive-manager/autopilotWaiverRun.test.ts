/** The hourly autopilot waiver run: who it claims for, through which gates, and when it stands down. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const m = vi.hoisted(() => {
  const state = {
    settings: {} as Record<string, unknown>,
    ownerHasPlan: true,
    lifecycleOk: true,
    waivers: { normalizedWaiverType: 'rolling', faabBudget: null as number | null, faabMinBid: null as number | null, allowZeroFaabBid: true },
    faabRemaining: null as number | null,
  }
  return {
    state,
    prisma: {
      $queryRaw: vi.fn(async () => [{ id: 'L' }]),
      $transaction: vi.fn(),
      league: {
        findUnique: vi.fn(async () => ({ id: 'L', userId: 'owner', platform: 'allfantasy', sport: 'NFL', status: 'in_season', lifecycleState: 'in_season', lockAllMoves: false, leagueVariant: null, settings: state.settings })),
      },
      roster: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, platformUserId: `orphan-${where.id}`, faabRemaining: state.faabRemaining, playerData: { lineup_sections: { starters: [{ id: 'qb', position: 'QB' }, { id: 'rb', position: 'RB' }], bench: [{ id: 'te', position: 'TE' }], ir: [], taxi: [], devy: [] } } })) },
    },
    createClaim: vi.fn(async () => ({ id: 'c1' })),
    notify: vi.fn(async () => ({})),
    pending: vi.fn(async () => []),
    log: vi.fn(async () => ({})),
    lifecycle: vi.fn(async () => (state.lifecycleOk ? { ok: true } : { ok: false, err: {} })),
    legality: vi.fn(async () => ({ ok: true })),
    data: vi.fn(async ({ surface }: { surface: string }) =>
      surface === 'waivers'
        ? [{ id: 'faRb', name: 'Free Back', position: 'RB', projectedPoints: 9, injuryStatus: null, product: { yearsExp: 4 } }]
        : [
            { id: 'qb', position: 'QB', projectedPoints: 20, injuryStatus: null, product: { yearsExp: 5 } },
            { id: 'rb', position: 'RB', projectedPoints: 12, injuryStatus: 'Out', product: { yearsExp: 5 } },
            { id: 'te', name: 'Spare End', position: 'TE', projectedPoints: 1, injuryStatus: null, product: { yearsExp: 8 } },
          ],
    ),
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: vi.fn(async () => true) }))
vi.mock('@/server/services/auditService', () => ({ logAction: m.log }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    resolveForUser = vi.fn(async () => ({ hasAccess: m.state.ownerHasPlan }))
  },
}))
vi.mock('@/lib/waiver-wire/claim-service', () => ({ createClaim: m.createClaim, getClaimsByRoster: m.pending }))
vi.mock('@/server/services/leagueLifecycleService', () => ({ assertLifecycleActionAllowed: m.lifecycle }))
vi.mock('@/lib/roster-legality/rosterTransactionGates', () => ({ assertRosterTransactionsAllowed: m.legality }))
vi.mock('@/lib/player-data/getNormalizedPlayerData', () => ({ getNormalizedPlayerData: m.data }))
vi.mock('@/lib/player-data/serializeUnifiedPlayerForApi', () => ({ serializeUnifiedPlayerForApi: (r: unknown) => r }))
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({ getRosterTemplateForLeague: vi.fn(async () => ({ slots: [{ benchCount: 1 }] })) }))
vi.mock('@/lib/sport-defaults/LeagueVariantRegistry', () => ({ getFormatTypeForVariant: () => 'standard' }))
vi.mock('@/lib/league/lineupStarterSlots', () => ({
  resolveLineupStarterSlots: () => [
    { index: 0, label: 'QB', allowedPositions: ['QB'], isFlexible: false },
    { index: 1, label: 'RB', allowedPositions: ['RB'], isFlexible: false },
  ],
}))
vi.mock('@/lib/commissioner-hub/managerHealth', () => ({ getLeagueManagerHealth: vi.fn() }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: m.notify }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ getEffectiveLeagueWaiverSettings: vi.fn(async () => m.state.waivers) }))
vi.mock('@/lib/roster-lineup-engine/lineupLockService', () => ({ resolveFullLineupLockContext: vi.fn() }))
vi.mock('@/lib/roster-lineup-engine/lineupService', () => ({ persistRosterLineupWithEngine: vi.fn() }))

import { AUTOPILOT_CLAIM_ACTION, runAutopilotWaivers } from '@/lib/inactive-manager/inactiveManagerService'

const ap = { style: 'dynasty_owner', since: 's', byUserId: 'commish' }

beforeEach(() => {
  vi.clearAllMocks()
  m.state.ownerHasPlan = true
  m.state.lifecycleOk = true
  m.state.waivers = { normalizedWaiverType: 'rolling', faabBudget: null, faabMinBid: null, allowZeroFaabBid: true }
  m.state.faabRemaining = null
  m.state.settings = { af_managed_lineups: { r1: { since: 's', byUserId: 'commish', autopilot: ap }, r2: { since: 's', byUserId: 'commish' } } }
})

describe('runAutopilotWaivers', () => {
  it('claims for the hole the ruled-out starter leaves, dropping the bench player, for autopilot teams only', async () => {
    const r = await runAutopilotWaivers()
    expect(r).toMatchObject({ leagues: 1, teams: 1, claims: 1 })
    expect(m.createClaim).toHaveBeenCalledTimes(1)
    expect(m.createClaim).toHaveBeenCalledWith('L', 'r1', expect.objectContaining({
      addPlayerId: 'faRb',
      dropPlayerId: 'te',
      faabBid: null,
      userId: 'orphan-r1',
      metadata: { source: 'chimmy_autopilot', style: 'dynasty_owner', slot: 'RB' },
    }))
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ actionType: AUTOPILOT_CLAIM_ACTION, entityId: 'r1', userId: 'commish' }))
    // The league log names the players in Chimmy's move, and the commissioner who handed it the team hears.
    expect(m.log.mock.calls[0]![0]).toMatchObject({ metadata: { addPlayerName: 'Free Back', dropPlayerName: 'Spare End' } })
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ userIds: ['commish'], type: 'chimmy_autopilot_claim', body: 'Free Back for RB, dropping Spare End.' }))
    expect(m.legality).toHaveBeenCalledWith(expect.objectContaining({ rosterIds: ['r1'], kind: 'waiver_claim' }))
  })

  it('bids FAAB in a FAAB league, and keeps the bid out of the log and the commissioner’s alert', async () => {
    m.state.waivers = { normalizedWaiverType: 'faab', faabBudget: 100, faabMinBid: null, allowZeroFaabBid: false }
    m.state.faabRemaining = 60
    expect(await runAutopilotWaivers()).toMatchObject({ claims: 1 })
    expect(m.createClaim).toHaveBeenCalledWith('L', 'r1', expect.objectContaining({ faabBid: 4 }))
    expect(JSON.stringify(m.log.mock.calls[0]![0])).not.toContain('faab')
    expect(String((m.notify.mock.calls[0]![0] as { body: string }).body)).not.toContain('$')
  })

  it('makes no claim a FAAB league would refuse for want of money', async () => {
    m.state.waivers = { normalizedWaiverType: 'faab', faabBudget: 100, faabMinBid: 5, allowZeroFaabBid: true }
    m.state.faabRemaining = 3
    const r = await runAutopilotWaivers()
    expect(r.claims).toBe(0)
    expect(r.skipped.faab_unaffordable).toBe(1)
    expect(m.createClaim).not.toHaveBeenCalled()
  })

  it('without AF Commissioner, runs only the free Chimmy team: the one handed over first', async () => {
    m.state.ownerHasPlan = false
    m.state.settings = { af_managed_lineups: {
      r1: { since: 's', byUserId: 'commish', autopilot: { ...ap, since: '2026-10-02T00:00:00Z' } },
      r3: { since: 's', byUserId: 'commish', autopilot: { ...ap, since: '2026-10-01T00:00:00Z' } },
    } }
    const r = await runAutopilotWaivers()
    expect(r).toMatchObject({ teams: 1, claims: 1, skipped: { not_entitled: 1 } })
    expect(m.createClaim).toHaveBeenCalledTimes(1)
    expect(m.createClaim).toHaveBeenCalledWith('L', 'r3', expect.anything())
    // With the plan, both run.
    vi.clearAllMocks()
    m.state.ownerHasPlan = true
    expect(await runAutopilotWaivers()).toMatchObject({ teams: 2, claims: 2 })
  })

  it('respects the league phase gate the claims route applies', async () => {
    m.state.lifecycleOk = false
    expect(await runAutopilotWaivers()).toMatchObject({ claims: 0, skipped: { waivers_not_open: 1 } })
    expect(m.createClaim).not.toHaveBeenCalled()
  })

  it('a league rule refusing the claim is a skip, not a failure', async () => {
    m.createClaim.mockRejectedValueOnce(new Error('Waiver claims are closed right now.'))
    expect(await runAutopilotWaivers()).toMatchObject({ claims: 0, skipped: { claim_refused: 1 }, failures: [] })
  })
})
