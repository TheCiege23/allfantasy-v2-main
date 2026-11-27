// @vitest-environment node
/**
 * 🛑 PLAYER TOOLS ARE AF PRO AND AF SUPREME — NOT AF COMMISSIONER ALONE (owner's decision 2026-11-27).
 *
 * Two layers, both through the REAL plan rules (tierMatrixHarness; only the database read is replaced):
 *   1. every player-tool key opens for exactly { pro, supreme };
 *   2. the three Trade Finder surfaces — /core (/api/league/trade-finder) and the redraft Trade Center's
 *      partner search and package finder — refuse every other tier before any league read. The /core
 *      finder used `af_intelligence` (Commissioner opens it) and the redraft two had no gate at all.
 *
 * AF Intelligence (AF projections, AF ADP, the trade breakdown, player deep dives, Chimmy's deep answers)
 * keeps its Pro · Commissioner · Supreme gate on purpose (owner decided that earlier) — pinned at the end
 * so a change to it is a decision, not a side effect.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
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
    for (const k of ['start_sit_ai', 'trade_ai', 'trade_center_ai', 'trade_finder', 'draft_ai', 'chimmy_voice', 'legacy_chat'] as const) {
      const featureId = (AI_COST_GATES[k] as { featureId?: SubscriptionFeatureId }).featureId
      expect([k, featureId && (await tiersFor(featureId))]).toEqual([k, PRO_SUPREME])
    }
  })

  it('the /core trade finder depth reads the Trade Finder key, not af_intelligence', async () => {
    const { CORE_DEPTH } = await import('@/lib/core-app/coreDepthAccess')
    expect(CORE_DEPTH.trade_finder).toMatchObject({ featureId: 'legacy_trade_finder', planName: 'AF Pro', upgradePath: '/upgrade?plan=pro' })
  })
})

type Surface = { name: string; run: () => Promise<Response> }
const SURFACES: Surface[] = [
  {
    name: '/core trade finder (/api/league/trade-finder)',
    run: async () => (await import('@/app/api/league/trade-finder/route')).GET(new NextRequest('http://localhost/api/league/trade-finder?leagueId=L1')),
  },
  {
    name: 'redraft Trade Center partner search (/api/redraft/trades/discovery)',
    run: async () =>
      (await import('@/app/api/redraft/trades/discovery/route')).GET(new NextRequest('http://localhost/api/redraft/trades/discovery?leagueId=L1&rosterId=r1')),
  },
  {
    name: 'redraft Trade Center package finder (/api/redraft/trades/package-finder)',
    run: async () =>
      (await import('@/app/api/redraft/trades/package-finder/route')).POST(
        new NextRequest('http://localhost/api/redraft/trades/package-finder', {
          method: 'POST',
          body: JSON.stringify({ leagueId: 'L1', myRosterId: 'r1', partnerRosterId: 'r2' }),
        }),
      ),
  },
]

describe('the Trade Finder surfaces follow the same rule, server-side', () => {
  for (const s of SURFACES) {
    for (const tier of TIERS) {
      const open = PRO_SUPREME.includes(tier)
      it(`${s.name} — ${tier}: ${open ? 'goes on to the league' : '403 before any league read'}`, async () => {
        setTier(tier)
        let status = 599
        let code: string | null = null
        try {
          const res = await s.run()
          status = res.status
          code = ((await res.json().catch(() => ({}))) as { code?: string }).code ?? null
        } catch {
          // Thrown by the (absent) database AFTER the gate.
        }
        if (open) {
          expect(code).not.toBe('feature_not_entitled')
          expect(leagueRead).toHaveBeenCalled()
        } else {
          expect([status, code]).toEqual([403, 'feature_not_entitled'])
          expect(leagueRead).not.toHaveBeenCalled()
        }
      })
    }
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
