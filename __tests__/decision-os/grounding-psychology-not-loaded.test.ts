import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { GroundedSlice } from '@/lib/decision-os/grounding/packet'
import type { PsychologyProfileFact } from '@/lib/decision-os/psychology-os'

/**
 * The packet stopped loading manager psychology, because the prompt cannot render it.
 *
 * `serialize.ts` has no `managerPsychology` entry in its "WHAT IS AVAILABLE" list and refuses any
 * profile-shaped item on sight (Milestone 32), so every chat turn paid a psychology-os read for a
 * value nothing printed. These tests pin three things:
 *
 *   1. the read is gone (a positive control shows the mock is live and returns sufficient profiles);
 *   2. the serialized prompt is BYTE-IDENTICAL to the one built from the packet the old builder
 *      produced — the same packet with the profiles present;
 *   3. `DECISION_OS_FEED_MANAGER_PSYCHOLOGY` keeps its meaning: killed still reads `disabled`.
 *
 * ⚠ ONE PROMPT DOES CHANGE, ON PURPOSE. The read's only visible effect was a gap line for a league
 * WITHOUT sufficient profiles ("No behavioural profiles have been built…"), telling Chimmy to
 * report profile data as missing. Measured against the pre-change builder: sufficient-profiles
 * and killed prompts are byte-identical; the no-profiles prompt loses exactly that one line and
 * becomes byte-identical to the sufficient-profiles prompt. The last test pins that.
 */

const NOW = Date.parse('2026-08-31T20:00:00.000Z')

const loadProfiles = vi.fn()
const loadContext = vi.fn()

vi.mock('@/lib/decision-os/psychology-os', () => ({
  createPsychologyOsLoaders: () => ({ loadProfiles }),
}))
vi.mock('@/lib/decision-os/import-os', () => ({
  createImportOsLoaders: () => ({ loadAssertions: vi.fn().mockResolvedValue(null) }),
}))
vi.mock('@/lib/decision-os/league-os', () => ({
  createLeagueOsLoaders: () => ({ loadRules: vi.fn().mockResolvedValue(null) }),
}))
vi.mock('@/lib/decision-os/value-os', () => ({
  createValueOsLoaders: () => ({ loadMarket: vi.fn().mockResolvedValue(null), loadDevy: vi.fn().mockResolvedValue(null) }),
}))
vi.mock('@/lib/decision-os/projection-os', () => ({
  createProjectionOsLoaders: () => ({ loadFor: vi.fn().mockResolvedValue(null) }),
}))
vi.mock('@/lib/chimmy-context/ChimmyContextEngine', () => ({
  ChimmyContextEngine: class {
    loadContext = loadContext
  },
}))
vi.mock('@/lib/intelligence/chimmy/resolveChimmyGrounding', () => ({
  resolveCommissionerGroundingOutcome: vi.fn().mockResolvedValue({ status: 'ok', text: 'commissioner brief' }),
}))
vi.mock('@/lib/intelligence/chimmy/leagueIntelligenceGrounding', () => ({
  resolveLeagueIntelligenceGrounding: vi.fn().mockResolvedValue('league brief'),
}))
vi.mock('@/lib/intelligence/chimmy/portfolioGrounding', () => ({
  resolvePortfolioGrounding: vi.fn().mockResolvedValue({ status: 'ok', text: 'portfolio brief' }),
}))
let killedFeeds: string[] = []
vi.mock('@/lib/decision-os/flags', () => ({
  resolveDecisionOsFeedFlags: async () => ({
    enabled: (f: string) => !killedFeeds.includes(f),
    killed: killedFeeds,
  }),
}))

const { buildDecisionOsGroundingPacket } = await import('@/lib/decision-os/grounding/packet')
const { serializeDecisionOsGroundingForPrompt } = await import('@/lib/decision-os/grounding/serialize')

const ARGS = { leagueId: 'lg1', userId: 'u1', sport: 'NFL', season: 2026, week: 3 }

const PROFILES: PsychologyProfileFact[] = [
  {
    managerId: 'm1',
    sport: 'NFL',
    labels: ['aggressive', 'win-now'],
    scores: { aggressionScore: 80, activityScore: 71, tradeFrequencyScore: null, waiverFocusScore: null, riskToleranceScore: 64 },
    evidenceCount: 40,
    unmeasuredDimensions: [],
    anySufficient: true,
    updatedAt: '2026-08-30T00:00:00.000Z',
    trajectory: { hasTrajectory: false, summary: 'Only one season clears the evidence floor.', seasonsRecorded: 1 },
  } as PsychologyProfileFact,
]

/** The slice the pre-change builder produced for a league with sufficient profiles. */
function legacyPresentSlice(): GroundedSlice<PsychologyProfileFact[]> {
  return {
    present: true,
    value: PROFILES,
    asOf: '2026-08-30T00:00:00.000Z',
    servedFrom: 'store',
    confidence: null,
    conclusive: { ok: true },
    gap: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  killedFeeds = []
  loadProfiles.mockResolvedValue(PROFILES)
  loadContext.mockResolvedValue({ meta: { providers: [] } })
})

describe('managerPsychology is not loaded into the Chimmy packet', () => {
  it('positive control: the psychology mock is live and would return sufficient profiles', async () => {
    const { createPsychologyOsLoaders } = await import('@/lib/decision-os/psychology-os')
    const rows = await createPsychologyOsLoaders().loadProfiles({ leagueId: 'lg1', sport: 'NFL' })
    expect(rows?.some((p) => p.anySufficient)).toBe(true)
    loadProfiles.mockClear()
  })

  it('does not read psychology-os on a chat packet', async () => {
    const p = await buildDecisionOsGroundingPacket(ARGS)
    expect(loadProfiles).not.toHaveBeenCalled()
    expect(p.managerPsychology.present).toBe(false)
    expect(p.managerPsychology.gap?.reason).toBe('not_requested')
    // not_requested is not a user-facing gap, so nothing new reaches the prompt.
    expect(p.gaps.map((g) => g.slice)).not.toContain('managerPsychology')
  })

  it('the serialized prompt is byte-identical to the one built with the profiles present', async () => {
    const p = await buildDecisionOsGroundingPacket(ARGS)
    const withProfiles = { ...p, managerPsychology: legacyPresentSlice() }
    const now = serializeDecisionOsGroundingForPrompt(p, NOW)
    const before = serializeDecisionOsGroundingForPrompt(withProfiles, NOW)
    // Guard against a vacuous pass: the prompt has real content.
    expect(now).toContain('WHAT IS AVAILABLE:')
    expect(now).toBe(before)
    expect(now).not.toMatch(/aggressive|win-now|managerPsychology/)
  })

  it('the kill switch keeps its meaning: a killed feed still reads as disabled', async () => {
    killFeeds('managerPsychology')
    const p = await buildDecisionOsGroundingPacket(ARGS)
    expect(loadProfiles).not.toHaveBeenCalled()
    expect(p.managerPsychology.gap?.reason).toBe('disabled')
    expect(p.meta.killedFeeds).toContain('managerPsychology')
  })

  it('a league with no profiles gets the same prompt as one with profiles — no profile gap line', async () => {
    const withProfiles = serializeDecisionOsGroundingForPrompt(await buildDecisionOsGroundingPacket(ARGS), NOW)
    loadProfiles.mockResolvedValue([])
    const without = serializeDecisionOsGroundingForPrompt(await buildDecisionOsGroundingPacket(ARGS), NOW)
    expect(without).not.toMatch(/behavioural profiles/i)
    expect(without).toBe(withProfiles)
  })
})

function killFeeds(...feeds: string[]) {
  killedFeeds = feeds
}
