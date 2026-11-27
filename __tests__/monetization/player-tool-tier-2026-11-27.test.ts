// @vitest-environment node
/**
 * 🛑 PLAYER TOOLS ARE AF PRO AND AF SUPREME — NOT AF COMMISSIONER ALONE (owner's decision 2026-11-27).
 *
 * Two layers, both through the REAL plan rules (tierMatrixHarness; only the database read is replaced):
 *   1. every player-tool key opens for exactly { pro, supreme };
 *   2. the Trade Finder depth the three finder surfaces read (/core and the redraft Trade Center's partner
 *      search and package finder). The /core finder used `af_intelligence` (Commissioner opens it) and the
 *      redraft two had no gate at all.
 *
 * AF Intelligence (AF projections, AF ADP, the trade breakdown, player deep dives, Chimmy's deep answers)
 * keeps its Pro · Commissioner · Supreme gate on purpose (owner decided that earlier) — pinned at the end
 * so a change to it is a decision, not a side effect.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TIERS, setTier, tiersFor, type Tier } from './tierMatrixHarness'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'

const session = vi.fn()
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => session(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/subscription/EntitlementResolver', async () => (await import('./tierMatrixHarness')).resolverModule())

const leagueRead = vi.fn()
const dbProxy: unknown = new Proxy(() => undefined, {
  get: (_t, k) => (k === 'then' ? undefined : dbProxy),
  apply: () => {
    leagueRead()
    return Promise.reject(new Error('db not available in this test'))
  },
})
vi.mock('@/lib/prisma', () => ({ prisma: dbProxy }))
vi.mock('@/lib/league/league-access', () => ({
  assertLeagueMember: async () => {
    leagueRead()
    return { ok: false, status: 403 }
  },
}))

beforeEach(() => {
  session.mockReset()
  session.mockResolvedValue({ user: { id: 'u1', email: null } })
  leagueRead.mockReset()
})

const PRO_SUPREME: Tier[] = ['pro', 'supreme']

const PLAYER_TOOL_KEYS: SubscriptionFeatureId[] = [
  'legacy_trade_finder', // Trade Finder + Partner Match
  'trade_analyzer', // Trade Evaluator full review, Trade Center AI write-up
  'pro_start_sit', // start/sit AI
  'ai_waivers', // waiver AI
  'pro_waiver_ai',
  'pro_trade_ai', // draft-pick trade AI sentence
  'pro_draft_ai', // draft-room AI
  'ai_chat', // Chimmy voice, legacy chat
  'player_ai_recommendations',
  'planning_tools',
  'matchup_explanations',
  'player_comparison_explanations',
  'league_ai_coaching',
  'pro_lineup_optimizer',
  'pro_matchup_analysis',
  'pro_autocoach',
  'guillotine_ai',
  'salary_cap_ai',
  'survivor_ai',
  'big_brother_ai',
  'zombie_ai',
  'decision_log_history',
]

describe('every player-tool key opens for AF Pro and AF Supreme only', () => {
  for (const key of PLAYER_TOOL_KEYS) {
    it(key, async () => {
      expect(await tiersFor(key)).toEqual(PRO_SUPREME)
    })
  }

  it('the paid cost gates for player tools name such a key', async () => {
    const { AI_COST_GATES } = await import('@/lib/ai-protection/costGate')
    for (const k of ['start_sit_ai', 'trade_ai', 'trade_center_ai', 'draft_ai', 'chimmy_voice', 'legacy_chat'] as const) {
      const featureId = (AI_COST_GATES[k] as { featureId?: SubscriptionFeatureId }).featureId
      expect([k, featureId && (await tiersFor(featureId))]).toEqual([k, PRO_SUPREME])
    }
  })

  it('the /af-legacy finder tab (cost gate trade_finder) is the same rule plus AF Legacy (owner, 2026-11-27)', async () => {
    const { AI_COST_GATES } = await import('@/lib/ai-protection/costGate')
    expect(AI_COST_GATES.trade_finder.featureId).toBe('legacy_tab_trade_finder')
    expect(await tiersFor('legacy_tab_trade_finder')).toEqual(['pro', 'legacy', 'supreme'])
  })

  it('the /core trade finder depth reads the Trade Finder key, not af_intelligence', async () => {
    const { CORE_DEPTH } = await import('@/lib/core-app/coreDepthAccess')
    expect(CORE_DEPTH.trade_finder).toMatchObject({ featureId: 'legacy_trade_finder', planName: 'AF Pro', upgradePath: '/upgrade?plan=pro' })
  })
})

/*
 * The three Trade Finder surfaces (/api/league/trade-finder, /api/redraft/trades/discovery and
 * /package-finder) read the `trade_finder` depth. Until the free taste (later the same day) they refused
 * every tier outside {pro, supreme} with a 403; now those tiers get the top idea and a lock —
 * __tests__/monetization/free-tastes-2026-11-27.test.ts runs each surface against all five tiers. Here,
 * the depth itself:
 */
describe('the Trade Finder depth unlocks for exactly AF Pro and AF Supreme', () => {
  for (const tier of TIERS) {
    it(`${tier}`, async () => {
      setTier(tier)
      const { resolveCoreDepth } = await import('@/lib/core-app/corePaywall')
      const access = await resolveCoreDepth('u1', 'trade_finder', { now: new Date('2026-11-27T18:00:00Z') })
      expect(access.unlocked).toBe(PRO_SUPREME.includes(tier))
    })
  }
})

describe('left on their current gate for the owner to confirm (2026-11-27)', () => {
  it('af_intelligence (AF projections, AF ADP, trade breakdown, player deep dives, Chimmy deep) = Pro · Commissioner · Supreme', async () => {
    expect(await tiersFor('af_intelligence')).toEqual(['pro', 'commissioner', 'supreme'])
  })
  it('manager_psychology (Competitive Edge) = every paid plan', async () => {
    expect(await tiersFor('manager_psychology')).toEqual(['pro', 'commissioner', 'legacy', 'supreme'])
  })
})
