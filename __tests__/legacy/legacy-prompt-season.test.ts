// @vitest-environment node
/**
 * The legacy AI prompts name seasons from the clock, not from literals that go stale.
 *
 * 🛑 Measured 2026-10-11: the AI Coach told the model "The 2024 NFL Draft class (… Omarion Hampton …) have
 * ALREADY completed their rookie seasons" — Hampton was drafted in 2025 (Sleeper `yearsExp` 1 in 2026,
 * against 2 for Nabers and Bowers); the league transfer asked for storylines "for an upcoming 2025 fantasy
 * football season"; the legacy report offered "Best 2025 Outlook". Each route is driven with the clock set
 * to March 2027 — a date none of the old literals could describe.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  openaiCreate: vi.fn(),
  legacyUser: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (handler: unknown) => handler }))
vi.mock('@/lib/ai/openai-route-client', () => ({
  getOpenAIRouteClient: () => ({ chat: { completions: { create: m.openaiCreate } } }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    legacyUser: { findUnique: m.legacyUser },
    legacyAIReport: { create: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({})) },
  },
}))
vi.mock('@/lib/rate-limit', () => ({ getClientIp: () => '127.0.0.1', rateLimit: () => ({ success: true }) }))
vi.mock('@/lib/analytics-server', () => ({ trackLegacyToolUsage: vi.fn() }))
vi.mock('@/lib/legacy/requireLegacySleeperIdentity', () => ({
  requireLegacySleeperIdentity: vi.fn(async () => ({ ok: true, identity: { sleeperUsername: 'viewer' } })),
}))
vi.mock('@/lib/legacy-ai-context', () => ({
  assembleLegacyAIContext: vi.fn(async () => {
    throw new Error('no enrichment in this test')
  }),
  formatEnrichedContextForPrompt: vi.fn(() => ''),
}))
vi.mock('@/lib/ai/aiSpendGuard', () => ({ isAiSpendEnabled: () => true }))
vi.mock('@/lib/decision-log', () => ({
  getDecisionLogsForCoach: vi.fn(async () => []),
  getDecisionSummary: vi.fn(async () => ({ total: 0 })),
}))
vi.mock('@/lib/manager-dna', () => ({ getCachedDNA: vi.fn(async () => null), formatDNAForPrompt: vi.fn(() => '') }))
vi.mock('@/lib/sleeper-client', () => ({
  getLeagueInfo: vi.fn(async () => ({
    league_id: 'L1', name: 'Dynasty A', sport: 'nfl', season: '2027', season_type: 'regular',
    total_rosters: 2, status: 'pre_draft', settings: { type: 2 }, scoring_settings: { rec: 1 }, roster_positions: [],
    previous_league_id: null,
  })),
  getLeagueUsers: vi.fn(async () => [{ user_id: 'u1', username: 'a', display_name: 'A' }]),
  getLeagueRosters: vi.fn(async () => [{ roster_id: 1, owner_id: 'u1', players: [], starters: [], settings: { wins: 9, losses: 5 } }]),
  getLeagueDrafts: vi.fn(async () => []),
  getDraftPicks: vi.fn(async () => []),
  getLeagueTransactions: vi.fn(async () => []),
  getLeagueMatchups: vi.fn(async () => []),
}))
vi.mock('@/lib/canonical/getCanonicalPlayer', () => ({ getCanonicalPlayersBySleeperIds: vi.fn(async () => new Map()) }))

import { POST as runReport } from '@/server/api-route-modules/legacy/ai/run/route'
import { POST as coach } from '@/server/api-route-modules/legacy/ai-coach/route'
import { POST as transfer } from '@/server/api-route-modules/legacy/transfer/route'
import { latestNflDraftYear, legacyPromptSeason } from '@/lib/legacy/promptSeason'

const MARCH_2027 = new Date('2027-03-15T12:00:00Z')
// The literals these prompts carried were 2024/2025/2026. In March 2027, 2026 is legitimately "last season"
// and "the latest draft", so it is asserted where it belongs rather than banned; 2023–2025 never are.
const STALE = /\b202[3-5]\b/

function json(url: string, body: unknown) {
  return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(MARCH_2027)
  process.env.OPENAI_API_KEY = 'test-key'
})
afterAll(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  m.openaiCreate.mockReset()
  m.fetch.mockReset()
  vi.stubGlobal('fetch', m.fetch)
})

describe('lib/legacy/promptSeason', () => {
  it('is the current fantasy season, and January–February still belong to the one ending', () => {
    expect(legacyPromptSeason(new Date('2026-10-11T00:00:00Z'))).toBe(2026)
    expect(legacyPromptSeason(new Date('2027-01-20T00:00:00Z'))).toBe(2026)
    expect(legacyPromptSeason(MARCH_2027)).toBe(2027)
  })
  it('names the latest NFL Draft that has happened: last year’s until May', () => {
    expect(latestNflDraftYear(MARCH_2027)).toBe(2026)
    expect(latestNflDraftYear(new Date('2027-05-02T00:00:00Z'))).toBe(2027)
  })
})

describe('/af-legacy colours the outlook badge for any season', () => {
  it('matches "Best <year> Outlook" by pattern, not the literal 2025 label', () => {
    const page = readFileSync(resolve(process.cwd(), 'app/af-legacy/page.tsx'), 'utf8')
    expect(page).not.toMatch(/'Best 20\d\d Outlook'/)
    expect(page).toContain('/^Best \\d{4} Outlook$/.test(String((aiReport as any).offseason_label))')
  })
})

describe('the prompts carry the current season', () => {
  it('legacy report (/api/legacy/ai/run): "Best 2027 Outlook", the 2027 window, no stale year', async () => {
    m.legacyUser.mockResolvedValue({
      id: 'lu1', displayName: 'Viewer', sleeperUsername: 'viewer', aiReports: [],
      leagues: [{ id: 'l1', name: 'A', season: 2026, leagueType: 'dynasty', specialtyFormat: 'standard', rosters: [{ wins: 9, losses: 5, pointsFor: 1500 }] }],
    })
    m.openaiCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ rating: 70, window_status: 'REBUILDING' }) } }] })
    await (runReport as (r: unknown) => Promise<Response>)(json('http://localhost/api/legacy/ai/run', { sleeper_username: 'viewer' }))
    const system = String(m.openaiCreate.mock.calls[0]![0].messages[0].content)
    expect(system).toMatch(/"offseason_label": "Best 2027 Outlook"/)
    expect(system).toMatch(/Championship window OPEN for 2027/)
    expect(system).toMatch(/Rebuilding \(2028\+\)/)
    // The shared date block it embeds (`getUniversalAIContext`) is built per call too.
    expect(system).toMatch(/Current fantasy season: 2027/)
    expect(system).toMatch(/most recent NFL Draft was in 2026/)
    expect(system).not.toMatch(STALE)
  })

  it('AI Coach (/api/legacy/ai-coach): names the 2026 draft as the latest, lists no draft class, no stale year', async () => {
    m.fetch.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 }))
    await (coach as (r: unknown) => Promise<Response>)(json('http://localhost/api/legacy/ai-coach', { sleeper_username: 'viewer', stats: {} }))
    expect(m.fetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String((m.fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    const system = String(body.messages[0].content)
    const user = String(body.messages[1].content)
    expect(system).toMatch(/current fantasy season is 2027/)
    expect(system).toMatch(/most recent NFL Draft was in 2026/)
    expect(system).not.toMatch(/Omarion Hampton|2024 NFL Draft class/)
    expect(user).toMatch(/Window OPEN for 2027/)
    expect(`${system}\n${user}`).not.toMatch(STALE)
  })

  it('league transfer (/api/legacy/transfer): storylines for the 2027 season, fallbacks too', async () => {
    m.openaiCreate.mockRejectedValue(new Error('model down'))
    const res = await (transfer as (r: unknown) => Promise<Response>)(json('http://localhost/api/legacy/transfer', { leagueId: 'L1' }))
    const prompt = String(m.openaiCreate.mock.calls[0]![0].messages[0].content)
    expect(prompt).toMatch(/storylines for the 2027 fantasy football season/)
    expect(prompt).not.toMatch(/2025/)
    const out = JSON.stringify(await res.json())
    expect(out).toMatch(/enters 2027 with unfinished business/)
    expect(out).not.toMatch(/\b2025\b/)
  })
})
