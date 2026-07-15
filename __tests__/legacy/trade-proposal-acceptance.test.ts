import { describe, it, expect, vi } from 'vitest'

/**
 * Regression coverage for the Trade Command Center dual-acceptance bug
 * (AF_DATA_PROVENANCE_AUDIT.md demo risk #4).
 *
 * Acceptance likelihood is computed deterministically by computeTradeAcceptance() and attached
 * as acceptanceModel.score. The LLM prompt forbids the model from emitting its own acceptance
 * number, but instruction != guarantee. sanitizeProposalNarrative() is the belt-and-suspenders
 * seam: the LLM may only contribute the four narrative fields; any acceptance-like field it
 * slips in is dropped before the proposal is returned. These tests prove a rogue
 * "acceptance": 88 never reaches the client.
 */

// Avoid the route's module-load side effects (telemetry wrapper, OpenAI client, prisma).
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: vi.fn(() => (h: unknown) => h) }))
vi.mock('@/lib/openai-client', () => ({
  openaiChatJson: vi.fn(),
  parseJsonContentFromChatCompletion: vi.fn(),
}))

import { sanitizeProposalNarrative } from '@/server/api-route-modules/legacy/trade/proposal-generator/route'

const ALLOWLIST = ['theirPitch', 'yourAdvantage', 'tradePitch', 'fairnessNote'].sort()

describe('sanitizeProposalNarrative (provenance #4)', () => {
  it('passes the four narrative fields through unchanged (happy path)', () => {
    const out = sanitizeProposalNarrative({
      theirPitch: 'They get a WR1',
      yourAdvantage: 'You get youth',
      tradePitch: 'Win-now move',
      fairnessNote: 'Roughly even',
    })
    expect(out).toEqual({
      theirPitch: 'They get a WR1',
      yourAdvantage: 'You get youth',
      tradePitch: 'Win-now move',
      fairnessNote: 'Roughly even',
    })
  })

  it('DROPS a rogue LLM-authored acceptance number (and every non-allowlisted field)', () => {
    const out = sanitizeProposalNarrative({
      theirPitch: 'pitch',
      acceptance: 88,
      acceptancePct: 88,
      pitchAcceptance: 'high',
      likelihood: 0.92,
      acceptanceProbability: 0.7,
      extra: 'nope',
    }) as Record<string, unknown>

    // Only the allowlist survives — the rogue keys are gone entirely.
    expect(Object.keys(out).sort()).toEqual(ALLOWLIST)
    for (const rogue of ['acceptance', 'acceptancePct', 'pitchAcceptance', 'likelihood', 'acceptanceProbability', 'extra']) {
      expect(rogue in out).toBe(false)
    }
    // ...and the rogue value 88 is nowhere in the sanitized output.
    expect(Object.values(out)).not.toContain(88)
    expect(out.theirPitch).toBe('pitch')
  })

  it('defaults to nulls for null / undefined / non-object input (never throws)', () => {
    const expected = { theirPitch: null, yourAdvantage: null, tradePitch: null, fairnessNote: null }
    expect(sanitizeProposalNarrative(null)).toEqual(expected)
    expect(sanitizeProposalNarrative(undefined)).toEqual(expected)
    expect(sanitizeProposalNarrative('a string')).toEqual(expected)
    expect(sanitizeProposalNarrative(42)).toEqual(expected)
  })

  it('assembled proposal exposes exactly ONE acceptance number (acceptanceModel.score)', () => {
    // Mirrors the route's finalProposals.map(...) construction (line ~540): the deterministic
    // acceptanceModel plus the sanitized narrative — even when the LLM tried to inject its own.
    const rogueAi = { theirPitch: 'p', acceptance: 88, acceptancePct: 88, likelihood: 0.9 }
    const proposal = {
      label: 'Fair & Balanced',
      acceptanceModel: { score: 55, factors: [], summary: 'even', optimizations: [] },
      ...sanitizeProposalNarrative(rogueAi),
    }

    // Exactly these keys — no acceptance / acceptancePct / likelihood leaked from the LLM.
    expect(Object.keys(proposal).sort()).toEqual(
      ['acceptanceModel', 'fairnessNote', 'label', 'theirPitch', 'tradePitch', 'yourAdvantage'].sort()
    )
    // The single acceptance figure is the deterministic one.
    expect(proposal.acceptanceModel.score).toBe(55)
    // The rogue LLM number is nowhere in the serialized proposal.
    expect(JSON.stringify(proposal)).not.toContain('88')
  })
})
