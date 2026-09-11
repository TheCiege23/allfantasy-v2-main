/**
 * `POST /api/ai/chimmy` — the `leagueId` it accepts must be one the caller may see.
 *
 * 🛑 THE ROUTE TOOK `leagueId` STRAIGHT OFF THE REQUEST BODY. There was no
 * membership check anywhere in it — no `assertLeagueMember`, no
 * `resolveLeagueAccess`, no `resolveLeagueMembership` — and the id flowed into
 * `prisma.league.findUnique`, into the zombie-action branch, and into every
 * memory and history write. `requireFeatureEntitlement` runs first but answers a
 * different question: whether this USER may use the feature, never whether they
 * may see this LEAGUE.
 *
 * 🛑 THE FIRST TEST IN THIS FILE IS A PRECONDITION, NOT A COURTESY. Memory
 * records how the sibling route's suites went green over a live bypass: they
 * asserted "the protected reader was never called" on a request that was refused
 * long before reaching it, so the assertion was true of the vulnerable code too.
 * Every "it was not read" claim below is therefore paired with a test proving the
 * SAME request shape DOES reach that reader when the caller is entitled to it.
 * Without that pair, a refusal anywhere upstream would silently satisfy the suite.
 *
 * ⚠ AND THE CLAIM IS ONLY AS WIDE AS THE SURFACE ASSERTED. What is observed here
 * is `prisma.league.findUnique`. A reader reaching league data through another
 * module would be invisible to this file, exactly as it was to the sibling suite.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  leagueFindUnique: vi.fn(),
  zombieFindUnique: vi.fn(),
  resolveLeagueMembership: vi.fn(),
  runUnifiedOrchestration: vi.fn(),
  requireFeatureEntitlement: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mocks.leagueFindUnique },
    zombieLeague: { findUnique: mocks.zombieFindUnique },
  },
}))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: mocks.resolveLeagueMembership }))
vi.mock('@/lib/ai-orchestration', () => ({ runUnifiedOrchestration: mocks.runUnifiedOrchestration }))
vi.mock('@/lib/subscription/entitlement-middleware', () => ({
  requireFeatureEntitlement: mocks.requireFeatureEntitlement,
}))

// Everything below is memory/telemetry plumbing the authorization question does
// not depend on. Stubbed so the handler runs to completion.
vi.mock('@/lib/ai-memory/chimmy-memory-context', () => ({
  getChimmyMemoryContext: vi.fn(async () => ({ promptSection: '', memoryItemsUsedCount: 0 })),
}))
vi.mock('@/lib/ai-memory/chat-history-store', () => ({
  appendChatHistory: vi.fn(async () => undefined),
  buildChimmyConversationId: vi.fn(() => 'conv-1'),
  getRecentChatHistory: vi.fn(async () => []),
}))
vi.mock('@/lib/ai-memory/ai-memory-store', () => ({
  rememberChimmyAssistantMemory: vi.fn(async () => undefined),
  rememberChimmyUserMessageMemory: vi.fn(async () => undefined),
}))
vi.mock('@/lib/ai-memory/unified-memory-system', () => ({
  recordUnifiedMemoryFromChatTurn: vi.fn(async () => undefined),
}))
vi.mock('@/lib/chimmy-quality/ChimmyQualityAnalytics', () => ({
  recordChimmyQualityEvent: vi.fn(async () => undefined),
}))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: () => false }))
vi.mock('@/lib/sports-evidence/intelligenceIntegration', () => ({
  CertifiedIntelligenceIntegrationService: class {},
}))
vi.mock('@/lib/zombie/chimmy-zombie-persist', () => ({
  parseZombieChimmyIntentFromMessage: vi.fn(() => null),
  persistZombieChimmyAction: vi.fn(async () => undefined),
}))

import { POST } from '@/app/api/ai/chimmy/route'

const VIEWER = 'app-user-uuid-viewer'
const MY_LEAGUE = 'league-i-am-in'
const THEIR_LEAGUE = 'league-i-am-not-in'

function post(body: Record<string, unknown>) {
  return POST(
    new Request('http://localhost/api/ai/chimmy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as never
  )
}

/** A message with sports content and a real league id — the shape that reaches the read. */
const ASK = { userMessage: 'How does PPR scoring work in the NFL?', sport: 'NFL' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getServerSession.mockResolvedValue({ user: { id: VIEWER, email: 'v@example.com' } })
  mocks.requireFeatureEntitlement.mockResolvedValue({ ok: true, decision: {}, tokenSpend: null })
  /*
   * ⚠ THE SHAPE IS `{ ok, response }`, NOT `{ ok, data }`, AND THE PRECONDITION
   * TEST IS WHAT CAUGHT THAT. The first run failed inside
   * `unifiedResponseToContract` reading `response.evidence` of undefined — so the
   * handler never reached the league read, and every `not.toHaveBeenCalled()`
   * below would have passed for that reason alone once a gate existed.
   */
  mocks.runUnifiedOrchestration.mockResolvedValue({
    ok: true,
    response: {
      evidence: [],
      modelOutputs: [],
      primaryAnswer: 'ok',
      confidenceScore: 0.5,
    },
  })
  mocks.leagueFindUnique.mockResolvedValue({ leagueVariant: 'redraft' })
  mocks.zombieFindUnique.mockResolvedValue(null)
  // Default: the viewer IS a member. Individual tests narrow this.
  mocks.resolveLeagueMembership.mockResolvedValue({ ok: true, leagueId: MY_LEAGUE })
})

