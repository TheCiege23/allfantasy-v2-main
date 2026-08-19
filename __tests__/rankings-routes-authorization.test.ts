// @vitest-environment node
/**
 * app/api/rankings/** — access control, abuse limits, and LLM spend metering.
 *
 * Before this pass: `league-v2` GET returned every team's displayName/username/ownerId/record for
 * any guessable league id with no session at all; the three LLM POSTs were anonymous-callable; and
 * `app/api/rankings` POST authenticated but never authorized, so any signed-in user could read any
 * league by supplying its id in the body.
 *
 * What runs for real here (not mocked), so the tests exercise actual logic:
 *   - `resolveLegacyLeagueAccess` and `assertLeagueMember`, against a filtering in-memory Prisma fake.
 *   - `consumeRateLimit` — real in-memory bucketing, so the 429 cases prove genuine throttling.
 *
 * Two id spaces are covered deliberately, because they are NOT interchangeable:
 *   - LEGACY/Sleeper (`LegacyLeague.sleeperLeagueId`, numeric) → rankings/league-v2 + manager-psychology.
 *   - MODERN/internal (`League.id`, uuid) → app/api/rankings.
 * Gating a legacy-space route with `assertLeagueMember` would 403 every user; the member-passes
 * cases are the regression guard for exactly that.
 *
 * getServerSession is modelled, not stubbed to a constant: it authenticates from NextAuth's OWN
 * session cookie only. That is what makes the guest-token cases meaningful — `af_guest_session` is
 * signed with a different key (`lib/guest-mode/guestSessionToken.ts`) and `lib/auth.ts` reads it
 * only inside the signIn EVENT, to migrate a trial after a real login. It can never establish a session.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const MEMBER_APP_USER = 'app-user-member'
const OUTSIDER_APP_USER = 'app-user-outsider'
const MEMBER_LEGACY_USER = 'legacy-user-member'
const OUTSIDER_LEGACY_USER = 'legacy-user-outsider'
const SLEEPER_LEAGUE_ID = '987654321098765432'
const MODERN_LEAGUE_ID = 'a0000000-0000-4000-8000-000000000001'

const {
  prismaMock,
  store,
  cookieJar,
  getServerSessionMock,
  computeLeagueRankingsV2Mock,
  openaiChatTextMock,
  openaiChatJsonMock,
  gpt4oCreateMock,
  logUsageEventMock,
} = vi.hoisted(() => {
  const store = {
    appUsers: new Map<string, { id: string; legacyUserId: string | null }>(),
    legacyLeagues: [] as Array<{ id: string; userId: string; sleeperLeagueId: string }>,
    leagues: new Map<string, { id: string; sport: string; userId: string }>(),
    rosters: [] as Array<{ leagueId: string; platformUserId: string }>,
  }

  const cookieJar: Record<string, string> = {}

  const pick = (row: any, select: any) => {
    if (!select) return row
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(select)) out[key] = row[key]
    return out
  }

  const prismaMock = {
    appUser: {
      findUnique: vi.fn(async ({ where, select }: any) => {
        const user = store.appUsers.get(where.id)
        return user ? pick(user, select) : null
      }),
    },
    legacyLeague: {
      findFirst: vi.fn(async ({ where, select }: any) => {
        const row = store.legacyLeagues.find(
          (l) => l.userId === where.userId && l.sleeperLeagueId === where.sleeperLeagueId
        )
        return row ? pick(row, select) : null
      }),
    },
    league: {
      findUnique: vi.fn(async ({ where, select }: any) => {
        const row = store.leagues.get(where.id)
        return row ? pick(row, select) : null
      }),
    },
    roster: {
      count: vi.fn(async ({ where }: any) =>
        store.rosters.filter(
          (r) => r.leagueId === where.leagueId && r.platformUserId === where.platformUserId
        ).length
      ),
    },
    leagueTradeHistory: { findFirst: vi.fn(async () => null) },
    // The canonical membership predicate consults redraft membership and claimed teams
    // before/alongside rosters. Neither applies to these fixtures — the roster path is what
    // grants access here — but they must be present or the helper throws and a legitimate
    // member 403s, which reads exactly like a real authorization regression.
    redraftLeagueMember: { findUnique: vi.fn(async () => null) },
    leagueTeam: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
      count: vi.fn(async () => 0),
    },
    sportsPlayer: { findMany: vi.fn(async () => []) },
  }

  // Models NextAuth: authenticates from its own session cookie only.
  const getServerSessionMock = vi.fn(async () => {
    const token =
      cookieJar['next-auth.session-token'] ?? cookieJar['__Secure-next-auth.session-token']
    return token ? { user: { id: token } } : null
  })

  const computeLeagueRankingsV2Mock = vi.fn(async () => ({ teams: [], week: 3, isDynasty: false }))
  const openaiChatTextMock = vi.fn(async () => ({ ok: false as const, text: '', model: 'gpt-4o-mini' }))
  const openaiChatJsonMock = vi.fn(async () => ({ ok: false as const, json: null, model: 'gpt-4o-mini' }))
  const gpt4oCreateMock = vi.fn(async () => ({
    choices: [{ message: { content: null } }],
    usage: { prompt_tokens: 120, completion_tokens: 340, total_tokens: 460 },
  }))
  const logUsageEventMock = vi.fn(async () => {})

  return {
    prismaMock,
    store,
    cookieJar,
    getServerSessionMock,
    computeLeagueRankingsV2Mock,
    openaiChatTextMock,
    openaiChatJsonMock,
    gpt4oCreateMock,
    logUsageEventMock,
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/telemetry/usage', () => ({
  withApiUsage: () => (handler: any) => handler,
  logUsageEvent: logUsageEventMock,
}))
vi.mock('@/lib/rankings-engine/league-rankings-v2', () => ({
  computeLeagueRankingsV2: computeLeagueRankingsV2Mock,
}))
vi.mock('@/lib/rankings-engine/composite-weights', () => ({
  getCompositeWeightConfig: vi.fn(async () => ({ version: 'test', calibratedAt: null })),
}))
vi.mock('@/lib/openai-client', () => ({
  openaiChatText: openaiChatTextMock,
  openaiChatJson: openaiChatJsonMock,
}))
vi.mock('@/lib/ai/openai-route-client', () => ({
  getOpenAIRouteClient: () => ({ chat: { completions: { create: gpt4oCreateMock } } }),
}))
vi.mock('@/lib/feature-toggle', () => ({ isToolRankingsEnabled: vi.fn(async () => true) }))
vi.mock('@/lib/ai/ai-result-cache', () => ({ getOrCreateAiResult: vi.fn(async () => ({ teams: [] })) }))

import { GET as rankingsGet, POST as coachPost } from '@/app/api/rankings/league-v2/route'
import { POST as psychologyPost } from '@/app/api/rankings/manager-psychology/route'
import { POST as roadmapPost } from '@/app/api/rankings/dynasty-roadmap/route'
import { POST as legacyRankingsPost } from '@/app/api/rankings/route'

function setCookies(next: Record<string, string>) {
  for (const k of Object.keys(cookieJar)) delete cookieJar[k]
  Object.assign(cookieJar, next)
}
const asUser = (id: string) => setCookies({ 'next-auth.session-token': id })
const asMember = () => asUser(MEMBER_APP_USER)
const asOutsider = () => asUser(OUTSIDER_APP_USER)
const asAnonymous = () => setCookies({})
/** A no-login trial visitor: holds ONLY the guest cookie, never a NextAuth session. */
const asGuest = () => setCookies({ af_guest_session: 'signed.guest.jwt' })

