import { describe, expect, it } from 'vitest'
import {
  CommissionerAiManagersBlobSchema,
  DEFAULT_TRADE_RULES,
} from '@/lib/commissioner-ai-draft-manager/types'
import {
  buildApiResponse,
  canAiProposeTrade,
  checkAiProposalRoundCap,
  MAX_AI_TEAMS,
  parseCommissionerAiManagers,
  withUpdatedProposalThrottle,
} from '@/lib/commissioner-ai-draft-manager/CommissionerAiDraftManagerService'

const slotOrder = [
  { slot: 1, rosterId: 'r1', displayName: 'Team One' },
  { slot: 2, rosterId: 'r2', displayName: 'Team Two' },
]

function assignment(
  rosterId: string,
  overrides: Partial<{ active: boolean; aiStyle: string; tradeAggression: string; allowOutbound: boolean }> = {}
) {
  return {
    rosterId,
    aiStyle: 'BALANCED' as const,
    tradeAggression: 'medium' as const,
    active: true,
    ...overrides,
  }
}

describe('commissioner-ai-draft-manager', () => {
  it('schema rejects more than MAX_AI_TEAMS assignments', () => {
    const assignments = Array.from({ length: MAX_AI_TEAMS + 1 }, (_, i) =>
      assignment(`r${i}`)
    )
    const parsed = CommissionerAiManagersBlobSchema.safeParse({
      assignments,
      tradeRules: DEFAULT_TRADE_RULES,
    })
    expect(parsed.success).toBe(false)
  })

  it('parseCommissionerAiManagers falls back to defaults for invalid input', () => {
    const b = parseCommissionerAiManagers(null)
    expect(b.assignments).toEqual([])
    expect(b.tradeRules).toMatchObject(DEFAULT_TRADE_RULES)
  })

  it('buildApiResponse only includes active assignments in assignedAiTeams', () => {
    const blob = parseCommissionerAiManagers({
      assignments: [assignment('r1', { active: false }), assignment('r2', { active: true })],
      tradeRules: DEFAULT_TRADE_RULES,
    })
    const api = buildApiResponse(blob, slotOrder)
    expect(api.assignedAiTeams).toHaveLength(1)
    expect(api.assignedAiTeams[0].teamId).toBe('r2')
    expect(api.assignedAiTeams[0].teamName).toBe('Team Two')
  })

  it('canAiProposeTrade blocks AI→AI when blockAiToAi is true', () => {
    const blob = parseCommissionerAiManagers({
      assignments: [assignment('a'), assignment('b')],
      tradeRules: { ...DEFAULT_TRADE_RULES, blockAiToAi: true },
    })
    const r = canAiProposeTrade({
      blob,
      proposerRosterId: 'a',
      receiverRosterId: 'b',
      now: new Date(),
    })
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/Chimmy teams cannot trade/i)
  })

  it('canAiProposeTrade allows human receiver when AI proposes', () => {
    const blob = parseCommissionerAiManagers({
      assignments: [assignment('a')],
      tradeRules: DEFAULT_TRADE_RULES,
    })
    const r = canAiProposeTrade({
      blob,
      proposerRosterId: 'a',
      receiverRosterId: 'human',
      now: new Date(),
    })
    expect(r.allowed).toBe(true)
  })

  it('canAiProposeTrade respects cooldown', () => {
    const t0 = new Date('2026-01-01T12:00:00Z')
    const blob = parseCommissionerAiManagers({
      assignments: [assignment('a')],
      tradeRules: { ...DEFAULT_TRADE_RULES, proposalCooldownSeconds: 60 },
      _meta: {
        lastOutboundProposalAtByRosterId: { a: t0.toISOString() },
      },
    })
    const tooSoon = canAiProposeTrade({
      blob,
      proposerRosterId: 'a',
      receiverRosterId: 'h',
      now: new Date(t0.getTime() + 30_000),
    })
    expect(tooSoon.allowed).toBe(false)
    const ok = canAiProposeTrade({
      blob,
      proposerRosterId: 'a',
      receiverRosterId: 'h',
      now: new Date(t0.getTime() + 61_000),
    })
    expect(ok.allowed).toBe(true)
  })

  it('checkAiProposalRoundCap enforces max per round for AI proposer', () => {
    const blob = parseCommissionerAiManagers({
      assignments: [assignment('a')],
      tradeRules: { ...DEFAULT_TRADE_RULES, maxProposalsPerRound: 2 },
      _meta: {
        proposalsThisRound: { round: 3, byRosterId: { a: 2 } },
      },
    })
    const hit = checkAiProposalRoundCap(blob, 'a', 3)
    expect(hit.ok).toBe(false)
    expect(hit.reason).toMatch(/Maximum 2/)
    const otherRound = checkAiProposalRoundCap(blob, 'a', 4)
    expect(otherRound.ok).toBe(true)
  })

  it('withUpdatedProposalThrottle increments count and updates last proposal time', () => {
    let blob = parseCommissionerAiManagers({
      assignments: [assignment('x')],
      tradeRules: DEFAULT_TRADE_RULES,
    })
    const now = new Date('2026-06-01T10:00:00Z')
    blob = withUpdatedProposalThrottle(blob, 'x', 2, now)
    expect(blob._meta?.proposalsThisRound).toEqual({ round: 2, byRosterId: { x: 1 } })
    expect(blob._meta?.lastOutboundProposalAtByRosterId?.x).toBe(now.toISOString())
    blob = withUpdatedProposalThrottle(blob, 'x', 2, now)
    expect(blob._meta?.proposalsThisRound?.byRosterId.x).toBe(2)
  })
})
