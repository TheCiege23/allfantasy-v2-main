import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCaptureWaiverSignal } = vi.hoisted(() => ({
  mockCaptureWaiverSignal: vi.fn(),
}))

vi.mock('@/lib/shared-services/knowledge-graph/SignalIngestionService', () => ({
  captureWaiverSignal: mockCaptureWaiverSignal,
}))

import { recordWaiverClaimSignal } from '@/lib/shared-services/knowledge-graph/WaiverSignalHook'

describe('recordWaiverClaimSignal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCaptureWaiverSignal.mockResolvedValue(undefined)
  })

  it('captures a won signal with the resolved managerKey', async () => {
    await recordWaiverClaimSignal({
      outcome: 'waiver_claim_won',
      leagueId: 'league-1',
      managerKey: 'user-1',
      claimId: 'claim-1',
      addPlayerId: 'player-a',
      dropPlayerId: 'player-b',
      emittedFrom: 'test',
    })

    expect(mockCaptureWaiverSignal).toHaveBeenCalledWith({
      signalType: 'waiver_claim_won',
      leagueId: 'league-1',
      managerKey: 'user-1',
      claimId: 'claim-1',
      addPlayerId: 'player-a',
      dropPlayerId: 'player-b',
      emittedFrom: 'test',
    })
  })

  it('does nothing when managerKey is null/undefined/blank — never captures a malformed signal', async () => {
    await recordWaiverClaimSignal({
      outcome: 'waiver_claim_lost',
      leagueId: 'league-1',
      managerKey: null,
      claimId: 'claim-1',
      addPlayerId: 'player-a',
      emittedFrom: 'test',
    })
    await recordWaiverClaimSignal({
      outcome: 'waiver_claim_lost',
      leagueId: 'league-1',
      managerKey: '   ',
      claimId: 'claim-1',
      addPlayerId: 'player-a',
      emittedFrom: 'test',
    })

    expect(mockCaptureWaiverSignal).not.toHaveBeenCalled()
  })

  it('never throws when the underlying capture call fails', async () => {
    mockCaptureWaiverSignal.mockRejectedValue(new Error('boom'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      recordWaiverClaimSignal({
        outcome: 'waiver_claim_won',
        leagueId: 'league-1',
        managerKey: 'user-1',
        claimId: 'claim-1',
        addPlayerId: 'player-a',
        emittedFrom: 'test',
      })
    ).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
  })
})
