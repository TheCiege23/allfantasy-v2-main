/**
 * Chimmy's league-rules facts (lib/chimmy/decisionEnvelopeGrounding.ts) state how many seasons ahead draft
 * picks can be traded — the horizon the trade engine offers native picks over and the Draft Pick Settings
 * tab sets. Before, Chimmy knew only that dynasty picks can be traded, not how far ahead.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  league: vi.fn(),
  dynasty: vi.fn(),
  decisionOs: null as null | ((ctx: { league: unknown }) => Promise<{ facts?: Array<{ key: string; value: unknown; citation: { basis: string } }> }>),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: m.league }, dynastyLeagueConfig: { findUnique: m.dynasty } } }))
vi.mock('@/lib/decision-os/envelope/orchestrate', () => ({
  orchestrateInformationalAnswer: vi.fn(async (args: { decisionOs: typeof m.decisionOs }) => {
    m.decisionOs = args.decisionOs
    return { envelope: { league: null, refusals: [], evidenceGaps: [] }, promptBlock: '', partial: false, clientPayload: {} }
  }),
}))
vi.mock('@/lib/decision-os/envelope/actionCapability', () => ({ describeAction: () => ({}) }))

import { buildDecisionEnvelopeGrounding } from '@/lib/chimmy/decisionEnvelopeGrounding'

const snapshot = (over: Record<string, unknown> = {}) => ({
  id: 'L1', platform: 'manual', platformLeagueId: 'L1', isDynasty: true, leagueType: 'dynasty', sport: 'NFL',
  settings: {}, keeperCount: null, keeperCostSystem: null, keeperRoundPenalty: null, lastSyncedAt: null, ...over,
})

async function facts(snap: ReturnType<typeof snapshot>) {
  await buildDecisionEnvelopeGrounding({ message: 'how far ahead can I trade picks?', userId: 'u1', snapshot: snap as never })
  const os = await m.decisionOs!({ league: { id: snap.id } })
  return (os.facts ?? []).filter((f) => f.key === 'league.picks.tradeYears')
}

beforeEach(() => {
  vi.clearAllMocks()
  m.league.mockResolvedValue({ draftPickTrading: true })
  m.dynasty.mockResolvedValue({ futurePicksYearsOut: 5 })
})

describe('the pick-trade horizon fact', () => {
  it('states the commissioner’s horizon as league-reported', async () => {
    const [fact] = await facts(snapshot())
    expect(fact).toMatchObject({ value: 5, citation: { basis: 'provider_reported' } })
  })

  it('no stored value is the engine’s default of 3, marked inferred; an out-of-range value is clamped like the engine', async () => {
    m.dynasty.mockResolvedValueOnce(null)
    expect((await facts(snapshot()))[0]).toMatchObject({ value: 3, citation: { basis: 'inferred' } })
    m.dynasty.mockResolvedValueOnce({ futurePicksYearsOut: 9 })
    expect((await facts(snapshot()))[0]!.value).toBe(5)
  })

  it('says nothing for an import, a redraft league, a league with pick trading off, or a failed read', async () => {
    expect(await facts(snapshot({ platform: 'sleeper' }))).toEqual([])
    expect(await facts(snapshot({ isDynasty: false, leagueType: 'redraft' }))).toEqual([])
    m.league.mockResolvedValueOnce({ draftPickTrading: false })
    expect(await facts(snapshot())).toEqual([])
    m.league.mockRejectedValueOnce(new Error('db down'))
    expect(await facts(snapshot())).toEqual([])
  })
})
