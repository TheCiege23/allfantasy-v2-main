import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Three packet slices were removed on 2026-11-17, and this pins that they stay removed.
 *
 *   managerPsychology      never loaded since Milestone 32 — `serialize.ts` has no entry for it and
 *                          refuses any profile-shaped item, so it was always `not_requested`.
 *   psychologyConsistency  no intent requested it since 2026-11-16 (nothing rendered it).
 *   lineupDecision         no intent requested it since 2026-09-07 (37s against a 3s ceiling), and
 *                          it ran a second start/sit engine the owner retired on 2026-09-29.
 *
 * Manager facts reach Chimmy through the paid `get_manager_record` tool; start/sit through My
 * Team's `optimizeLineup`. Neither path runs through this packet.
 *
 * This file replaced `grounding-psychology-not-loaded.test.ts`. Its byte-identical-prompt
 * assertions held only while the slice existed; the guard that matters now is that the packet
 * the live builder produces carries none of the three, under any request.
 */

const loadContext = vi.fn()

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
vi.mock('@/lib/decision-os/flags', () => ({
  resolveDecisionOsFeedFlags: async () => ({ enabled: () => true, killed: [] }),
}))

const { buildDecisionOsGroundingPacket } = await import('@/lib/decision-os/grounding/packet')
const { serializeDecisionOsGroundingForPrompt } = await import('@/lib/decision-os/grounding/serialize')

const ARGS = { leagueId: 'lg1', userId: 'u1', sport: 'NFL', season: 2026, week: 3 }
const NOW = Date.parse('2026-08-31T20:00:00.000Z')
const REMOVED = ['managerPsychology', 'psychologyConsistency', 'lineupDecision'] as const

beforeEach(() => {
  vi.clearAllMocks()
  loadContext.mockResolvedValue({ meta: { providers: [] } })
})

describe('removed grounding slices stay removed', () => {
  it('the packet carries none of them, in its fields, its sources or its gaps', async () => {
    const p = await buildDecisionOsGroundingPacket(ARGS)
    // Positive control: a real packet came back, with its other slices.
    expect(p.leagueId).toBe('lg1')
    expect(p.meta.sources.map((s) => s.slice)).toContain('savedAnalysis')
    for (const name of REMOVED) {
      expect(`${name}: ${name in p}`).toBe(`${name}: false`)
      expect(p.meta.sources.map((s) => s.slice)).not.toContain(name)
      expect(p.gaps.map((g) => g.slice)).not.toContain(name)
    }
  })

  it('asking for them by name — as the admin proof surface\'s ?want= can — builds nothing for them', async () => {
    const want = Object.fromEntries(REMOVED.map((k) => [k, true])) as Record<string, boolean>
    const p = await buildDecisionOsGroundingPacket({ ...ARGS, want } as never)
    for (const name of REMOVED) expect(`${name}: ${name in p}`).toBe(`${name}: false`)
  })

  it('the prompt names none of them', async () => {
    const text = serializeDecisionOsGroundingForPrompt(await buildDecisionOsGroundingPacket(ARGS), NOW)
    // Guard against a vacuous pass: the prompt has real content.
    expect(text).toContain('WHAT IS AVAILABLE:')
    expect(text).not.toMatch(/managerPsychology|psychologyConsistency|lineupDecision|Lineup decision/)
  })
})