function rankingsRequest(leagueId = SLEEPER_LEAGUE_ID) {
  return new NextRequest(`http://localhost/api/rankings/league-v2?leagueId=${leagueId}`)
}
function postRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const COACH_URL = 'http://localhost/api/rankings/league-v2'
const PSYCH_URL = 'http://localhost/api/rankings/manager-psychology'
const ROADMAP_URL = 'http://localhost/api/rankings/dynasty-roadmap'
const LEGACY_URL = 'http://localhost/api/rankings'

const COACH_BODY = {
  team: { rank: 1, composite: 80, record: { wins: 1, losses: 0, ties: 0 }, rankDelta: null },
  leagueContext: { week: 3, phase: 'regular_season', isDynasty: false, isSuperFlex: false },
}
const PSYCHOLOGY_BODY = {
  leagueId: SLEEPER_LEAGUE_ID,
  rosterId: 4,
  username: 'someone-else',
  teamData: { record: { wins: 1, losses: 0, ties: 0 } },
}
const ROADMAP_BODY = {
  leagueType: 'Dynasty',
  isSF: false,
  goal: 'compete',
  rosterSignals: [{ position: 'QB', playerName: 'X', age: 25, marketValue: 1, impactScore: 1, trend30Day: 0 }],
  avgAge: 25,
  totalValue: 1000,
  positionStrengths: { QB: 50 },
  weakPositions: [],
  topAssets: ['X'],
}

let uniqueUserSeq = 0
/** Fresh id per call so the real rate-limit buckets never bleed between tests. */
function freshUser(): string {
  const id = `app-user-fresh-${uniqueUserSeq++}`
  store.appUsers.set(id, { id, legacyUserId: `legacy-${id}` })
  store.legacyLeagues.push({ id: `ll-${id}`, userId: `legacy-${id}`, sleeperLeagueId: SLEEPER_LEAGUE_ID })
  store.leagues.set(MODERN_LEAGUE_ID, { id: MODERN_LEAGUE_ID, sport: 'NFL', userId: MEMBER_APP_USER })
  return id
}

