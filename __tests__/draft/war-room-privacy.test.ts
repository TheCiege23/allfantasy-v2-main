/**
 * POST /api/draft-war-room — privacy regression suite (Commit 8, updated Commit 20)
 *
 * War Room is a pure computation endpoint. Privacy properties proven here:
 *
 *   1. Unauthenticated requests → 401.
 *   2. Eligible authenticated users receive a computation result — no DB
 *      WarRoomSnapshot rows are read for any user.
 *   3. The session userId is NEVER forwarded to runDraftWarRoom — body-supplied
 *      userId / targetUserId / managerUserId / ownerUserId fields cannot
 *      influence whose data is returned (there is no per-user DB read at all).
 *   4. Zod strips unknown keys before the engine sees the payload, so injected
 *      identity fields are silently dropped.
 *   5. Query-param userId injection has no effect (route only reads request.json()).
 *   6. Non-eligible users receive 403 (Commit 20 added EntitlementResolver gate).
 *   7. The prisma warRoomSnapshot table is never touched.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const getServerSessionMock = vi.hoisted(() =>
  vi.fn(async () => ({ user: { id: 'user-1' } } as null | { user?: { id?: string } })),
)

// runDraftWarRoom is a pure sync function — mock it to isolate route behaviour.
const runDraftWarRoomMock = vi.hoisted(() =>
  vi.fn((_input: unknown) => ({
    draftMode: 'live_pick',
    currentPickNumber: 5,
    confidencePct: 82,
    bestPick: {
      playerId: 'p-1',
      playerName: 'Justin Jefferson',
      position: 'WR',
      reason: 'Best available',
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
    draftStrategySummary: 'Go WR early.',
    summary: 'Draft WR.',
    generatedAt: new Date().toISOString(),
    rosterBuildScore: 70,
    boardValueScore: 75,
    urgencyScore: 60,
    devyPipelineNotes: [],
    c2cBalanceNotes: [],
    longTermFitNotes: [],
  })),
)

// EntitlementResolver mock — default eligible (hasAccess: true) so all
// privacy/injection tests continue to exercise the engine path unchanged.
const entitlementResolveForUserMock = vi.hoisted(() =>
  vi.fn(async () => ({ hasAccess: true })),
)

// Prisma mock — assert warRoomSnapshot is never touched.
const warRoomSnapshotFindFirstMock = vi.hoisted(() => vi.fn(async () => null))
const warRoomSnapshotFindManyMock = vi.hoisted(() => vi.fn(async () => []))
const warRoomSnapshotCreateMock = vi.hoisted(() => vi.fn(async () => ({})))
const warRoomSnapshotUpsertMock = vi.hoisted(() => vi.fn(async () => ({})))

vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSessionMock(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    resolveForUser(...a: [string, string]) {
      return entitlementResolveForUserMock(...a)
    }
  },
}))
vi.mock('@/lib/draft-war-room', async () => {
  const { z } = await import('zod')
  return {
    runDraftWarRoom: (...a: unknown[]) => runDraftWarRoomMock(...a),
    // Minimal schema that mirrors the real one's Zod strip-unknown-keys behaviour.
    // Unknown keys (userId, targetUserId, etc.) are stripped by default z.object().
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
      findFirst: (...a: unknown[]) => warRoomSnapshotFindFirstMock(...a),
      findMany: (...a: unknown[]) => warRoomSnapshotFindManyMock(...a),
      create: (...a: unknown[]) => warRoomSnapshotCreateMock(...a),
      upsert: (...a: unknown[]) => warRoomSnapshotUpsertMock(...a),
    },
  },
}))

// ---------------------------------------------------------------------------
// Import under test (after mocks are registered)
// ---------------------------------------------------------------------------

const { POST } = await import('@/app/api/draft-war-room/route')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_BODY = {
  currentPickNumber: 5,
  currentRound: 1,
  myTeamId: 'team-abc',
  availablePlayers: [
    { playerId: 'p-1', name: 'Justin Jefferson', position: 'WR', team: 'MIN', adp: 5, value: 90, age: 25, tier: 1 },
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
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/draft-war-room — privacy regression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
    // Default: eligible user
    entitlementResolveForUserMock.mockResolvedValue({ hasAccess: true })
    runDraftWarRoomMock.mockReturnValue({
      draftMode: 'live_pick',
      currentPickNumber: 5,
      confidencePct: 82,
      bestPick: {
        playerId: 'p-1',
        playerName: 'Justin Jefferson',
        position: 'WR',
        reason: 'Best available',
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
      draftStrategySummary: 'Go WR early.',
      summary: 'Draft WR.',
      generatedAt: new Date().toISOString(),
      rosterBuildScore: 70,
      boardValueScore: 75,
      urgencyScore: 60,
      devyPipelineNotes: [],
      c2cBalanceNotes: [],
      longTermFitNotes: [],
    })
  })

  // ── Rule 1: authentication gate ──────────────────────────────────────────

  it('returns 401 when there is no session', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(401)
    expect(runDraftWarRoomMock).not.toHaveBeenCalled()
  })

  it('returns 401 when session has no user id', async () => {
    getServerSessionMock.mockResolvedValue({ user: {} })
    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(401)
    expect(runDraftWarRoomMock).not.toHaveBeenCalled()
  })

  // ── Rule 2: eligible authenticated user receives computation result ────────

  it('returns 200 with war room data for an eligible authenticated user', async () => {
    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toBeDefined()
    expect(json.data.bestPick.playerName).toBe('Justin Jefferson')
  })

  // ── Rule 3 + 4: body userId injection is stripped by Zod, never forwarded ─

  it('session userId is never passed to runDraftWarRoom', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'session-user-99' } })
    await POST(makeRequest(VALID_BODY))
    expect(runDraftWarRoomMock).toHaveBeenCalledTimes(1)
    const arg = runDraftWarRoomMock.mock.calls[0][0] as Record<string, unknown>
    // The session userId must not appear anywhere in the engine input.
    expect(arg).not.toHaveProperty('userId')
    expect(JSON.stringify(arg)).not.toContain('session-user-99')
  })

  it('body userId injection is stripped — engine never receives it', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, userId: 'attacker-user-id' }))
    expect(res.status).toBe(200)
    const arg = runDraftWarRoomMock.mock.calls[0][0] as Record<string, unknown>
    expect(arg).not.toHaveProperty('userId')
    expect(JSON.stringify(arg)).not.toContain('attacker-user-id')
  })

  it('body targetUserId injection is stripped — engine never receives it', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, targetUserId: 'victim-id' }))
    expect(res.status).toBe(200)
    const arg = runDraftWarRoomMock.mock.calls[0][0] as Record<string, unknown>
    expect(arg).not.toHaveProperty('targetUserId')
    expect(JSON.stringify(arg)).not.toContain('victim-id')
  })

  it('body managerUserId injection is stripped — engine never receives it', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, managerUserId: 'other-manager' }))
    expect(res.status).toBe(200)
    const arg = runDraftWarRoomMock.mock.calls[0][0] as Record<string, unknown>
    expect(arg).not.toHaveProperty('managerUserId')
    expect(JSON.stringify(arg)).not.toContain('other-manager')
  })

  it('body ownerUserId injection is stripped — engine never receives it', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, ownerUserId: 'another-owner' }))
    expect(res.status).toBe(200)
    const arg = runDraftWarRoomMock.mock.calls[0][0] as Record<string, unknown>
    expect(arg).not.toHaveProperty('ownerUserId')
    expect(JSON.stringify(arg)).not.toContain('another-owner')
  })

  // ── Rule 5: commissioner-supplied userId injection has no effect ──────────

  it('commissioner userId in body cannot change whose War Room is served', async () => {
    // Commissioner (commissioner-1) tries to access another user's war room
    getServerSessionMock.mockResolvedValue({ user: { id: 'commissioner-1' } })
    await POST(makeRequest({ ...VALID_BODY, userId: 'target-manager-id' }))
    const arg = runDraftWarRoomMock.mock.calls[0][0] as Record<string, unknown>
    expect(arg).not.toHaveProperty('userId')
    expect(JSON.stringify(arg)).not.toContain('target-manager-id')
    expect(JSON.stringify(arg)).not.toContain('commissioner-1')
  })

  // ── Rule 5b: query-param userId injection has no effect ───────────────────

  it('query-param userId injection is ignored — route only reads request.json()', async () => {
    const urlWithParam = 'http://localhost/api/draft-war-room?userId=query-injected-user'
    const res = await POST(makeRequest(VALID_BODY, urlWithParam))
    expect(res.status).toBe(200)
    const arg = runDraftWarRoomMock.mock.calls[0][0] as Record<string, unknown>
    expect(arg).not.toHaveProperty('userId')
    expect(JSON.stringify(arg)).not.toContain('query-injected-user')
  })

  // ── Rule 7: WarRoomSnapshot DB table is never read ────────────────────────

  it('never reads WarRoomSnapshot from the DB for any user', async () => {
    await POST(makeRequest(VALID_BODY))
    expect(warRoomSnapshotFindFirstMock).not.toHaveBeenCalled()
    expect(warRoomSnapshotFindManyMock).not.toHaveBeenCalled()
  })

  it('never writes WarRoomSnapshot to the DB on a normal request', async () => {
    await POST(makeRequest(VALID_BODY))
    expect(warRoomSnapshotCreateMock).not.toHaveBeenCalled()
    expect(warRoomSnapshotUpsertMock).not.toHaveBeenCalled()
  })

  // ── Rule 8: response cannot contain another user's snapshot fields ─────────

  it('response shape is purely the engine output — no DB snapshot fields', async () => {
    const res = await POST(makeRequest(VALID_BODY))
    const json = await res.json()
    // Engine output lives under `data`; no snapshot DB fields like `snapshotKind`,
    // `payload`, `draftSessionId` should appear at the top level.
    expect(json).not.toHaveProperty('snapshotKind')
    expect(json).not.toHaveProperty('payload')
    expect(json).not.toHaveProperty('draftSessionId')
    expect(json.data).toBeDefined()
  })

  // ── Rule 6 (updated Commit 20): non-eligible user receives 403 ───────────

  it('non-eligible authenticated user receives 403 — entitlement gate added in Commit 20', async () => {
    // Both pro_draft_ai and war_room_draft_strategy deny access → 403
    entitlementResolveForUserMock.mockResolvedValue({ hasAccess: false })
    getServerSessionMock.mockResolvedValue({ user: { id: 'free-tier-user' } })
    const res = await POST(makeRequest(VALID_BODY))
    expect(res.status).toBe(403)
    expect(runDraftWarRoomMock).not.toHaveBeenCalled()
    const json = await res.json()
    expect(json.locked).toBe(true)
  })

  // ── Validation: invalid body is rejected before engine runs ───────────────

  it('returns 400 for missing required fields — engine is never called', async () => {
    const res = await POST(makeRequest({ sport: 'NFL' })) // missing currentPickNumber, myTeamId, etc.
    expect(res.status).toBe(400)
    expect(runDraftWarRoomMock).not.toHaveBeenCalled()
  })
})
