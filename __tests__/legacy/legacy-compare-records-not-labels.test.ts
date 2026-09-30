// @vitest-environment node
/**
 * Milestone 32: a characterisation label of a named manager is shown to nobody.
 *
 * `/api/legacy/compare` compares ANY two Sleeper usernames — usually the viewer and someone else —
 * and asks the model for free-text `strengths`, `weaknesses` and a `trash_talk` "fun roast of the
 * loser". The prompt never asked for an archetype outright, but it left all three unconstrained
 * about a named person, invited a roast of them, and graded dynasty on "trade activity and value
 * extraction" while handing the model no trade data at all — an open door to "aggressive trader"
 * style characterisation of someone who never asked to be compared.
 *
 * The grades are deterministic server-side and are the positive control here; the prompt is what
 * this pins.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (handler: unknown) => handler }))
vi.mock('@/lib/ai/openai-route-client', () => ({
  getOpenAIRouteClient: () => ({ chat: { completions: { create: mocks.create } } }),
}))
vi.mock('@/lib/rate-limit', () => ({
  getClientIp: () => '127.0.0.1',
  consumeRateLimit: () => ({ success: true, remaining: 4 }),
}))
vi.mock('@/lib/analytics-server', () => ({ trackLegacyToolUsage: vi.fn() }))
vi.mock('@/lib/sleeper-client', () => ({
  getSleeperUser: vi.fn(async (u: string) => ({ user_id: `id-${u}`, username: u, display_name: u })),
  getUserLeagues: vi.fn(async (userId: string, _sport: string, season: string) =>
    season === '2024'
      ? [{ league_id: `L-${userId}`, name: 'Dynasty League', season, status: 'complete', settings: {}, roster_positions: [] }]
      : [],
  ),
  getLeagueRosters: vi.fn(async (leagueId: string) => [
    { roster_id: 1, owner_id: leagueId.replace('L-', ''), settings: { wins: leagueId.includes('alice') ? 10 : 5, losses: leagueId.includes('alice') ? 4 : 9, ties: 0, rank: 2 } },
  ]),
  getPlayoffBracket: vi.fn(async () => []),
  getLeagueType: vi.fn(() => 'dynasty'),
}))

import { POST } from '@/server/api-route-modules/legacy/compare/route'

function request() {
  return new Request('http://localhost/api/legacy/compare', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username_a: 'alice', username_b: 'bob' }),
  }) as never
}

beforeEach(() => {
  mocks.create.mockReset()
  mocks.create.mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            manager_a: { username: 'alice', strengths: ['10-4 in dynasty'], weaknesses: [] },
            manager_b: { username: 'bob', strengths: [], weaknesses: ['5-9 in dynasty'] },
            verdict: 'Alice by record.',
            trash_talk: '5-9 speaks for itself.',
          }),
        },
      },
    ],
  })
})

describe('/api/legacy/compare — the model is asked for records, not labels', () => {
  it('constrains strengths, weaknesses and trash talk to the record', async () => {
    const res = await (POST as (r: unknown) => Promise<Response>)(request())
    const out = (await res.json()) as { comparison: Record<string, any> }

    // Positive control: the deterministic grades still come back.
    expect(out.comparison.winner).toBe('A')
    expect(out.comparison.manager_a.overall_grade).toMatch(/^[A-F][+-]?$/)

    const system = String(mocks.create.mock.calls[0][0].messages[0].content)
    expect(system).toMatch(/RECORDS, NOT LABELS/)
    expect(system).toMatch(/Never assign either manager a persona, archetype, playstyle or behavioural/)
    expect(system).toMatch(/"strengths": string\[\] \(record-based facts/)
    expect(system).toMatch(/"weaknesses": string\[\] \(record-based facts/)

    // The roast of a named person, and the criterion that invited trade-habit claims with no data.
    expect(system).not.toMatch(/fun roast of the loser/)
    expect(system).not.toMatch(/Trade activity and value extraction/)
  })
})