beforeEach(() => {
  vi.clearAllMocks()
  store.appUsers.clear()
  store.legacyLeagues.length = 0
  store.leagues.clear()
  store.rosters.length = 0

  store.appUsers.set(MEMBER_APP_USER, { id: MEMBER_APP_USER, legacyUserId: MEMBER_LEGACY_USER })
  store.appUsers.set(OUTSIDER_APP_USER, { id: OUTSIDER_APP_USER, legacyUserId: OUTSIDER_LEGACY_USER })

  // A DIFFERENT user's row for the SAME league is listed first on purpose: a membership match
  // that filtered on sleeperLeagueId alone would return this row and wrongly admit the outsider.
  store.legacyLeagues.push(
    { id: 'legacy-league-foreign', userId: 'some-unrelated-legacy-user', sleeperLeagueId: SLEEPER_LEAGUE_ID },
    { id: 'legacy-league-member', userId: MEMBER_LEGACY_USER, sleeperLeagueId: SLEEPER_LEAGUE_ID },
  )

  // Modern space: MEMBER owns the league outright; OUTSIDER has no roster in it.
  store.leagues.set(MODERN_LEAGUE_ID, { id: MODERN_LEAGUE_ID, sport: 'NFL', userId: MEMBER_APP_USER })
})

describe('GET /api/rankings/league-v2 (legacy/Sleeper id space)', () => {
  it('rejects an anonymous caller with 401 and never computes rankings', async () => {
    asAnonymous()
    const res = await rankingsGet(rankingsRequest())
    expect(res.status).toBe(401)
    expect(computeLeagueRankingsV2Mock).not.toHaveBeenCalled()
  })

  it('rejects an authenticated non-member with 403 and never computes rankings', async () => {
    asOutsider()
    const res = await rankingsGet(rankingsRequest())
    expect(res.status).toBe(403)
    expect(computeLeagueRankingsV2Mock).not.toHaveBeenCalled()
  })

  it('rejects a user with no linked legacy identity with 403', async () => {
    store.appUsers.set(OUTSIDER_APP_USER, { id: OUTSIDER_APP_USER, legacyUserId: null })
    asOutsider()
    const res = await rankingsGet(rankingsRequest())
    expect(res.status).toBe(403)
    expect(computeLeagueRankingsV2Mock).not.toHaveBeenCalled()
  })

  // Regression guard: gating this route with `assertLeagueMember` from lib/league-access would
  // look up prisma.league by a Sleeper id, match nothing, and 403 here instead of 200.
  it('allows a member and passes the Sleeper league id through to the engine', async () => {
    asMember()
    const res = await rankingsGet(rankingsRequest())
    expect(res.status).toBe(200)
    expect(computeLeagueRankingsV2Mock).toHaveBeenCalledWith(SLEEPER_LEAGUE_ID, undefined)
  })

  it('still rejects before auth when leagueId is missing', async () => {
    asMember()
    const res = await rankingsGet(new NextRequest(COACH_URL))
    expect(res.status).toBe(400)
    expect(computeLeagueRankingsV2Mock).not.toHaveBeenCalled()
  })
})

describe('POST /api/rankings/league-v2 (coach LLM)', () => {
  it('rejects an anonymous caller with 401 and never reaches the LLM', async () => {
    asAnonymous()
    const res = await coachPost(postRequest(COACH_URL, COACH_BODY))
    expect(res.status).toBe(401)
    expect(openaiChatTextMock).not.toHaveBeenCalled()
  })

  it('rejects a guest-trial token with 401 and never reaches the LLM', async () => {
    asGuest()
    const res = await coachPost(postRequest(COACH_URL, COACH_BODY))
    expect(res.status).toBe(401)
    expect(openaiChatTextMock).not.toHaveBeenCalled()
  })

  it('allows an authenticated caller and meters the call', async () => {
    asUser(freshUser())
    const res = await coachPost(postRequest(COACH_URL, COACH_BODY))
    expect(res.status).toBe(200)
    expect(openaiChatTextMock).toHaveBeenCalled()
    expect(logUsageEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ kind: 'llm_call', maxTokens: 400 }) })
    )
  })

  it('throttles an authenticated caller after 10 calls in the window', async () => {
    asUser(freshUser())
    for (let i = 0; i < 10; i++) {
      const ok = await coachPost(postRequest(COACH_URL, COACH_BODY))
      expect(ok.status).toBe(200)
    }
    const limited = await coachPost(postRequest(COACH_URL, COACH_BODY))
    expect(limited.status).toBe(429)
    expect(openaiChatTextMock).toHaveBeenCalledTimes(10)
  })
})

