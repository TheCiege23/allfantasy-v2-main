// @vitest-environment node
/**
 * app/api/waiver-ai/grok/route.ts — access-control fix. Uses a real, filtering in-memory Prisma
 * fake (not just call-argument assertions) so `assertLeagueMember`'s actual membership logic runs
 * against it: a client-supplied sleeperUserId/platformUserId can no longer substitute for the
 * session's own identity, an unauthenticated caller is rejected before any league/roster is
 * touched, and a non-member is rejected with 403. The synthesis call's system prompt is captured
 * to prove which roster's data actually reached the model — the response JSON alone doesn't echo
 * raw roster content, so this is the only way to genuinely prove no cross-team leak.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { prismaMock, store, getServerSessionMock, chatCompletionsCreateMock } = vi.hoisted(() => {
  type LeagueRow = {
    id: string
    sport: string
    userId: string
    leagueSize: number
    scoring: string
    isDynasty: boolean
    settings: Record<string, unknown>
  }
  type RosterRow = {
    id: string
    leagueId: string
    platformUserId: string
    playerData: unknown
    faabRemaining: number | null
  }

  const store = {
    leagues: new Map<string, LeagueRow>(),
    rosters: new Map<string, RosterRow>(), // key: `${leagueId}:${platformUserId}`
  }

  const prismaMock = {
    league: {
      findUnique: vi.fn(async ({ where, select, include }: any) => {
        const league = store.leagues.get(where.id)
        if (!league) return null
        if (include?.rosters) {
          const rosters = Array.from(store.rosters.values()).filter((r) => r.leagueId === where.id)
          return { ...league, rosters }
        }
        if (select) {
          const result: Record<string, unknown> = {}
          for (const key of Object.keys(select)) result[key] = (league as any)[key]
          return result
        }
        return league
      }),
    },
    roster: {
      count: vi.fn(async ({ where }: any) => {
        return Array.from(store.rosters.values()).filter(
          (r) => r.leagueId === where.leagueId && r.platformUserId === where.platformUserId
        ).length
      }),
    },
    // The canonical membership predicate consults redraft membership and claimed teams
    // alongside rosters. Neither applies to these fixtures — the roster path is what grants
    // access here — but they must be present or the helper throws and a legitimate member
    // 403s, which reads exactly like a real authorization regression.
    redraftLeagueMember: { findUnique: vi.fn(async () => null) },
    leagueTeam: { count: vi.fn(async () => 0) },
    waiverPickup: {
      findMany: vi.fn(async () => []),
    },
    tradeProfile: {
      findUnique: vi.fn(async () => null),
    },
  }

  const getServerSessionMock = vi.fn()
  const chatCompletionsCreateMock = vi.fn(async ({ messages }: any) => {
    const isSynthesis = messages.some((m: any) => typeof m.content === 'string' && m.content.includes('waiver wire synthesizer'))
    if (isSynthesis) {
      return { choices: [{ message: { content: JSON.stringify({ suggestions: [], rosterAlerts: [], explanation: { leagueFit: 'x', rosterNeedsSummary: 'y', decisionBasis: 'fact_based' } }) } }] }
    }
    // Grok research call — no tool calls, ends the tool loop immediately.
    return { choices: [{ message: { content: 'no real-time research available in test' } }] }
  })

  return { prismaMock, store, getServerSessionMock, chatCompletionsCreateMock }
})

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(() => ({ success: true, remaining: 9 })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))
vi.mock('@/lib/serper', () => ({
  executeSerperWebSearch: vi.fn(async () => ({ results: [] })),
  executeSerperNewsSearch: vi.fn(async () => ({ news: [] })),
}))
vi.mock('@/lib/player-values/playerValuesLoader', () => ({
  getPlayerValuesContext: vi.fn(() => ''),
}))
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: chatCompletionsCreateMock } }
  },
}))

import { POST } from '@/app/api/waiver-ai/grok/route'

const ROUTE_URL = 'http://localhost/api/waiver-ai/grok'

function postRequest(body: Record<string, unknown>) {
  return new NextRequest(ROUTE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function findSystemPromptContaining(needle: string): string | undefined {
  for (const call of chatCompletionsCreateMock.mock.calls) {
    const [{ messages }] = call as [{ messages: Array<{ content: string }> }]
    const match = messages.find((m) => typeof m.content === 'string' && m.content.includes(needle))
    if (match) return match.content
  }
  return undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  store.leagues.clear()
  store.rosters.clear()
  process.env.XAI_API_KEY = 'test-xai-key'
  process.env.OPENAI_API_KEY = 'test-openai-key'
  getServerSessionMock.mockResolvedValue({ user: { id: 'session-user' } })

  store.leagues.set('league-1', {
    id: 'league-1',
    sport: 'NFL',
    userId: 'commissioner-user',
    leagueSize: 12,
    scoring: 'ppr',
    isDynasty: true,
    settings: { rosterPositions: ['QB', 'RB', 'WR'] },
  })
  store.rosters.set('league-1:session-user', {
    id: 'roster-session-user',
    leagueId: 'league-1',
    platformUserId: 'session-user',
    playerData: [{ name: 'Session User Own Player', position: 'RB' }],
    faabRemaining: 55,
  })
  store.rosters.set('league-1:victim-user', {
    id: 'roster-victim-user',
    leagueId: 'league-1',
    platformUserId: 'victim-user',
    playerData: [{ name: 'Victim Private Roster Player', position: 'WR' }],
    faabRemaining: 80,
  })
})

describe('POST /api/waiver-ai/grok — access control', () => {
  it('rejects an unauthenticated request with a leagueId before touching the league/roster store', async () => {
    getServerSessionMock.mockResolvedValue(null)

    const res = await POST(postRequest({ leagueId: 'league-1', platformUserId: 'victim-user' }))
    expect(res.status).toBe(401)
    expect(prismaMock.league.findUnique).not.toHaveBeenCalled()
  })

  it("a client-supplied platformUserId can no longer substitute for the session's own identity — the vulnerability this test guards against", async () => {
    // Attacker is authenticated as themselves, but supplies the victim's platformUserId,
    // hoping to get the victim's roster back. Pre-fix this succeeded and leaked
    // "Victim Private Roster Player" into the prompt; post-fix it must not.
    const res = await POST(
      postRequest({ leagueId: 'league-1', platformUserId: 'victim-user', sleeperUserId: 'victim-user' })
    )

    // The session user (session-user) has their own roster in this league, so the request
    // succeeds — but it must use the session's own roster, never the supplied platformUserId.
    expect(res.status).toBe(200)
    const grokPrompt = findSystemPromptContaining('USER ROSTER')
    expect(grokPrompt).toContain('Session User Own Player')
    expect(grokPrompt).not.toContain('Victim Private Roster Player')
  })

  it('rejects a request for a league the session user is not a member of (403), never reaching the roster data', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'outsider-user' } })

    const res = await POST(postRequest({ leagueId: 'league-1', platformUserId: 'victim-user' }))
    expect(res.status).toBe(403)
    expect(chatCompletionsCreateMock).not.toHaveBeenCalled()
  })

  it("a legitimate member with no supplied platformUserId still gets their own roster correctly", async () => {
    const res = await POST(postRequest({ leagueId: 'league-1' }))
    expect(res.status).toBe(200)
    const grokPrompt = findSystemPromptContaining('USER ROSTER')
    expect(grokPrompt).toContain('Session User Own Player')
  })

  it('the commissioner (league.userId match) is a member and can request their own roster', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'commissioner-user' } })
    store.rosters.set('league-1:commissioner-user', {
      id: 'roster-commissioner',
      leagueId: 'league-1',
      platformUserId: 'commissioner-user',
      playerData: [{ name: 'Commissioner Own Player', position: 'QB' }],
      faabRemaining: 100,
    })

    const res = await POST(postRequest({ leagueId: 'league-1' }))
    expect(res.status).toBe(200)
    const grokPrompt = findSystemPromptContaining('USER ROSTER')
    expect(grokPrompt).toContain('Commissioner Own Player')
  })

  it('still supports the manual-roster-paste path with no leagueId (no server-side data to leak)', async () => {
    const res = await POST(
      postRequest({ userRoster: JSON.stringify([{ name: 'Pasted Player', position: 'TE' }]) })
    )
    expect(res.status).toBe(200)
    const grokPrompt = findSystemPromptContaining('USER ROSTER')
    expect(grokPrompt).toContain('Pasted Player')
  })

  it('returns 400 when neither leagueId nor a manual roster is provided', async () => {
    const res = await POST(postRequest({}))
    expect(res.status).toBe(400)
  })

  it('returns 403 for an unknown league — assertLeagueMember rejects it the same way as a real league you are not in, rather than leaking which case it is', async () => {
    const res = await POST(postRequest({ leagueId: 'unknown-league' }))
    expect(res.status).toBe(403)
    expect(chatCompletionsCreateMock).not.toHaveBeenCalled()
  })
})
