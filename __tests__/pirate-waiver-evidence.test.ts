import { beforeEach, describe, expect, it, vi } from 'vitest'
import { certifyPirateWaiverWitness } from '@/lib/pirate/waiverEvidence'
import { prisma } from '@/lib/prisma'
import { assertLeagueActionGate } from '@/server/services/leagueActionGate'
import { assertRosterTransactionsAllowed } from '@/lib/roster-legality/rosterTransactionGates'
import { getEffectiveLeagueWaiverSettings } from '@/lib/waiver-wire/settings-service'
import { loadWaiverPhasePolicy } from '@/lib/waiver-wire/season-phase-gate'
import { loadDailyTransactionPolicy, dailyScheduleImmediateAddRefusal, dailyUnlockImmediateAddRefusal } from '@/lib/waiver-wire/daily-schedule-gate'
import { loadDroppedPlayerHold, loadDroppedPlayerHoldPolicy } from '@/lib/waiver-wire/dropped-player-waivers'
import { assertWaiverClaimEligibility } from '@/lib/waiver-wire/transaction-eligibility'

vi.mock('@/lib/prisma', () => ({ prisma: { leagueWaiverState: { findUnique: vi.fn() }, waiverClaim: { findFirst: vi.fn() } } }))
vi.mock('@/server/services/leagueActionGate', () => ({ assertLeagueActionGate: vi.fn() }))
vi.mock('@/lib/roster-legality/rosterTransactionGates', () => ({ assertRosterTransactionsAllowed: vi.fn() }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ getEffectiveLeagueWaiverSettings: vi.fn() }))
vi.mock('@/lib/waiver-wire/season-phase-gate', () => ({ loadWaiverPhasePolicy: vi.fn() }))
vi.mock('@/lib/waiver-wire/daily-schedule-gate', () => ({ loadDailyTransactionPolicy: vi.fn(), dailyScheduleImmediateAddRefusal: vi.fn(), dailyUnlockImmediateAddRefusal: vi.fn() }))
vi.mock('@/lib/waiver-wire/dropped-player-waivers', () => ({ loadDroppedPlayerHold: vi.fn(), loadDroppedPlayerHoldPolicy: vi.fn() }))
vi.mock('@/lib/waiver-wire/transaction-eligibility', () => ({ assertWaiverClaimEligibility: vi.fn() }))

const input = { leagueId: 'league', rosterId: 'af-roster', actorUserId: 'manager', playerId: 'candidate', now: new Date('2026-10-26T00:18:00Z') }
const settings = { normalizedWaiverType: 'fcfs', instantFaAfterClear: false, freeAgencyMode: 'standard', freeAgentUnlockBehavior: null }

