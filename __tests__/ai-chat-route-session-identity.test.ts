// @vitest-environment node
/**
 * app/api/ai/chat/route.ts — access-control fix. `context_scope.sleeper_username` used to be
 * trusted directly from the request body and passed straight into a LegacyUser lookup, with no
 * check that it belonged to the authenticated session — the same bug class as the Fantrax route
 * fixed earlier. Identity is now derived from the session's own AppUser.legacyUser relation.
 * Uses a real, filtering in-memory Prisma fake (not just call-argument assertions) so the actual
 * session -> AppUser -> LegacyUser resolution is genuinely exercised.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  prismaMock,
  store,
  getServerSessionMock,
  runCostControlledOpenAITextMock,
} = vi.hoisted(() => {
  type AppUserRow = { id: string; legacyUserId: string | null }
  type LegacyUserRow = {
    id: string
    sleeperUsername: string
    displayName: string
    leagues: never[]
    aiReports: never[]
  }

  const store = {
    appUsers: new Map<string, AppUserRow>(),
    legacyUsers: new Map<string, LegacyUserRow>(), // keyed by sleeperUsername
  }

  const prismaMock = {
    appUser: {
      findUnique: vi.fn(async ({ where, select }: any) => {
        const appUser = store.appUsers.get(where.id)
        if (!appUser) return null
        const legacyUser = appUser.legacyUserId
          ? Array.from(store.legacyUsers.values()).find((l) => l.id === appUser.legacyUserId)
          : null
        if (select?.legacyUser) {
          return { legacyUser: legacyUser ? { sleeperUsername: legacyUser.sleeperUsername } : null }
        }
        return appUser
      }),
    },
    legacyUser: {
      findUnique: vi.fn(async ({ where }: any) => {
        const user = store.legacyUsers.get(where.sleeperUsername)
        if (!user) return null
        return { ...user, leagues: [], aiReports: [] }
      }),
    },
    userProfile: {
      findUnique: vi.fn(async () => null),
    },
  }

  const getServerSessionMock = vi.fn()
  const runCostControlledOpenAITextMock = vi.fn(async () => ({
    ok: true,
    text: 'Chimmy response text.',
    model: 'gpt-4o-mini',
  }))

  return { prismaMock, store, getServerSessionMock, runCostControlledOpenAITextMock }
})

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (handler: any) => handler }))
vi.mock('@/lib/preferences/userTemporalContextForAI', () => ({
  buildUserTemporalContextForAI: () => ({ promptLine: 'today is a test day' }),
}))
vi.mock('@/lib/ai-protection', () => ({
  checkAiRateLimit: () => ({ allowed: true, remaining: 9, retryAfterSec: 0 }),
}))
vi.mock('@/lib/error-tracking', () => ({ logAiFailure: vi.fn() }))
vi.mock('@/lib/openai-client', () => ({ openaiChatTextStream: vi.fn() }))
vi.mock('@/lib/ai-player-context', () => ({
  getUniversalAIContext: () => '',
  getPlayerAnalyticsBatch: vi.fn(async () => new Map()),
}))
vi.mock('@/lib/player-analytics', () => ({
  getPlayerAnalyticsBatch: vi.fn(async () => new Map()),
  computeAthleticGrade: vi.fn(),
  computeCollegeProductionGrade: vi.fn(),
}))
vi.mock('@/lib/user-events', () => ({ logUserEventByUsername: vi.fn() }))
vi.mock('@/lib/ai/output-logger', () => ({ logAiOutput: vi.fn(async () => {}) }))
vi.mock('@/lib/ai/AISportContextResolver', () => ({
  buildSportContextString: () => '',
  resolveSportForAI: () => 'NFL',
}))
vi.mock('@/lib/league-defaults-orchestrator/SportVariantContextResolver', () => ({
  resolveSportVariantContext: () => ({ sport: 'NFL', isFootballIdp: false, isNflIdp: false, formatType: 'redraft' }),
}))
vi.mock('@/lib/league-access', () => ({ assertLeagueMember: vi.fn(async () => ({ isMember: true })) }))
vi.mock('@/lib/feature-toggle', () => ({ isAIAssistantEnabled: vi.fn(async () => true) }))
vi.mock('@/lib/ai-cost-control', () => ({ runCostControlledOpenAIText: runCostControlledOpenAITextMock }))
vi.mock('@/lib/subscription/entitlement-middleware', () => ({
  requireFeatureEntitlement: vi.fn(async () => ({ ok: true, decision: {}, tokenSpend: null, tokenPreview: null })),
}))
vi.mock('@/lib/tokens/TokenSpendService', () => ({
  TokenSpendService: class {
    refundSpendByLedger = vi.fn(async () => null)
  },
}))
vi.mock('@/lib/chimmy-context', () => ({
  chimmyContextEngine: { loadContext: vi.fn() },
  classifyChimmyIntent: vi.fn(),
  composeChimmyPrompt: vi.fn(),
  selectProvidersForIntent: vi.fn(),
}))
vi.mock('@/lib/chimmy-context/flags', () => ({
  shouldInjectChimmyContext: () => ({ eligible: false }),
}))
vi.mock('@/lib/chimmy-context/intel/intelligenceBundle', () => ({ buildIntelligenceBundle: vi.fn() }))
vi.mock('@/lib/chimmy-context/telemetry/recordRun', () => ({ recordChimmyContextRun: vi.fn() }))

import { POST } from '@/app/api/ai/chat/route'

const ROUTE_URL = 'http://localhost/api/ai/chat'

function postRequest(body: Record<string, unknown>) {
  return new NextRequest(ROUTE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  store.appUsers.clear()
  store.legacyUsers.clear()
  getServerSessionMock.mockResolvedValue({ user: { id: 'session-user', email: 'session-user@test.com' } })

  store.legacyUsers.set('sessionuserreal', {
    id: 'legacy-session-user',
    sleeperUsername: 'sessionuserreal',
    displayName: 'Session User Real Name',
    leagues: [],
    aiReports: [],
  })
  store.legacyUsers.set('victimusername', {
    id: 'legacy-victim',
    sleeperUsername: 'victimusername',
    displayName: 'Victim Real Name',
    leagues: [],
    aiReports: [],
  })
  store.appUsers.set('session-user', { id: 'session-user', legacyUserId: 'legacy-session-user' })
})

describe('POST /api/ai/chat — session-derived identity', () => {
  it('rejects an unauthenticated request', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const res = await POST(
      postRequest({ message: 'hi', context_scope: { sleeper_username: 'victimusername' } })
    )
    expect(res.status).toBe(401)
  })

  it("uses the session's own linked LegacyUser, ignoring a client-supplied context_scope.sleeper_username naming a different real account — the vulnerability this test guards against", async () => {
    const res = await POST(
      postRequest({
        message: 'What is my team status?',
        context_scope: { sleeper_username: 'victimusername', include_legacy: true },
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.legacy_context.display_name).toBe('Session User Real Name')
    expect(body.legacy_context.display_name).not.toBe('Victim Real Name')
  })

  it('returns 400 when the session user has no linked LegacyUser at all — never falls back to the body-supplied username', async () => {
    store.appUsers.set('session-user', { id: 'session-user', legacyUserId: null })

    const res = await POST(
      postRequest({ message: 'hi', context_scope: { sleeper_username: 'victimusername' } })
    )
    expect(res.status).toBe(400)
    // Confirms the rejection happened before ever looking up the body's (attacker) username.
    expect(prismaMock.legacyUser.findUnique).not.toHaveBeenCalled()
  })

  it("a user with their own real linked LegacyUser gets their own context correctly", async () => {
    const res = await POST(
      postRequest({ message: 'What is my team status?', context_scope: { sleeper_username: 'sessionuserreal' } })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.legacy_context.display_name).toBe('Session User Real Name')
  })
})
