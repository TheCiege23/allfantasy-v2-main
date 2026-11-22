import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Chimmy's draft tips are grounded in the one draft engine (2026-11-14). Before this the chat never
 * sent the player pool, so "Best Pick Available" named players from Claude's memory. Pinned here:
 *   - the prompt carries the engine's top choice and the available list;
 *   - a player Claude names who is not on the board is dropped;
 *   - with Claude down, or naming nobody valid, the engine's own pick is returned.
 */

const getServerSessionMock = vi.hoisted(() => vi.fn(async () => ({ user: { id: 'u1' } })))
vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const draftAiTextMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/draft/ai-claude', () => ({ draftAiText: draftAiTextMock }))
vi.mock('@/lib/draft/ai-context', () => ({
  buildDraftAiContext: vi.fn(async () => ({ sport: 'NFL', news: [], injuries: [], promptSection: 'NEWS: none' })),
  collectAiContextPlayerNames: vi.fn(() => []),
}))

const loaderMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/draft/engineGroundingLoader', () => ({ loadDraftEngineGrounding: loaderMock }))

import { POST } from '@/app/api/draft/ai/best-pick/route'
import {
  engineBestPickFallback,
  keepAvailable,
  runEngineForGrounding,
  unavailableGrounding,
} from '@/lib/draft/engineGrounding'

const BOARD = [
  { name: 'Back One', position: 'RB', team: 'AAA', adp: 1 },
  { name: 'Receiver One', position: 'WR', team: 'BBB', adp: 2 },
  { name: 'Back Two', position: 'RB', team: 'CCC', adp: 5 },
  { name: 'Receiver Two', position: 'WR', team: 'DDD', adp: 7 },
  { name: 'Passer One', position: 'QB', team: 'EEE', adp: 20 },
]

function grounding() {
  return runEngineForGrounding({ available: BOARD, teamRoster: [], overallPick: 1, totalTeams: 12, sport: 'NFL' })
}

function request(): Request {
  return new Request('http://test/api/draft/ai/best-pick', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'mock:room1', state: {}, picks: [] }),
  })
}

beforeEach(() => {
  draftAiTextMock.mockReset()
  loaderMock.mockReset()
})

describe('engine grounding (pure)', () => {
  it('lists the engine top choice and only available players', () => {
    const g = grounding()
    expect(g.available).toBe(true)
    expect(g.topPick).not.toBeNull()
    expect(g.promptSection).toContain(`Top choice: ${g.topPick!.player}`)
    expect(g.promptSection).toContain('Available now')
    for (const p of BOARD) expect(g.promptSection).toContain(p.name)
  })

  it('keepAvailable drops names not on the board, and keeps everything when there is no board', () => {
    const rows = [{ player: 'Back One' }, { player: 'Retired Legend' }, { player: ' receiver one ' }]
    expect(keepAvailable(rows, (r) => r.player, grounding()).map((r) => r.player)).toEqual(['Back One', ' receiver one '])
    expect(keepAvailable(rows, (r) => r.player, unavailableGrounding())).toHaveLength(3)
  })

  it('the fallback is the engine ranking, and absent without a board', () => {
    const g = grounding()
    expect(engineBestPickFallback(g)?.recommendations[0]?.player).toBe(g.topPick!.player)
    expect(engineBestPickFallback(unavailableGrounding())).toBeNull()
  })
})

describe('POST /api/draft/ai/best-pick', () => {
  it('sends Claude the engine section and filters players not on the board', async () => {
    loaderMock.mockResolvedValue(grounding())
    draftAiTextMock.mockResolvedValue(
      JSON.stringify({ recommendations: [{ player: 'Retired Legend', reason: 'x' }, { player: 'Back Two', reason: 'y' }], summary: 's' }),
    )
    const res = await POST(request())
    const body = (await res.json()) as { result: { recommendations: Array<{ player: string }> } }
    expect(draftAiTextMock.mock.calls[0]![1]).toContain('DRAFT ENGINE')
    expect(draftAiTextMock.mock.calls[0]![0]).toContain('Recommend ONLY players listed under "Available now"')
    expect(body.result.recommendations.map((r) => r.player)).toEqual(['Back Two'])
  })

  it('returns the engine pick when Claude names nobody on the board', async () => {
    const g = grounding()
    loaderMock.mockResolvedValue(g)
    draftAiTextMock.mockResolvedValue(JSON.stringify({ recommendations: [{ player: 'Retired Legend', reason: 'x' }] }))
    const body = (await (await POST(request())).json()) as { source?: string; result: { recommendations: Array<{ player: string }> } }
    expect(body.source).toBe('engine')
    expect(body.result.recommendations[0]!.player).toBe(g.topPick!.player)
  })

  it('returns the engine pick when Claude is down, instead of a 502', async () => {
    loaderMock.mockResolvedValue(grounding())
    draftAiTextMock.mockRejectedValue(new Error('ANTHROPIC_API_KEY is not configured'))
    const res = await POST(request())
    expect(res.status).toBe(200)
    expect(((await res.json()) as { source?: string }).source).toBe('engine')
  })

  it('still 502s when Claude is down and there is no board to fall back on', async () => {
    loaderMock.mockResolvedValue(unavailableGrounding())
    draftAiTextMock.mockRejectedValue(new Error('down'))
    expect((await POST(request())).status).toBe(502)
  })
})
