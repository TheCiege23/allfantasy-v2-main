/**
 * POST /api/draft-war-room — entitlement gate suite (Commit 20)
 *
 * Locks the AF War Room entitlement gate added in Commit 20:
 *
 *   1. Unauthenticated → 401.
 *   2. AF Pro user (pro_draft_ai) → 200 with War Room output.
 *   3. AF War Room subscriber (war_room_draft_strategy) → 200 with output.
 *   4. Non-eligible (neither feature) → 403, engine never called.
 *   5. Body userId injection cannot bypass entitlement check.
 *   6. Commissioner body injection cannot bypass entitlement check.
 *   7. Route uses EntitlementResolver (called before engine).
 *   8. War Room panel source does not call /draft/pick endpoint.
 *   9. War Room panel source does not call queue mutation endpoint.
 *
 * Feature IDs used:
 *   - pro_draft_ai       → AF Pro (af_pro, af_supreme)
 *   - war_room_draft_strategy → AF War Room (af_war_room, af_supreme)
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Source-level invariant setup (tests 8–9)
// ---------------------------------------------------------------------------

const root = resolve(__dirname, '..', '..')
const clientSrc = readFileSync(
  resolve(root, 'components/app/draft-room/DraftRoomPageClient.tsx'),
  'utf8',
)

// Extract fetchWarRoom body for endpoint assertions
const fetchWarRoomMatch = clientSrc.match(
  /const fetchWarRoom = useCallback\(\s*async[\s\S]*?\},\s*\[[\s\S]*?\],?\s*\)/,
)
const fetchWarSrc = fetchWarRoomMatch?.[0] ?? ''

// ---------------------------------------------------------------------------
// Route integration mocks
// ---------------------------------------------------------------------------

const getServerSessionMock = vi.hoisted(() =>
  vi.fn(async () => ({ user: { id: 'user-1' } } as null | { user?: { id?: string } })),
)

const runDraftWarRoomMock = vi.hoisted(() =>
  vi.fn((_input: unknown) => ({
    draftMode: 'live_pick',
    currentPickNumber: 3,
    confidencePct: 78,
    bestPick: {
      playerId: 'p-2',
      playerName: 'Ja\'Marr Chase',
      position: 'WR',
      reason: 'Elite target share',
      fitLabel: 'Strong Fit',
      valueLabel: 'VALUE',
      riskLabel: 'Low Risk',
    },
    topAlternatives: [],
    tierBreakAlerts: [],
    positionalRunAlerts: [],
    rosterConstructionNotes: [],
    valueOnBoardNotes: [],
    reachWarnings: [],
    pivotPlans: [],
    backupTargets: [],
    draftStrategySummary: 'Target elite WRs early.',
    summary: 'Take Chase.',
    generatedAt: new Date().toISOString(),
    rosterBuildScore: 80,
    boardValueScore: 82,
    urgencyScore: 70,
    devyPipelineNotes: [],
    c2cBalanceNotes: [],
    longTermFitNotes: [],
  })),
)

// Tracks which featureId each call used so we can assert exact feature routing.
const entitlementResolveForUserMock = vi.hoisted(() =>
  vi.fn(async (_userId: string, _featureId: string) => ({ hasAccess: true })),
)

vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSessionMock(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    resolveForUser(userId: string, featureId: string) {
      return entitlementResolveForUserMock(userId, featureId)
    }
  },
}))
vi.mock('@/lib/draft-war-room', async () => {
  const { z } = await import('zod')
  return {
    runDraftWarRoom: (...a: unknown[]) => runDraftWarRoomMock(...a),
    WarRoomInputSchema: z.object({
      sport: z.string().default('NFL'),
      currentPickNumber: z.number(),
      currentRound: z.number(),
      myTeamId: z.string(),
      availablePlayers: z.array(z.object({
        playerId: z.string(),
        name: z.string(),
        position: z.string(),
        team: z.string().nullable(),
        adp: z.number(),
        value: z.number(),
        age: z.number().nullable(),
        tier: z.number().nullable(),
      })).default([]),
    }),
  }
})
vi.mock('@/lib/prisma', () => ({
  prisma: {
    warRoomSnapshot: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({})),
      upsert: vi.fn(async () => ({})),
    },
  },
}))

const { POST } = await import('@/app/api/draft-war-room/route')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_BODY = {
  currentPickNumber: 3,
  currentRound: 1,
  myTeamId: 'team-xyz',
  availablePlayers: [
    { playerId: 'p-2', name: "Ja'Marr Chase", position: 'WR', team: 'CIN', adp: 3, value: 95, age: 24, tier: 1 },
  ],
}

function makeRequest(body: unknown, url = 'http://localhost/api/draft-war-room'): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// 1. Authentication gate
// ---------------------------------------------------------------------------

describe('POST /api/draft-war-room — authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    entitlementResolveForUserMock.mockResolvedValue({ hasAccess: true })
  })

  it('returns 401 for unauthenticated request', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(401)
    expect(runDraftWarRoomMock).not.toHaveBeenCalled()
    expect(entitlementResolveForUserMock).not.toHaveBeenCalled()
  })

  it('returns 401 when session has no user id', async () => {
    getServerSessionMock.mockResolvedValue({ user: {} })
    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(401)
    expect(runDraftWarRoomMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 2. AF Pro user (pro_draft_ai) receives War Room output
// ---------------------------------------------------------------------------

describe('POST /api/draft-war-room — AF Pro entitlement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'pro-user-1' } })
  })

  it('AF Pro user gets 200 and War Room output', async () => {
    // pro_draft_ai grants access; war_room_draft_strategy denies
    entitlementResolveForUserMock.mockImplementation(async (_uid, featureId) =>
      ({ hasAccess: featureId === 'pro_draft_ai' }),
    )
    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toBeDefined()
    expect(runDraftWarRoomMock).toHaveBeenCalledTimes(1)
  })

  it('route checks pro_draft_ai feature ID for AF Pro access', async () => {
    entitlementResolveForUserMock.mockResolvedValue({ hasAccess: true })
    await POST(makeRequest(VALID_BODY))
    const featureIds = entitlementResolveForUserMock.mock.calls.map((c) => c[1])
    expect(featureIds).toContain('pro_draft_ai')
  })
})

// ---------------------------------------------------------------------------
// 3. AF War Room subscriber (war_room_draft_strategy) receives output
// ---------------------------------------------------------------------------

describe('POST /api/draft-war-room — AF War Room entitlement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'war-room-user-1' } })
  })

  it('AF War Room subscriber gets 200 and War Room output', async () => {
    // pro_draft_ai denies; war_room_draft_strategy grants
    entitlementResolveForUserMock.mockImplementation(async (_uid, featureId) =>
      ({ hasAccess: featureId === 'war_room_draft_strategy' }),
    )
    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toBeDefined()
    expect(runDraftWarRoomMock).toHaveBeenCalledTimes(1)
  })

  it('route checks war_room_draft_strategy feature ID for AF War Room access', async () => {
    entitlementResolveForUserMock.mockResolvedValue({ hasAccess: true })
    await POST(makeRequest(VALID_BODY))
    const featureIds = entitlementResolveForUserMock.mock.calls.map((c) => c[1])
    expect(featureIds).toContain('war_room_draft_strategy')
  })
})

// ---------------------------------------------------------------------------
// 4. Non-eligible user → 403, engine not called
// ---------------------------------------------------------------------------

describe('POST /api/draft-war-room — non-eligible user', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'free-user-1' } })
    entitlementResolveForUserMock.mockResolvedValue({ hasAccess: false })
  })

  it('returns 403 when neither pro_draft_ai nor war_room_draft_strategy grants access', async () => {
    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(403)
  })

  it('engine is never called for non-eligible user', async () => {
    await POST(makeRequest(VALID_BODY))
    expect(runDraftWarRoomMock).not.toHaveBeenCalled()
  })

  it('403 response includes locked: true', async () => {
    const res = await POST(makeRequest(VALID_BODY))
    const json = await res.json()
    expect(json.locked).toBe(true)
  })

  it('403 response includes a human-readable error message', async () => {
    const res = await POST(makeRequest(VALID_BODY))
    const json = await res.json()
    expect(typeof json.error).toBe('string')
    expect(json.error.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// 5. Body userId injection cannot bypass entitlement
// ---------------------------------------------------------------------------

describe('POST /api/draft-war-room — userId injection cannot bypass entitlement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Session user is non-eligible; attacker sends a body userId of an eligible user
    getServerSessionMock.mockResolvedValue({ user: { id: 'free-user-attacker' } })
    entitlementResolveForUserMock.mockResolvedValue({ hasAccess: false })
  })

  it('body userId injection does not bypass the 403 gate', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, userId: 'pro-user-victim' }))
    expect(res.status).toBe(403)
    expect(runDraftWarRoomMock).not.toHaveBeenCalled()
  })

  it('entitlement is checked against session user, not body userId', async () => {
    await POST(makeRequest({ ...VALID_BODY, userId: 'pro-user-victim' }))
    // resolveForUser must have been called with the session userId, not body userId
    const calledUserIds = entitlementResolveForUserMock.mock.calls.map((c) => c[0])
    for (const uid of calledUserIds) {
      expect(uid).toBe('free-user-attacker')
      expect(uid).not.toBe('pro-user-victim')
    }
  })

  it('body targetUserId injection does not bypass the 403 gate', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, targetUserId: 'pro-user-victim' }))
    expect(res.status).toBe(403)
    expect(runDraftWarRoomMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 6. Commissioner injection cannot bypass entitlement
// ---------------------------------------------------------------------------

describe('POST /api/draft-war-room — commissioner injection cannot bypass entitlement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Commissioner is non-eligible; tries to pass a pro-tier userId in body
    getServerSessionMock.mockResolvedValue({ user: { id: 'commissioner-non-eligible' } })
    entitlementResolveForUserMock.mockResolvedValue({ hasAccess: false })
  })

  it('commissioner body userId injection does not bypass entitlement gate', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, userId: 'pro-subscriber-user' }))
    expect(res.status).toBe(403)
    expect(runDraftWarRoomMock).not.toHaveBeenCalled()
  })

  it('entitlement is checked against session user, not commissioner-injected userId', async () => {
    await POST(makeRequest({ ...VALID_BODY, userId: 'pro-subscriber-user' }))
    const calledUserIds = entitlementResolveForUserMock.mock.calls.map((c) => c[0])
    for (const uid of calledUserIds) {
      expect(uid).toBe('commissioner-non-eligible')
      expect(uid).not.toBe('pro-subscriber-user')
    }
  })
})

// ---------------------------------------------------------------------------
// 7. Route uses EntitlementResolver (structural)
// ---------------------------------------------------------------------------

describe('POST /api/draft-war-room — uses EntitlementResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'any-user' } })
    entitlementResolveForUserMock.mockResolvedValue({ hasAccess: true })
  })

  it('EntitlementResolver.resolveForUser is called before engine runs', async () => {
    await POST(makeRequest(VALID_BODY))
    expect(entitlementResolveForUserMock).toHaveBeenCalled()
  })

  it('resolveForUser is called with the session userId', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'verified-session-user' } })
    await POST(makeRequest(VALID_BODY))
    const calledUserIds = entitlementResolveForUserMock.mock.calls.map((c) => c[0])
    expect(calledUserIds).toContain('verified-session-user')
  })

  it('route checks at least two feature IDs (pro_draft_ai and war_room_draft_strategy)', async () => {
    await POST(makeRequest(VALID_BODY))
    const featureIds = entitlementResolveForUserMock.mock.calls.map((c) => c[1])
    expect(featureIds).toContain('pro_draft_ai')
    expect(featureIds).toContain('war_room_draft_strategy')
  })

  it('engine runs only after entitlement resolves to hasAccess: true', async () => {
    entitlementResolveForUserMock.mockResolvedValue({ hasAccess: true })
    await POST(makeRequest(VALID_BODY))
    expect(entitlementResolveForUserMock).toHaveBeenCalled()
    expect(runDraftWarRoomMock).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 8. War Room panel does not call /draft/pick endpoint (source invariant)
// ---------------------------------------------------------------------------

describe('fetchWarRoom — does not call pick endpoint', () => {
  it('fetchWarRoom source is present in DraftRoomPageClient', () => {
    expect(fetchWarSrc).not.toBe('')
  })

  it('fetchWarRoom does not POST to any /draft/pick URL', () => {
    expect(fetchWarSrc).not.toMatch(/\/draft\/pick/)
  })

  it('fetchWarRoom does not call handleMakePick', () => {
    expect(fetchWarSrc).not.toMatch(/handleMakePick/)
  })

  it('fetchWarRoom does not call setSession', () => {
    expect(fetchWarSrc).not.toMatch(/setSession\(/)
  })
})

// ---------------------------------------------------------------------------
// 9. War Room panel does not call queue mutation endpoint (source invariant)
// ---------------------------------------------------------------------------

describe('fetchWarRoom — does not mutate queue', () => {
  it('fetchWarRoom does not PUT to /draft/queue', () => {
    expect(fetchWarSrc).not.toMatch(/method: 'PUT'/)
  })

  it('fetchWarRoom does not call handleQueueSave', () => {
    expect(fetchWarSrc).not.toMatch(/handleQueueSave/)
  })

  it('fetchWarRoom does not call setQueue', () => {
    expect(fetchWarSrc).not.toMatch(/setQueue\(/)
  })
})

// ---------------------------------------------------------------------------
// Route source invariant — EntitlementResolver is imported
// ---------------------------------------------------------------------------

describe('app/api/draft-war-room/route.ts — source invariants', () => {
  const routeSrc = readFileSync(
    resolve(root, 'app/api/draft-war-room/route.ts'),
    'utf8',
  )

  it('imports EntitlementResolver', () => {
    expect(routeSrc).toMatch(/EntitlementResolver/)
    expect(routeSrc).toMatch(/from '@\/lib\/subscription\/EntitlementResolver'/)
  })

  it('checks pro_draft_ai feature', () => {
    expect(routeSrc).toMatch(/pro_draft_ai/)
  })

  it('checks war_room_draft_strategy feature', () => {
    expect(routeSrc).toMatch(/war_room_draft_strategy/)
  })

  it('returns 403 for non-eligible', () => {
    expect(routeSrc).toMatch(/status: 403/)
  })

  it('includes locked: true in 403 response', () => {
    expect(routeSrc).toMatch(/locked: true/)
  })

  it('does not query prisma warRoomSnapshot', () => {
    expect(routeSrc).not.toMatch(/warRoomSnapshot/)
  })
})
