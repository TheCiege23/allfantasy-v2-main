// @vitest-environment node
/**
 * Milestone 32: a manager characterisation label is shown to NOBODY — not even the manager it
 * describes. The legacy career report (`POST /api/legacy/ai/run`) had a whole prompt section,
 * "AI AS PSYCHOLOGIST - MANAGER ARCHETYPE PROFILING", that told the model to type the manager as
 * "Builder" | "Trader" | "Sniper" | "Hoarder" | "Balanced" and to roast them. The archetype was
 * stored in `LegacyAIReport.insights`, returned on both the fresh and the CACHED path, and
 * rendered as a badge on /af-legacy.
 *
 * The report keeps its FACTS — rating, window status, strengths, titles — and those are the
 * positive control, so a response that lost everything cannot pass.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
  reportCreate: vi.fn(),
  reportDeleteMany: vi.fn(),
}))

vi.mock('@/lib/telemetry/usage', () => ({
  withApiUsage: () => (handler: unknown) => handler,
}))
vi.mock('@/lib/ai/openai-route-client', () => ({
  getOpenAIRouteClient: () => ({ chat: { completions: { create: mocks.create } } }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    legacyUser: { findUnique: mocks.findUnique },
    legacyAIReport: { create: mocks.reportCreate, deleteMany: mocks.reportDeleteMany },
  },
}))
vi.mock('@/lib/rate-limit', () => ({
  getClientIp: () => '127.0.0.1',
  rateLimit: () => ({ success: true }),
}))
vi.mock('@/lib/analytics-server', () => ({ trackLegacyToolUsage: vi.fn() }))
vi.mock('@/lib/legacy/requireLegacySleeperIdentity', () => ({
  requireLegacySleeperIdentity: vi.fn(async () => ({
    ok: true,
    identity: { sleeperUsername: 'viewer' },
  })),
}))
vi.mock('@/lib/legacy-ai-context', () => ({
  assembleLegacyAIContext: vi.fn(async () => {
    throw new Error('no enrichment in this test')
  }),
  formatEnrichedContextForPrompt: vi.fn(() => ''),
}))

import { POST } from '@/server/api-route-modules/legacy/ai/run/route'

const LABELS = /\b(Builder|Trader|Sniper|Hoarder|Balanced)\b/
const ROOT = path.resolve(__dirname, '..', '..')

function legacyUser(aiReports: unknown[] = []) {
  return {
    id: 'lu1',
    displayName: 'Viewer',
    sleeperUsername: 'viewer',
    leagues: [
      {
        id: 'l1',
        name: 'Dynasty A',
        season: 2025,
        leagueType: 'dynasty',
        specialtyFormat: 'standard',
        rosters: [
          { wins: 10, losses: 4, pointsFor: 1700, isChampion: true, playoffSeed: 1, finalStanding: 1 },
        ],
      },
    ],
    aiReports,
  }
}

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/legacy/ai/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}

beforeEach(() => {
  mocks.create.mockReset()
  mocks.findUnique.mockReset()
  mocks.reportCreate.mockReset()
  mocks.reportDeleteMany.mockReset()
  mocks.reportCreate.mockResolvedValue({})
  // The model still TRIES to hand back the old fields — the route must not pass them on.
  mocks.create.mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            rating: 81,
            title: '1x Champion',
            archetype: 'Sniper',
            window_status: 'READY_TO_COMPETE',
            window_status_label: 'Ready to Compete',
            insights: { strengths: ['Won the 2025 title'], weaknesses: [], hall_of_fame_moments: [], improvement_tips: [] },
            manager_profile: { playful_roast: 'You hold players like they owe you money.' },
          }),
        },
      },
    ],
  })
})

describe('legacy AI report — no manager archetype', () => {
  it('the system prompt no longer asks the model to type or roast the manager', async () => {
    mocks.findUnique.mockResolvedValue(legacyUser())
    await (POST as (r: unknown) => Promise<Response>)(request({ sleeper_username: 'viewer' }))
    expect(mocks.create).toHaveBeenCalledTimes(1)
    const system = String(mocks.create.mock.calls[0][0].messages[0].content)

    // Positive control: the prompt is the real legacy prompt.
    expect(system).toMatch(/OFFSEASON WINDOW STATUS/)
    expect(system).toMatch(/"window_status"/)

    expect(system).not.toMatch(/ARCHETYPE/i)
    expect(system).not.toMatch(/PSYCHOLOGIST/)
    expect(system).not.toMatch(LABELS)
    expect(system).not.toMatch(/playful_roast|manager_profile|behavior_percentile/)
  })

  it('a fresh run neither returns nor stores an archetype, and keeps the facts', async () => {
    mocks.findUnique.mockResolvedValue(legacyUser())
    const res = await (POST as (r: unknown) => Promise<Response>)(request({ sleeper_username: 'viewer' }))
    const body = (await res.json()) as { report: Record<string, unknown> }

    expect(body.report.rating).toBe(81)
    expect(body.report.window_status).toBe('READY_TO_COMPETE')
    expect((body.report.insights as { strengths: string[] }).strengths).toEqual(['Won the 2025 title'])

    expect(Object.keys(body.report)).not.toContain('archetype')
    expect(JSON.stringify(body)).not.toMatch(/Sniper|owe you money/)

    const stored = mocks.reportCreate.mock.calls[0][0].data.insights as Record<string, unknown>
    expect(stored.window_status).toBe('READY_TO_COMPETE')
    expect(Object.keys(stored)).not.toContain('archetype')
  })

  it('a CACHED report written before this change does not replay its stored archetype', async () => {
    mocks.findUnique.mockResolvedValue(
      legacyUser([
        {
          title: '1x Champion',
          rating: 77,
          summary: 'A title in 2025.',
          shareText: 'x',
          createdAt: new Date('2026-08-01T00:00:00Z'),
          insights: { archetype: 'Hoarder', window_status: 'REBUILDING', strengths: ['Deep bench'] },
        },
      ]),
    )
    const res = await (POST as (r: unknown) => Promise<Response>)(request({ sleeper_username: 'viewer' }))
    const body = (await res.json()) as { cached: boolean; report: Record<string, unknown> }

    expect(body.cached).toBe(true)
    expect(body.report.rating).toBe(77)
    expect(body.report.window_status).toBe('REBUILDING')

    expect(Object.keys(body.report)).not.toContain('archetype')
    expect(JSON.stringify(body)).not.toMatch(/Hoarder/)
    expect(mocks.create).not.toHaveBeenCalled()
  })
})

describe('legacy AI report — the title is a record, not a label', () => {
  it('the prompt no longer seeds persona titles', async () => {
    mocks.findUnique.mockResolvedValue(legacyUser())
    await (POST as (r: unknown) => Promise<Response>)(request({ sleeper_username: 'viewer' }))
    const system = String(mocks.create.mock.calls[0][0].messages[0].content)
    // Positive control: the title field is still requested.
    expect(system).toMatch(/"title": string/)
    expect(system).not.toMatch(/Dynasty Dominator|Waiver Wire Wizard|Perpetual Rebuilder/)
  })

  it('when the model omits a title, the fallback is built from the record', async () => {
    mocks.create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ rating: 70, window_status: 'REBUILDING' }) } }],
    })
    mocks.findUnique.mockResolvedValue(legacyUser())
    const res = await (POST as (r: unknown) => Promise<Response>)(request({ sleeper_username: 'viewer' }))
    const body = (await res.json()) as { report: { title: string } }
    // 10-4 with one title in the single standard league.
    expect(body.report.title).toBe('1x Champion · 71.4% Win Rate')
    expect(body.report.title).not.toMatch(/Contender|Competitive Manager|Rebuild Candidate/)
  })
})

describe('/af-legacy renders no archetype', () => {
  const page = readFileSync(path.join(ROOT, 'app/af-legacy/page.tsx'), 'utf8')

  it('no render reads aiReport.archetype, and the explainer no longer sells one', () => {
    // Positive control: the report card this guards is still on the page.
    expect(page).toMatch(/aiReport\.rating/)
    expect(page).not.toMatch(/aiReport\??\.archetype/)
    expect(page).not.toMatch(/Archetype Classification/)
    expect(page).not.toMatch(/manager archetype/i)
  })
})
