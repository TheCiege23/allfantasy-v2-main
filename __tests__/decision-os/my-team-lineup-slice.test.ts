import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Lineup OS, 2026-11-20 re-score push: My Team's best lineup reaches the grounding packet on a lineup question — the
 * exact text the lineup tool returns (`lib/chimmy/myTeamLineupGrounding.ts`), so the packet and the tool can never
 * disagree. Opt-in (`want.myTeamLineup`), bounded by the packet's deadline, and a non-NFL league without a My Team
 * optimizer stays silent (the sport's own tool answers, by design).
 */

const loadWaiver = vi.fn()

vi.mock('@/lib/decision-os/grounding/decisionBridge', () => ({
  loadWaiverDecisionSlice: loadWaiver,
  loadCommissionerHealthDecisionSlice: vi.fn(async () => null),
}))
vi.mock('@/lib/decision-os/import-os', () => ({ createImportOsLoaders: () => ({ loadAssertions: vi.fn(async () => null) }) }))
vi.mock('@/lib/decision-os/league-os', () => ({ createLeagueOsLoaders: () => ({ loadRules: vi.fn(async () => null) }) }))
vi.mock('@/lib/decision-os/value-os', () => ({
  createValueOsLoaders: () => ({ loadMarket: vi.fn(async () => null), loadDevy: vi.fn(async () => null) }),
}))
vi.mock('@/lib/decision-os/projection-os', () => ({ createProjectionOsLoaders: () => ({ loadFor: vi.fn(async () => null) }) }))
vi.mock('@/lib/chimmy-context/ChimmyContextEngine', () => ({
  ChimmyContextEngine: class {
    loadContext = vi.fn(async () => {
      throw new Error('not under test')
    })
  },
}))
vi.mock('@/lib/intelligence/chimmy/resolveChimmyGrounding', () => ({ resolveCommissionerGroundingOutcome: vi.fn(async () => null) }))
vi.mock('@/lib/intelligence/chimmy/leagueIntelligenceGrounding', () => ({ resolveLeagueIntelligenceGrounding: vi.fn(async () => null) }))
vi.mock('@/lib/intelligence/chimmy/portfolioGrounding', () => ({ resolvePortfolioGrounding: vi.fn(async () => null) }))
const killedFeeds = new Set<string>()
vi.mock('@/lib/decision-os/flags', () => ({
  resolveDecisionOsFeedFlags: async () => ({ enabled: (f: string) => !killedFeeds.has(f), killed: [...killedFeeds] }),
}))


const lineupText = vi.fn()
vi.mock('@/lib/chimmy/myTeamLineupGrounding', () => ({ buildMyTeamLineupContext: lineupText }))

const { buildDecisionOsGroundingPacket } = await import('@/lib/decision-os/grounding/packet')
const { serializeDecisionOsGroundingForPrompt } = await import('@/lib/decision-os/grounding/serialize')

const BLOCK = "BEST LINEUP for Sunday League (week 11, 2026) — THE SAME ANSWER THE MY TEAM SCREEN SHOWS\nVerdict: CHANGE THE LINEUP. Current 101 pts, best 107 pts (+6).\n- WR: start Benchy Burner (15 pts) instead of Wade Hands (9 pts)."

const build = (want: Record<string, boolean>) =>
  buildDecisionOsGroundingPacket({ leagueId: 'lg1', userId: 'u1', sport: 'NFL', season: 2026, want })

describe('grounding packet — My Team lineup slice', () => {
  beforeEach(() => {
    killedFeeds.clear()
    loadWaiver.mockReset()
    lineupText.mockReset()
  })

  it('a lineup question carries My Team’s best lineup, whole, into the prompt', async () => {
    lineupText.mockResolvedValue(BLOCK)
    const packet = await build({ myTeamLineup: true })
    // No ledger callback from the packet: the tool records the call; recording here would grade it twice.
    expect(lineupText).toHaveBeenCalledWith({ leagueId: 'lg1', userId: 'u1' })
    expect(packet.myTeamLineup).toMatchObject({ present: true, value: BLOCK })
    const text = serializeDecisionOsGroundingForPrompt(packet)
    expect(text).toContain('Best lineup (My Team)')
    expect(text).toContain('start Benchy Burner (15 pts) instead of Wade Hands (9 pts)')
  })

  it('is not assembled unless asked for', async () => {
    const packet = await build({})
    expect(lineupText).not.toHaveBeenCalled()
    expect(packet.myTeamLineup).toMatchObject({ present: false, gap: { reason: 'not_requested' } })
  })

  it('a non-NFL league without a My Team optimizer stays silent; a My Team load failure is a named gap', async () => {
    lineupText.mockResolvedValue({ fallback: 'not_nfl' })
    expect((await build({ myTeamLineup: true })).myTeamLineup).toMatchObject({ present: false, gap: { reason: 'not_requested' } })
    lineupText.mockResolvedValue({ fallback: 'no_my_team' })
    const failed = await build({ myTeamLineup: true })
    expect(failed.myTeamLineup).toMatchObject({ present: false, gap: { reason: 'not_computed' } })
    expect(failed.gaps.some((g) => g.slice === 'myTeamLineup')).toBe(true)
  })

  it('a load that throws never rejects the packet', async () => {
    lineupText.mockRejectedValue(new Error('down'))
    const packet = await build({ myTeamLineup: true })
    expect(packet.myTeamLineup).toMatchObject({ present: false, gap: { reason: 'not_computed' } })
  })
})
