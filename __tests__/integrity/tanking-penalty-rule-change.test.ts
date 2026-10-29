/** A tanking-penalty edit tells members what changed, through the league rules "What changed" card. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '../helpers/createMockNextRequest'

const m = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(async () => []),
    league: { findUnique: vi.fn(async () => ({ settings: {} })), update: vi.fn(async () => ({})) },
  }
  return {
    platform: 'allfantasy' as string,
    publish: vi.fn(async () => undefined),
    upsert: vi.fn(async () => ({ leagueId: 'L' })),
    transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  }
})
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/subscription/requireEntitlement', () => ({ requireEntitlement: vi.fn(async () => 'commish') }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: vi.fn(async () => undefined) }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: vi.fn() }))
vi.mock('@/lib/integrity/coverage', () => ({ buildIntegrityCoverage: vi.fn() }))
vi.mock('@/lib/league-rules-explainer/publishRuleChanges', () => ({ publishRuleChangesEvent: m.publish }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueIntegritySettings: { upsert: m.upsert },
    $transaction: m.transaction,
    league: { findUnique: vi.fn(async () => ({ platform: m.platform })) },
  },
}))

import { PUT } from '@/app/api/leagues/[leagueId]/integrity/handler'

const put = (body: unknown) =>
  PUT(createMockNextRequest('http://x/api/leagues/L/integrity', { method: 'PUT', body }) as never, { params: Promise.resolve({ leagueId: 'L' }) })

beforeEach(() => {
  vi.clearAllMocks()
  m.platform = 'allfantasy'
})

describe('a tanking-penalty edit', () => {
  it('publishes the before and after as a rule change', async () => {
    expect((await put({ tankingPenalties: { penalty: 'faab', faabPercent: 50 } })).status).toBe(200)
    expect(m.publish).toHaveBeenCalledWith({
      leagueId: 'L',
      actorUserId: 'commish',
      section: 'integrity',
      changes: [
        {
          key: 'tankingPenalty',
          before: expect.objectContaining({ penalty: 'forfeit_pick' }),
          after: expect.objectContaining({ penalty: 'faab', faabPercent: 50 }),
        },
      ],
    })
  })

  it('an edit to anything else, or in an imported league, publishes nothing', async () => {
    await put({ collusionSensitivity: 'high' })
    expect(m.publish).not.toHaveBeenCalled()
    m.platform = 'sleeper'
    await put({ tankingPenalties: { penalty: 'faab' } })
    expect(m.publish).not.toHaveBeenCalled()
  })
})