describe('PRECONDITION — the reader this file guards is actually reachable', () => {
  it('reaches prisma.league.findUnique for a member, with the id from the body', async () => {
    /*
     * 🛑 WITHOUT THIS, EVERY `not.toHaveBeenCalled()` BELOW IS VACUOUS. If the
     * handler refused for an unrelated reason — a validation error, an
     * entitlement denial, a thrown mock — the negative assertions would pass on
     * a completely unguarded route. This proves the path is open before the
     * other tests claim it is closed.
     */
    await post({ ...ASK, leagueId: MY_LEAGUE })
    expect(
      mocks.leagueFindUnique,
      'the league read was never reached — every refusal assertion in this file would be vacuous',
    ).toHaveBeenCalled()
    expect(mocks.leagueFindUnique.mock.calls[0][0]).toMatchObject({ where: { id: MY_LEAGUE } })
  })

  it('consults the membership resolver before reading, and with the caller as the viewer', async () => {
    await post({ ...ASK, leagueId: MY_LEAGUE })
    expect(mocks.resolveLeagueMembership).toHaveBeenCalledWith(MY_LEAGUE, VIEWER)
  })
})

describe('refuses a league the caller is not in', () => {
  it('does not read the league for a non-member', async () => {
    mocks.resolveLeagueMembership.mockResolvedValue({ ok: false, reason: 'not_member', status: 403 })
    const res = await post({ ...ASK, leagueId: THEIR_LEAGUE })
    expect(res.status).toBe(403)
    expect(
      mocks.leagueFindUnique,
      'a non-member reached the League row',
    ).not.toHaveBeenCalled()
    expect(mocks.zombieFindUnique, 'a non-member reached the zombie branch').not.toHaveBeenCalled()
  })

  it('answers a league that does not exist the same way it answers one that is not yours', async () => {
    /*
     * Both come back from the resolver with their own status, and both refuse
     * before the read. They are NOT merged into one status here — these routes
     * already distinguished 403 from 404 and merging would be a second
     * behaviour change riding on a security fix.
     */
    mocks.resolveLeagueMembership.mockResolvedValue({ ok: false, reason: 'not_found', status: 404 })
    const res = await post({ ...ASK, leagueId: 'no-such-league' })
    expect(res.status).toBe(404)
    expect(mocks.leagueFindUnique).not.toHaveBeenCalled()
  })

  it('refuses an anonymous caller without resolving or reading anything', async () => {
    mocks.getServerSession.mockResolvedValue(null)
    const res = await post({ ...ASK, leagueId: THEIR_LEAGUE })
    expect(res.status).toBe(401)
    expect(mocks.resolveLeagueMembership).not.toHaveBeenCalled()
    expect(mocks.leagueFindUnique).not.toHaveBeenCalled()
  })
})

describe('the no-league conversation still works', () => {
  it('does not consult the resolver when no leagueId was sent', async () => {
    /*
     * ⚠ THE GATE MUST NOT BREAK GLOBAL CHAT. Chimmy answers questions with no
     * league attached, and a gate that demanded one would turn this route into
     * league-only. Nothing to authorize means nothing to refuse.
     */
    const res = await post(ASK)
    expect(res.status).not.toBe(403)
    expect(mocks.resolveLeagueMembership).not.toHaveBeenCalled()
    expect(mocks.leagueFindUnique).not.toHaveBeenCalled()
  })
})
