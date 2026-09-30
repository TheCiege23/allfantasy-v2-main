import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/*
 * THE LEGACY CHAT MUST NOT SEND USERS TO A TOOL THAT NO LONGER EXISTS (2026-09-30).
 *
 * Chimmy's /af-legacy chat reads saved `league_analyze` / `otb_packages` snapshots. Nothing writes
 * either any more — the league trade finder that wrote `league_analyze` was removed with its route
 * (1b2e29ca4), and no code in the repo writes `otb_packages`. The system prompt still told the model,
 * when a snapshot was missing, to reply "Please run the Trade Finder first" / "Please run OTB Packages
 * analysis first" — sending the user to run something that cannot produce the data. This pins the
 * prompt the model is ACTUALLY sent, through the real route, with the model call mocked.
 */

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  readSnapshotsForUser: vi.fn(),
  readLatestSnapshot: vi.fn(),
}))

vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (handler: unknown) => handler }))
vi.mock('@/lib/ai/openai-route-client', () => ({
  getOpenAIRouteClient: () => ({ chat: { completions: { create: mocks.create } } }),
}))
vi.mock('@/lib/api-auth', () => ({
  requireAuthOrOrigin: () => ({ authenticated: true }),
  forbiddenResponse: () => new Response('forbidden', { status: 403 }),
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => null) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/ai-protection/costGate', () => ({ aiCostGate: vi.fn(async () => null) }))
vi.mock('@/lib/user-chat-context', () => ({
  buildUserChatContext: vi.fn(async () => null),
  buildEnhancedUserContext: vi.fn(async () => null),
  formatContextForSystemPrompt: vi.fn(() => ''),
}))
vi.mock('@/lib/trade-engine/snapshot-store', () => ({ readSnapshotsForUser: mocks.readSnapshotsForUser }))
vi.mock('@/lib/trade-engine/snapshots', () => ({ readLatestSnapshot: mocks.readLatestSnapshot }))
vi.mock('@/lib/chat-data-enrichment', () => ({
  enrichChatWithData: vi.fn(async () => ({ context: '', sources: {} })),
  buildDataSourcesSummary: vi.fn(() => []),
}))
vi.mock('@/lib/ai-memory', () => ({ recordMemoryEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/badge-engine', () => ({ checkMilestoneBadges: vi.fn(async () => []) }))
vi.mock('@/lib/prisma', () => ({ prisma: { aIMemoryEvent: { count: vi.fn(async () => 1) } } }))
vi.mock('@/lib/legacy/requireLegacySleeperIdentity', () => ({
  requireLegacySleeperIdentity: vi.fn(async () => ({ ok: true, identity: { sleeperUsername: 'someone' } })),
}))

import { POST as chatPOST } from '@/server/api-route-modules/legacy/chat/route'
import { POST as snapshotPOST } from '@/server/api-route-modules/legacy/snapshots/latest/route'

const call = (handler: unknown, url: string, body: unknown) =>
  (handler as (req: NextRequest) => Promise<Response>)(
    new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  )

/** The system prompt the route hands the model for "What trades should I make?". */
async function systemPromptSent(): Promise<string> {
  const res = await call(chatPOST, 'http://localhost/api/legacy/chat', {
    messages: [{ role: 'user', content: 'What trades should I make?' }],
    sleeperUsername: 'someone',
    leagueId: 'league-1',
  })
  expect(res.status).toBe(200)
  expect(mocks.create).toHaveBeenCalledTimes(1)
  const messages = mocks.create.mock.calls[0]![0].messages as Array<{ role: string; content: string }>
  expect(messages[0]!.role).toBe('system')
  return messages[0]!.content
}

/** Any instruction to go RUN a tool to produce the missing data. */
const RUN_A_TOOL = /\b[Rr]un (the )?(Trade Finder|OTB Packages|league-analyze)\b|has not run Trade Finder/

beforeEach(() => {
  mocks.create.mockReset()
  mocks.create.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] })
  mocks.readSnapshotsForUser.mockReset()
  mocks.readLatestSnapshot.mockReset()
})

describe('legacy chat — no snapshots (the case every user is now in)', () => {
  it('the prompt never tells the model to send the user off to run a tool', async () => {
    mocks.readSnapshotsForUser.mockResolvedValue([])
    const prompt = await systemPromptSent()
    expect(prompt).toMatch(/### LEAGUE ANALYSIS: Not available/)
    expect(prompt).not.toMatch(RUN_A_TOOL)
  })

  it('it gives the model an honest reply that points at tools that exist', async () => {
    mocks.readSnapshotsForUser.mockResolvedValue([])
    const prompt = await systemPromptSent()
    expect(prompt).toContain("I don't have a saved league analysis to pull trade ideas from. You can look for trade ideas in the [[tab:finder]]")
    expect(prompt).toContain("I don't have saved package data for that player.")
    expect(prompt).toMatch(/no tool produces league analysis snapshots anymore/)
  })
})

describe('legacy chat — a saved league analysis still reaches the model', () => {
  it('positive control: an old snapshot is quoted as the source of truth, dated', async () => {
    mocks.readSnapshotsForUser.mockImplementation(async ({ snapshotType }: { snapshotType: string }) =>
      snapshotType === 'league_analyze'
        ? [{
            leagueId: 'league-1', sleeperUsername: 'someone', createdAt: new Date('2026-09-01T00:00:00Z'), season: 2026,
            payload: { leagueName: 'Dynasty Dudes', scoringType: 'PPR', tradeSuggestions: [] },
          }]
        : [],
    )
    const prompt = await systemPromptSent()
    expect(prompt).toMatch(/### LEAGUE ANALYSIS \(Source of Truth for Trades\)/)
    expect(prompt).toContain('Analyzed: 2026-09-01T00:00:00.000Z')
  })

  it('positive control: the pattern catches the copy it replaced', () => {
    expect(RUN_A_TOOL.test(`say: "I don't have league analysis data yet. Please run the Trade Finder first."`)).toBe(true)
    expect(RUN_A_TOOL.test(`say: "I don't have OTB package data for that player. Please run OTB Packages analysis first."`)).toBe(true)
    expect(RUN_A_TOOL.test('User has not run Trade Finder yet for this league (or any league).')).toBe(true)
    expect(RUN_A_TOOL.test('Snapshot not found. Run league-analyze / otb-packages first.')).toBe(true)
  })
})

describe('snapshots/latest — its 404 names no removed tool', () => {
  it('a missing snapshot is "Snapshot not found." and nothing more', async () => {
    mocks.readLatestSnapshot.mockResolvedValue(null)
    const res = await call(snapshotPOST, 'http://localhost/api/legacy/snapshots/latest', {
      league_id: 'league-1', sleeper_username: 'someone', snapshot_type: 'rankings_analyze',
    })
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data).toEqual({ ok: false, error: 'Snapshot not found.' })
    expect(data.error).not.toMatch(RUN_A_TOOL)
  })
})