describe('POST /api/rankings/manager-psychology', () => {
  it('rejects an anonymous caller with 401 and never reads trade history or calls the LLM', async () => {
    asAnonymous()
    const res = await psychologyPost(postRequest(PSYCH_URL, PSYCHOLOGY_BODY))
    expect(res.status).toBe(401)
    expect(prismaMock.leagueTradeHistory.findFirst).not.toHaveBeenCalled()
    expect(openaiChatJsonMock).not.toHaveBeenCalled()
  })

  it("rejects a non-member with 403 and never reads another league's trade history", async () => {
    asOutsider()
    const res = await psychologyPost(postRequest(PSYCH_URL, PSYCHOLOGY_BODY))
    expect(res.status).toBe(403)
    expect(prismaMock.leagueTradeHistory.findFirst).not.toHaveBeenCalled()
    expect(openaiChatJsonMock).not.toHaveBeenCalled()
  })

  it('allows a member of that Sleeper league', async () => {
    asUser(freshUser())
    const res = await psychologyPost(postRequest(PSYCH_URL, PSYCHOLOGY_BODY))
    expect(res.status).toBe(200)
    expect(prismaMock.leagueTradeHistory.findFirst).toHaveBeenCalled()
  })
})

describe('POST /api/rankings/dynasty-roadmap (gpt-4o)', () => {
  it('rejects an anonymous caller with 401 and never reaches gpt-4o', async () => {
    asAnonymous()
    const res = await roadmapPost(postRequest(ROADMAP_URL, ROADMAP_BODY))
    expect(res.status).toBe(401)
    expect(gpt4oCreateMock).not.toHaveBeenCalled()
  })

  it('rejects a guest-trial token with 401 and never reaches gpt-4o', async () => {
    asGuest()
    const res = await roadmapPost(postRequest(ROADMAP_URL, ROADMAP_BODY))
    expect(res.status).toBe(401)
    expect(gpt4oCreateMock).not.toHaveBeenCalled()
  })

  it('allows an authenticated caller and meters exact token spend', async () => {
    asUser(freshUser())
    const res = await roadmapPost(postRequest(ROADMAP_URL, ROADMAP_BODY))
    expect(res.status).toBe(200)
    expect(gpt4oCreateMock).toHaveBeenCalled()
    expect(logUsageEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          kind: 'llm_call',
          model: 'gpt-4o',
          totalTokens: 460,
          tokensExact: true,
        }),
      })
    )
  })

  it('throttles an authenticated caller after 10 calls in the window', async () => {
    asUser(freshUser())
    for (let i = 0; i < 10; i++) {
      expect((await roadmapPost(postRequest(ROADMAP_URL, ROADMAP_BODY))).status).toBe(200)
    }
    const limited = await roadmapPost(postRequest(ROADMAP_URL, ROADMAP_BODY))
    expect(limited.status).toBe(429)
    expect(gpt4oCreateMock).toHaveBeenCalledTimes(10)
  })
})

describe('POST /api/rankings (modern uuid id space — cross-league IDOR)', () => {
  const body = { leagueId: MODERN_LEAGUE_ID }

  it('rejects an anonymous caller with 401', async () => {
    asAnonymous()
    const res = await legacyRankingsPost(postRequest(LEGACY_URL, body))
    expect(res.status).toBe(401)
    expect(prismaMock.leagueTeam.findMany).not.toHaveBeenCalled()
  })

  // This gap was not read-only: on the success path the route runs leagueTeam.updateMany and
  // overwrites aiPowerScore/projectedWins/strengthNotes/riskNotes for every team in the league.
  // A non-member must therefore be blocked from WRITING to a league they don't belong to.
  it("rejects a signed-in non-member with 403 and neither reads nor overwrites the league's teams", async () => {
    asOutsider()
    const res = await legacyRankingsPost(postRequest(LEGACY_URL, body))
    expect(res.status).toBe(403)
    expect(prismaMock.leagueTeam.findMany).not.toHaveBeenCalled()
    expect(prismaMock.leagueTeam.updateMany).not.toHaveBeenCalled()
  })

  it('allows a member through the gate', async () => {
    asMember()
    const res = await legacyRankingsPost(postRequest(LEGACY_URL, body))
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
    // Reached the data path — the fake returns no teams, which is enough to prove the gate passed
    // without mocking the entire downstream model chain.
    expect(prismaMock.leagueTeam.findMany).toHaveBeenCalled()
  })

  it('allows a non-owner who has a roster in the league', async () => {
    store.rosters.push({ leagueId: MODERN_LEAGUE_ID, platformUserId: OUTSIDER_APP_USER })
    asOutsider()
    const res = await legacyRankingsPost(postRequest(LEGACY_URL, body))
    expect(res.status).not.toBe(403)
    expect(prismaMock.leagueTeam.findMany).toHaveBeenCalled()
  })
})
