/**
 * @vitest-environment node
 *
 * POST /api/ai/waivers/recommend — which leagues reach the waiver engine, and what the panel gets.
 *
 * 🛑 ONLY SLEEPER-ID LEAGUES REACH IT. A Fleaflicker / MFL / Fantrax / Yahoo roster's ids collide
 * with real Sleeper ids (51 of 248 on the production Fleaflicker league); the Decision OS pool strips
 * them, which would leave nobody rostered and every player "available". An ESPN league's ids are
 * translated, but one the identity map cannot place is dropped — still somebody's rostered player —
 * so ESPN is refused too until the pool accounts for them (ESPN 12483 is Matthew Stafford; Sleeper
 * 12483 is Jack Bech). Refused leagues never run the engine, and say why.
 *
 * The route runs the DECISION OS waiver engine now (it called the legacy lib/ai/waivers recommender,
 * a decision-engine-boundary violation). The engine and its loaders are mocked at the module
 * boundary; the claim → panel mapping and the engine-input builder are the real ones.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  platform: 'sleeper' as string | null,
  facts: null as unknown,
  pool: null as unknown,
  claims: [] as unknown[],
  runCalls: 0,
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/entitlements/afAccess', () => ({
  getUserAfProStatus: vi.fn(async () => true),
  AfProRequiredError: class {
    toResponse() {
      return {}
    }
  },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { league: { findUnique: vi.fn(async () => ({ platform: h.platform })) } },
}))
vi.mock('@/lib/decision-os/waiver/loader', () => ({
  loadWaiverWorldFacts: vi.fn(async () => h.facts),
  worldInputFromFacts: vi.fn(() => ({})),
}))
vi.mock('@/lib/decision-os/waiver/deps', () => ({ buildLiveWaiverDecisionDeps: vi.fn(() => ({})) }))
vi.mock('@/lib/decision-os/waiver/pool', () => ({ loadWaiverPool: vi.fn(async () => h.pool) }))
vi.mock('@/lib/decision-os/waiver', () => ({
  runWaiverClaimDecision: vi.fn(async () => {
    h.runCalls++
    return { world: {}, decision: { recommended_actions: h.claims, confidence: 80 } }
  }),
}))

import { POST } from '@/app/api/ai/waivers/recommend/route'

const call = (body: Record<string, unknown> = { leagueId: 'L1' }) =>
  POST(new Request('http://x/api/ai/waivers/recommend', { method: 'POST', body: JSON.stringify(body) }))

const FACTS = {
  sport: 'NFL',
  leagueId: 'L1',
  rosterId: 'r-me',
  settings: { waiverType: 'rolling', normalizedWaiverType: 'rolling', faabBudget: null },
  settingsKnown: true,
  faabRemaining: null,
  waiverPriority: 3,
  rosterSize: 15,
}
const POOL = {
  availablePlayers: [{ id: '4046', name: 'Mapped Guy', position: 'WR', team: 'KC', age: 25, value: 2200, byeWeek: 6 }],
  myRoster: [],
  leagueRosters: [],
  rosterPositions: ['QB', 'WR'],
  leagueTraits: { numTeams: 12, isSF: false, isTEP: false, isDynasty: false },
  currentWeek: 4,
  teamNeeds: { weakestSlots: [{ slot: 'WR2', position: 'WR' }, { slot: 'FLEX', position: 'WR' }], biggestNeed: null, byeWeekClusters: [], positionalDepth: [], dropCandidates: [] },
  poolIncomplete: false,
  leagueRosterCount: 12,
  pricing: { priced: 1, total: 1, basis: 'market' },
}
const claim = (over: Record<string, unknown>) => ({
  addPlayerId: '4046',
  addPlayerName: 'Mapped Guy',
  position: 'WR',
  team: 'KC',
  dropPlayerId: null,
  dropPlayerName: 'Bench Guy',
  faabBid: 12,
  priorityRank: 1,
  compositeScore: 85,
  recommendation: 'Must Add',
  reason: 'Fills your WR2 hole',
  ...over,
})

beforeEach(() => {
  h.platform = 'sleeper'
  h.facts = FACTS
  h.pool = POOL
  h.claims = [claim({})]
  h.runCalls = 0
})

describe('POST /api/ai/waivers/recommend — who reaches the engine', () => {
  it('🛑 a Fleaflicker league never reaches the engine, and the response says why', async () => {
    h.platform = 'fleaflicker'
    const body = await (await call()).json()
    expect(h.runCalls).toBe(0)
    expect(body.recommendations).toEqual([])
    expect(body.insufficientData).toBe(true)
    expect(body.meta.dataGaps).toContain('roster_ids_not_readable_for_platform')
  })

  it('🛑 the same for MFL, Fantrax, Yahoo — and ESPN, whose untranslatable ids are still rostered players', async () => {
    for (const platform of ['mfl', 'fantrax', 'yahoo', 'espn']) {
      h.platform = platform
      await call()
    }
    expect(h.runCalls).toBe(0)
  })

  it('CONTROL: a Sleeper league and a native one reach the engine', async () => {
    for (const platform of ['sleeper', 'native']) {
      h.platform = platform
      const body = await (await call()).json()
      expect(body.meta.dataGaps).not.toContain('roster_ids_not_readable_for_platform')
    }
    expect(h.runCalls).toBe(2)
  })
})

describe('POST /api/ai/waivers/recommend — the panel contract, from the engine', () => {
  it('maps the engine’s claims into the panel’s rows, in priority order, capped by mode', async () => {
    h.claims = [
      claim({ addPlayerId: 'b', addPlayerName: 'Second', priorityRank: 2, compositeScore: 55, recommendation: 'Add' }),
      claim({ addPlayerId: 'a', addPlayerName: 'First', priorityRank: 1, compositeScore: 85, recommendation: 'Must Add' }),
      claim({ addPlayerId: 'c', addPlayerName: 'Third', priorityRank: 3, compositeScore: 30, recommendation: 'Stash' }),
      claim({ addPlayerId: 'd', addPlayerName: 'Fourth', priorityRank: 4, compositeScore: 20, recommendation: 'Monitor' }),
    ]
    const body = await (await call({ leagueId: 'L1', mode: 'quick' })).json()
    expect(body.recommendations.map((r: { addPlayerName: string }) => r.addPlayerName)).toEqual(['First', 'Second', 'Third'])
    expect(body.recommendations[0]).toMatchObject({
      priority: 1,
      confidence: 'high',
      risk: 'low',
      dropPlayerName: 'Bench Guy',
      reasoning: 'Fills your WR2 hole',
      deeperAnalysisPath: '/chimmy/chat?topic=waiver-analysis&leagueId=L1',
      tags: ['WR', 'Must Add'],
    })
    expect(body.recommendations[1]).toMatchObject({ confidence: 'medium', risk: 'medium' })
    expect(body.recommendations[2]).toMatchObject({ confidence: 'low', risk: 'high' })
    expect(body.rosterNeeds).toEqual(['WR'])
    expect(body.insufficientData).toBe(false)
  })

  it('a rolling-waiver league shows no FAAB bid unless asked; a FAAB league shows it', async () => {
    const rolling = await (await call()).json()
    expect(rolling.recommendations[0].suggestedFaabBid).toBeNull()
    h.facts = { ...FACTS, settings: { waiverType: 'faab', normalizedWaiverType: 'faab', faabBudget: 100 }, faabRemaining: 80 }
    const faab = await (await call()).json()
    expect(faab.recommendations[0].suggestedFaabBid).toBe(12)
    expect(faab.leagueContext).toEqual({ leagueId: 'L1', waiverType: 'faab', faabBudget: 100, faabRemaining: 80 })
  })

  it('no roster for you in this league: an honest empty answer, and the engine never runs', async () => {
    h.facts = null
    const body = await (await call()).json()
    expect(body.insufficientData).toBe(true)
    expect(body.meta.dataGaps).toEqual(['roster_not_found'])
    expect(h.runCalls).toBe(0)
  })

  it('a wire with nobody left on it says so, and a wire nobody could price is a fault', async () => {
    h.pool = { ...POOL, availablePlayers: [] }
    const picked = await (await call()).json()
    expect(picked.meta.dataGaps).toEqual(['free_agent_pool_empty'])

    h.pool = { ...POOL, pricing: { priced: 0, total: 40, basis: null } }
    h.claims = []
    const unpriced = await (await call()).json()
    expect(unpriced.insufficientData).toBe(true)
    expect(unpriced.meta.dataGaps).toContain('free_agent_pool_unpriced')
  })
})
