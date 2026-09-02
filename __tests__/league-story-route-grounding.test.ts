// @vitest-environment node
/**
 * /api/league-story — guards two defects that shipped together and had NO test coverage.
 *
 * 1. FABRICATION. The route read the league name, team names and a sport-wide injury list —
 *    no matchup, no score, no record — then asked the model at temperature 0.8 to "be dramatic
 *    and fun" with no anti-fabrication constraint, persisted the result as `source: 'ai'` and
 *    notified every claimed manager. Every game and score in the output was invented.
 *
 * 2. NO MEMBERSHIP GATE. Session-only, so any signed-in user could POST any leagueId and push
 *    a storyline notification into a league they had nothing to do with.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'

const getServerSessionMock = vi.fn()
const resolveLeagueAccessMock = vi.fn()
const leagueFindUniqueMock = vi.fn()
const teamWeekResultFindManyMock = vi.fn()
const storylineCreateMock = vi.fn()
const openaiChatTextMock = vi.fn()
const ingestMock = vi.fn()
const getInjuriesMock = vi.fn()
const buildRosterLabelMapMock = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({
  resolveLeagueAccess: (...a: unknown[]) => resolveLeagueAccessMock(...a),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: (...a: unknown[]) => leagueFindUniqueMock(...a) },
    teamWeekResult: { findMany: (...a: unknown[]) => teamWeekResultFindManyMock(...a) },
    leagueStoryline: { create: (...a: unknown[]) => storylineCreateMock(...a) },
  },
}))
vi.mock('@/lib/openai-client', () => ({
  openaiChatText: (...a: unknown[]) => openaiChatTextMock(...a),
}))
vi.mock('@/lib/notification-engine', () => ({
  ingest: (...a: unknown[]) => ingestMock(...a),
  storylineGenerated: (x: unknown) => x,
}))
vi.mock('@/lib/injuries', () => ({ getInjuries: (...a: unknown[]) => getInjuriesMock(...a) }))
vi.mock('@/lib/scoring-engine/resolveTeamLabels', () => ({
  buildRosterLabelMap: (...a: unknown[]) => buildRosterLabelMapMock(...a),
}))

async function post(body: unknown) {
  const { POST } = await import('@/app/api/league-story/route')
  const req = createMockNextRequest('http://localhost/api/league-story', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return POST(req as never)
}

const RESULTS = [
  { rosterId: 'r1', totalPoints: 141.2, opponentRosterId: 'r2', winLoss: 'W' },
  { rosterId: 'r2', totalPoints: 98.7, opponentRosterId: 'r1', winLoss: 'L' },
]

beforeEach(() => {
  vi.clearAllMocks()
  getServerSessionMock.mockResolvedValue({ user: { id: 'u1' } })
  resolveLeagueAccessMock.mockResolvedValue({ isMember: true })
  leagueFindUniqueMock.mockResolvedValue({ name: 'Test League', sport: 'NFL', leagueSize: 12, season: 2026 })
  teamWeekResultFindManyMock.mockResolvedValue(RESULTS)
  buildRosterLabelMapMock.mockResolvedValue(new Map([['r1', 'Gridiron Giants'], ['r2', 'Sofa Kings']]))
  getInjuriesMock.mockResolvedValue([])
  openaiChatTextMock.mockResolvedValue({ ok: true, text: 'A grounded recap.' })
  storylineCreateMock.mockResolvedValue({ id: 's1', title: 'Week 3 Storyline', body: 'A grounded recap.' })
})

describe('auth and membership', () => {
  it('401s an anonymous caller', async () => {
    getServerSessionMock.mockResolvedValue(null)
    expect((await post({ leagueId: 'L1', week: 3 })).status).toBe(401)
  })

  it('403s a signed-in NON-MEMBER — the notification-injection hole', async () => {
    /*
     * The original gate was session-only, so any signed-in user could push a storyline
     * notification into a league they do not belong to. Nothing may be written or sent.
     */
    resolveLeagueAccessMock.mockResolvedValue({ isMember: false })
    const res = await post({ leagueId: 'someone-elses-league', week: 3 })

    expect(res.status).toBe(403)
    expect(storylineCreateMock).not.toHaveBeenCalled()
    expect(ingestMock).not.toHaveBeenCalled()
    expect(openaiChatTextMock).not.toHaveBeenCalled()
  })

  it('403s when access resolves to null rather than treating it as permitted', async () => {
    resolveLeagueAccessMock.mockResolvedValue(null)
    expect((await post({ leagueId: 'L1', week: 3 })).status).toBe(403)
  })
})

describe('refuses rather than inventing', () => {
  it('409s when the week has no scored results, and writes nothing', async () => {
    // The core fix: no results means no story, not a story about imagined results.
    teamWeekResultFindManyMock.mockResolvedValue([])
    const res = await post({ leagueId: 'L1', week: 3 })

    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('no_results')
    expect(openaiChatTextMock).not.toHaveBeenCalled()
    expect(storylineCreateMock).not.toHaveBeenCalled()
    expect(ingestMock).not.toHaveBeenCalled()
  })

  it('400s when no week is given instead of narrating "Week ?"', async () => {
    const res = await post({ leagueId: 'L1' })
    expect(res.status).toBe(400)
    expect(openaiChatTextMock).not.toHaveBeenCalled()
  })
})

describe('grounding', () => {
  it('puts the real scores and team names in the prompt', async () => {
    await post({ leagueId: 'L1', week: 3 })

    const userMsg = openaiChatTextMock.mock.calls[0][0].messages.find((m: { role: string }) => m.role === 'user').content
    expect(userMsg).toContain('Gridiron Giants')
    expect(userMsg).toContain('141.2')
    expect(userMsg).toContain('Sofa Kings')
    expect(userMsg).toContain('98.7')
  })

  it('instructs the model not to invent, and lowers the sampling temperature', async () => {
    await post({ leagueId: 'L1', week: 3 })
    const call = openaiChatTextMock.mock.calls[0][0]
    const system = call.messages.find((m: { role: string }) => m.role === 'system').content

    expect(system).toMatch(/DO NOT INVENT/i)
    expect(system).toMatch(/only the results supplied/i)
    // 0.8 was the old value; high sampling is what invents a plausible extra detail.
    expect(call.temperature).toBeLessThan(0.8)
  })

  it('marks league-wide injuries as possibly not on any roster here', async () => {
    /*
     * getInjuries is sport-wide, not league-scoped. Unlabelled, it invites the model to say a
     * specific team lost a specific player — a fabrication with real-looking specifics.
     */
    getInjuriesMock.mockResolvedValue([{ playerName: 'Some Star', status: 'Out' }])
    await post({ leagueId: 'L1', week: 3 })

    const userMsg = openaiChatTextMock.mock.calls[0][0].messages.find((m: { role: string }) => m.role === 'user').content
    expect(userMsg).toMatch(/may NOT be on any roster/i)
    expect(userMsg).toMatch(/do not attribute them to a team/i)
  })

  it('notifies only after a grounded story is actually written', async () => {
    const res = await post({ leagueId: 'L1', week: 3 })
    expect(res.status).toBe(200)
    expect(storylineCreateMock).toHaveBeenCalledTimes(1)
    expect(ingestMock).toHaveBeenCalledTimes(1)
    expect((await res.json()).groundedOn).toEqual({ season: 2026, week: 3, teamsScored: 2 })
  })
})