describe('Pirate waiver evidence uses real immediate-add gates', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(loadWaiverPhasePolicy).mockResolvedValue({ immediateAddsAllowed: true, firstComeAdds: false } as never)
    vi.mocked(assertLeagueActionGate).mockResolvedValue({ ok: true } as never)
    vi.mocked(assertRosterTransactionsAllowed).mockResolvedValue({ ok: true })
    vi.mocked(getEffectiveLeagueWaiverSettings).mockResolvedValue(settings as never)
    vi.mocked(prisma.leagueWaiverState.findUnique).mockResolvedValue({ processingLocked: false } as never)
    vi.mocked(prisma.waiverClaim.findFirst).mockResolvedValue(null)
    vi.mocked(loadDailyTransactionPolicy).mockResolvedValue(null)
    vi.mocked(loadDroppedPlayerHold).mockResolvedValue(null)
    vi.mocked(loadDroppedPlayerHoldPolicy).mockResolvedValue({ hours: 24, byPosition: {} } as never)
    vi.mocked(assertWaiverClaimEligibility).mockResolvedValue(undefined)
  })

  it('certifies a no-drop pickup only after the transaction validator accepts it', async () => {
    expect(await certifyPirateWaiverWitness(input)).toBe(true)
    expect(assertWaiverClaimEligibility).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'league', rosterId: 'af-roster', addPlayerId: 'candidate', dropPlayerId: null }))
  })

  it('refuses competitive waiver claims even when a player is unrostered', async () => {
    vi.mocked(getEffectiveLeagueWaiverSettings).mockResolvedValue({ ...settings, normalizedWaiverType: 'faab', freeAgentUnlockBehavior: 'after_waiver_run' } as never)
    expect(await certifyPirateWaiverWitness(input)).toBe(false)
    expect(assertWaiverClaimEligibility).not.toHaveBeenCalled()
  })

  it('certifies only the specified add-and-drop pair, including canonical drop limits and undroppable checks', async () => {
    expect(await certifyPirateWaiverWitness({ ...input, dropPlayerId: 'bench-drop' })).toBe(true)
    expect(assertWaiverClaimEligibility).toHaveBeenLastCalledWith(expect.objectContaining({ addPlayerId: 'candidate', dropPlayerId: 'bench-drop' }))
    for (const message of ['Weekly drop limit reached', 'Player is undroppable', 'This bench player is locked']) {
      vi.mocked(assertWaiverClaimEligibility).mockRejectedValueOnce(new Error(message))
      expect(await certifyPirateWaiverWitness({ ...input, dropPlayerId: 'bench-drop' })).toBe(false)
    }
  })

  it('refuses pending claims, processing locks, and closed season phases', async () => {
    vi.mocked(prisma.waiverClaim.findFirst).mockResolvedValue({ id: 'pending' } as never)
    expect(await certifyPirateWaiverWitness(input)).toBe(false)
    vi.mocked(prisma.waiverClaim.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.leagueWaiverState.findUnique).mockResolvedValue({ processingLocked: true } as never)
    expect(await certifyPirateWaiverWitness(input)).toBe(false)
    vi.mocked(loadWaiverPhasePolicy).mockResolvedValue({ immediateAddsAllowed: false } as never)
    expect(await certifyPirateWaiverWitness(input)).toBe(false)
  })

  it('refuses a commissioner or roster-legality block', async () => {
    vi.mocked(assertLeagueActionGate).mockResolvedValue({ ok: false } as never)
    expect(await certifyPirateWaiverWitness(input)).toBe(false)
    vi.mocked(assertLeagueActionGate).mockResolvedValue({ ok: true } as never)
    vi.mocked(assertRosterTransactionsAllowed).mockResolvedValue({ ok: false, error: 'Roster locked', code: 'COMMISSIONER_ROSTER_LOCKED' })
    expect(await certifyPirateWaiverWitness(input)).toBe(false)
  })

  it('refuses a locked daily waiver day', async () => {
    vi.mocked(loadDailyTransactionPolicy).mockResolvedValue({ policy: { immediateAddsAllowed: false } } as never)
    expect(await certifyPirateWaiverWitness(input)).toBe(false)
  })

  it('verifies dropped-player holds even when the daily helper returned no refusal', async () => {
    vi.mocked(loadDailyTransactionPolicy).mockResolvedValue({ policy: { immediateAddsAllowed: true } } as never)
    vi.mocked(dailyScheduleImmediateAddRefusal).mockResolvedValue(null)
    vi.mocked(loadDroppedPlayerHold).mockResolvedValue({ until: new Date('2026-10-27T00:18:00Z') } as never)
    expect(await certifyPirateWaiverWitness(input)).toBe(false)
  })

  it('supports daily free agency only when the candidate has cleared its holds', async () => {
    vi.mocked(getEffectiveLeagueWaiverSettings).mockResolvedValue({ ...settings, normalizedWaiverType: 'faab', freeAgentUnlockBehavior: 'daily' } as never)
    vi.mocked(dailyUnlockImmediateAddRefusal).mockResolvedValue('Still on waivers')
    expect(await certifyPirateWaiverWitness(input)).toBe(false)
    vi.mocked(dailyUnlockImmediateAddRefusal).mockResolvedValue(null)
    expect(await certifyPirateWaiverWitness(input)).toBe(true)
  })

  it('fails closed when a roster is full or a lookup is unavailable', async () => {
    vi.mocked(assertWaiverClaimEligibility).mockRejectedValue(new Error('Roster is full'))
    expect(await certifyPirateWaiverWitness(input)).toBe(false)
    vi.mocked(getEffectiveLeagueWaiverSettings).mockRejectedValue(new Error('Unavailable'))
    expect(await certifyPirateWaiverWitness(input)).toBe(false)
  })
})
