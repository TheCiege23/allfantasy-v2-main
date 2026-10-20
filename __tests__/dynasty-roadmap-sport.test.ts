/**
 * @vitest-environment node
 *
 * `/api/rankings/dynasty-roadmap` wrote every league's plan as "dynasty fantasy football" with
 * SF/1QB framing, and its caller sent no sport. The route now forwards the body's `sport` into the
 * prompt; an older client that sends none still gets the NFL prompt.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  create: vi.fn(async (_args: { messages: Array<{ content: string }> }) => ({
    choices: [{ message: { content: null } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  })),
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (handler: unknown) => handler }))
vi.mock('@/lib/telemetry/llm-usage', () => ({ recordLlmUsage: vi.fn(async () => {}) }))
vi.mock('@/lib/rate-limit', () => ({
  consumeRateLimit: () => ({ success: true }),
  buildRateLimit429: () => ({}),
  getClientIp: () => '127.0.0.1',
}))
vi.mock('@/lib/ai/openai-route-client', () => ({
  getOpenAIRouteClient: () => ({ chat: { completions: { create: h.create } } }),
}))

import { POST } from '@/app/api/rankings/dynasty-roadmap/route'

const BODY = {
  leagueType: 'Dynasty',
  isSF: true,
  goal: 'compete',
  rosterSignals: [{ position: 'PG', playerName: 'PG group', age: null, marketValue: 1, impactScore: 50, trend30Day: 0 }],
  avgAge: 26,
  totalValue: 1000,
  positionStrengths: { PG: 80 },
  weakPositions: ['C'],
  topAssets: ['PG group'],
}

async function promptFor(body: Record<string, unknown>): Promise<string> {
  const req = new NextRequest('http://localhost/api/rankings/dynasty-roadmap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const res = await (POST as unknown as (r: NextRequest) => Promise<Response>)(req)
  expect(res.status).toBe(200)
  return h.create.mock.calls.at(-1)![0].messages[0].content
}

beforeEach(() => h.create.mockClear())

describe('dynasty roadmap route forwards the league sport', () => {
  it('an NBA league gets a basketball prompt with no Superflex framing', async () => {
    const prompt = await promptFor({ ...BODY, sport: 'NBA' })
    expect(prompt).toContain('dynasty fantasy basketball strategist')
    expect(prompt).not.toMatch(/football|Superflex|1QB/)
  })

  it('no sport → the NFL prompt, unchanged', async () => {
    const prompt = await promptFor(BODY)
    expect(prompt).toContain('dynasty fantasy football strategist')
    expect(prompt).toContain('- League: Dynasty Superflex')
    expect(prompt).toContain('6. Consider the Superflex format in QB valuation.')
  })
})
