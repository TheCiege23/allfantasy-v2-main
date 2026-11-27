import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

/*
 * Owner-only contract capture (lib/admin/contractCapture/). Every provider call is a stubbed
 * `fetch`; no network is touched. The synthetic league below is invented: every "sensitive" value
 * is a string the redactor must remove, and every player value is one it must keep.
 */

const requireAdmin = vi.fn()
const getServerSession = vi.fn()
const leagueFindFirst = vi.fn()
const leagueFindMany = vi.fn()
const loadYahooCredential = vi.fn()
const refreshYahooCredential = vi.fn()
const getDecryptedAuth = vi.fn()

vi.mock('@/lib/adminAuth', () => ({ requireAdmin: () => requireAdmin() }))
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: { league: { findFirst: (...a: unknown[]) => leagueFindFirst(...a), findMany: (...a: unknown[]) => leagueFindMany(...a) } },
}))
vi.mock('@/lib/yahoo/yahooCredentialStore', () => ({
  YahooImportConnectionError: class YahooImportConnectionError extends Error {},
  loadYahooCredential: (...a: unknown[]) => loadYahooCredential(...a),
  refreshYahooCredential: (...a: unknown[]) => refreshYahooCredential(...a),
}))
vi.mock('@/lib/league-sync-core', () => ({ getDecryptedAuth: (...a: unknown[]) => getDecryptedAuth(...a) }))

import { GET, POST } from '@/app/api/admin/contract-capture/route'
import { buildYahooContractCapturePath } from '@/lib/league-import/yahoo/YahooLeagueFetchService'
import {
  buildRedactedCaptureDocument,
  ContractCaptureRedactionError,
} from '@/lib/admin/contractCapture/redactContractCapture'

const OWNER = 'owner-user-1'
const ACCESS_TOKEN = 'yahoo-access-TOKEN-abcdef0123456789'
const REFRESH_TOKEN = 'yahoo-refresh-TOKEN-9876543210fedcba'
const SWID = '{AAAAAAAA-1111-2222-3333-444444444444}'
const ESPN_S2 = 'AEBespnS2cookieValueThatIsLong%2Bsecret0123456789'

/* ── synthetic provider bodies ──────────────────────────────────────────────────────────── */

const Y_LEAGUE = '423.l.77321'
const Y_TEAM = `${Y_LEAGUE}.t.1`
const Y_SENSITIVE = [
  'Secret Sunday League', 'Bob Burgers Team', 'Alice Avengers', 'BobbyB', 'AliceQ',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'ZYXWVUTSRQPONMLKJIHGFEDCBA', 'bob@example.com',
  'https://s.yimg.com/bob.png', 'secret-logo1', 'take it or leave it', '77321',
]

function yahooTeamsBody() {
  return {
    fantasy_content: {
      league: [
        { league_key: Y_LEAGUE, league_id: '77321', name: 'Secret Sunday League', url: 'https://football.fantasysports.yahoo.com/f1/77321' },
        {
          teams: {
            '0': {
              team: [[
                { team_key: Y_TEAM }, { team_id: '1' }, { name: 'Bob Burgers Team' }, { is_owned_by_current_login: 1 },
                { url: 'https://football.fantasysports.yahoo.com/f1/77321/1' },
                { team_logos: [{ team_logo: { size: 'large', url: 'https://s.yimg.com/secret-logo1.png' } }] },
                { managers: [{ manager: { manager_id: '1', nickname: 'BobbyB', guid: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', email: 'bob@example.com', image_url: 'https://s.yimg.com/bob.png' } }] },
              ]],
            },
            '1': {
              team: [[
                { team_key: `${Y_LEAGUE}.t.2` }, { team_id: '2' }, { name: 'Alice Avengers' },
                { managers: [{ manager: { manager_id: '2', nickname: 'AliceQ', guid: 'ZYXWVUTSRQPONMLKJIHGFEDCBA' } }] },
              ]],
            },
            count: 2,
          },
        },
      ],
    },
  }
}

function yahooRosterBody() {
  return {
    fantasy_content: {
      team: [
        [{ team_key: Y_TEAM }, { name: 'Bob Burgers Team' }],
        {
          roster: {
            week: '11',
            '0': {
              players: {
                '0': {
                  player: [
                    [{ player_key: '423.p.30123' }, { player_id: '30123' }, { name: { full: 'Patrick Mahomes', first: 'Patrick', last: 'Mahomes' } }, { editorial_team_abbr: 'KC' }],
                    { selected_position: [{ coverage_type: 'week', week: '11' }, { position: 'QB' }] },
                    { player_points: { coverage_type: 'week', week: '11', total: '22.56' } },
                  ],
                },
                count: 1,
              },
            },
          },
        },
      ],
    },
  }
}

function yahooTradesBody() {
  return {
    fantasy_content: {
      league: [
        { league_key: Y_LEAGUE, name: 'Secret Sunday League' },
        {
          transactions: {
            '0': {
              transaction: [
                { transaction_key: `${Y_LEAGUE}.pt.4`, type: 'pending_trade', status: 'proposed', trader_team_key: Y_TEAM, trader_team_name: 'Bob Burgers Team', tradee_team_key: `${Y_LEAGUE}.t.2`, tradee_team_name: 'Alice Avengers', trade_note: 'take it or leave it' },
                { players: { count: 0 } },
              ],
            },
            count: 1,
          },
        },
      ],
    },
  }
}

function yahooScoreboardBody() {
  return { fantasy_content: { league: [{ league_key: Y_LEAGUE, name: 'Secret Sunday League' }, { scoreboard: { week: '11', '0': { matchups: { count: 0 } } } }] } }
}

const E_LEAGUE = '55501234'
const E_SENSITIVE = ['espnbob42', 'Robert', 'Belcher', 'Belcher Burgers', 'Burgers', 'Ocean Avenue League', SWID, E_LEAGUE, 'mystique-logo']

function espnBody() {
  return {
    id: Number(E_LEAGUE),
    members: [{ id: SWID, displayName: 'espnbob42', firstName: 'Robert', lastName: 'Belcher' }],
    teams: [{
      id: 1, name: 'Belcher Burgers', location: 'Belcher', nickname: 'Burgers', abbrev: 'BOB', logo: 'https://example.com/mystique-logo.png',
      owners: [SWID], primaryOwner: SWID,
      roster: { entries: [{ playerId: 3139477, playerPoolEntry: { player: { fullName: 'Patrick Mahomes', firstName: 'Patrick', lastName: 'Mahomes' } } }] },
    }],
    settings: { name: 'Ocean Avenue League' },
    transactions: [{ id: '5f1c2b3a-0000-4000-8000-000000000001', type: 'TRADE_PROPOSAL', status: 'PENDING', memberId: SWID, teamId: 1 }],
  }
}

/* ── harness ───────────────────────────────────────────────────────────────────────────── */

const fetchCalls: Array<{ url: string; headers: Record<string, string> }> = []

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function stubFetch() {
  fetchCalls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input)
    fetchCalls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
    if (url.includes('/teams?')) return jsonResponse(yahooTeamsBody())
    if (url.includes('/roster;week=')) return jsonResponse(yahooRosterBody())
    if (url.includes('/scoreboard;week=')) return jsonResponse(yahooScoreboardBody())
    if (url.includes('types=pending_trade')) return jsonResponse(yahooTradesBody())
    if (url.includes('lm-api-reads.fantasy.espn.com')) {
      return url.includes('mPendingTransactions') ? jsonResponse({ message: 'nope' }, 400) : jsonResponse(espnBody())
    }
    return jsonResponse({ error: 'unexpected url in test' }, 599)
  }))
}

function post(body: unknown) {
  return new Request('http://localhost/api/admin/contract-capture', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function signInAsAdmin(id = OWNER) {
  requireAdmin.mockResolvedValue({ ok: true, user: { id, role: 'admin' } })
  getServerSession.mockResolvedValue({ user: { id } })
}

beforeEach(() => {
  for (const m of [requireAdmin, getServerSession, leagueFindFirst, leagueFindMany, loadYahooCredential, refreshYahooCredential, getDecryptedAuth]) m.mockReset()
  loadYahooCredential.mockImplementation(async (userId: string) => ({ userId, accessToken: ACCESS_TOKEN, refreshToken: REFRESH_TOKEN }))
  getDecryptedAuth.mockImplementation(async () => ({ espnSwid: SWID, espnS2: ESPN_S2 }))
  stubFetch()
})

/* ── 1. the admin gate ─────────────────────────────────────────────────────────────────── */

describe('admin gate', () => {
  it('refuses a signed-in non-admin with 403 and calls no provider', async () => {
    requireAdmin.mockResolvedValue({ ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) })
    getServerSession.mockResolvedValue({ user: { id: 'someone' } })
    const res = await POST(post({ leagueId: 'lg1', week: 11 }))
    expect(res.status).toBe(403)
    expect((await GET()).status).toBe(403)
    expect(leagueFindFirst).not.toHaveBeenCalled()
    expect(leagueFindMany).not.toHaveBeenCalled()
    expect(fetchCalls).toHaveLength(0)
  })

  it('refuses when signed out (401)', async () => {
    requireAdmin.mockResolvedValue({ ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) })
    const res = await POST(post({ leagueId: 'lg1', week: 11 }))
    expect(res.status).toBe(401)
    expect(fetchCalls).toHaveLength(0)
  })

  it('refuses an admin session with no app session — there is no "own" credential to read', async () => {
    requireAdmin.mockResolvedValue({ ok: true, user: { id: OWNER, role: 'admin' } })
    getServerSession.mockResolvedValue(null)
    expect((await POST(post({ leagueId: 'lg1', week: 11 }))).status).toBe(401)
    expect(loadYahooCredential).not.toHaveBeenCalled()
  })

  it('refuses when the admin session and the app session are different accounts', async () => {
    requireAdmin.mockResolvedValue({ ok: true, user: { id: OWNER, role: 'admin' } })
    getServerSession.mockResolvedValue({ user: { id: 'other-user' } })
    expect((await POST(post({ leagueId: 'lg1', week: 11 }))).status).toBe(403)
    expect(loadYahooCredential).not.toHaveBeenCalled()
  })
})

/* ── 2. only the requester's own connection and own leagues ────────────────────────────── */

describe('own connection only', () => {
  it('reads the session user\'s credential, never an id from the body, and scopes the league to that user', async () => {
    signInAsAdmin()
    leagueFindFirst.mockResolvedValue({ id: 'lg1', platform: 'yahoo', platformLeagueId: Y_LEAGUE, season: 2026 })
    const res = await POST(post({ leagueId: 'lg1', week: 11, userId: 'victim-user', ownerId: 'victim-user' }))
    expect(res.status).toBe(200)
    expect(loadYahooCredential).toHaveBeenCalledTimes(1)
    expect(loadYahooCredential).toHaveBeenCalledWith(OWNER)
    const where = leagueFindFirst.mock.calls[0]![0].where
    expect(where.id).toBe('lg1')
    expect(where.OR).toEqual([{ userId: OWNER }, { teams: { some: { claimedByUserId: OWNER } } }])
    expect(JSON.stringify(leagueFindFirst.mock.calls)).not.toContain('victim-user')
  })

  it('404s a league that is not the requester\'s, without touching a credential', async () => {
    signInAsAdmin()
    leagueFindFirst.mockResolvedValue(null)
    const res = await POST(post({ leagueId: 'someone-elses', week: 11 }))
    expect(res.status).toBe(404)
    expect(loadYahooCredential).not.toHaveBeenCalled()
    expect(getDecryptedAuth).not.toHaveBeenCalled()
    expect(fetchCalls).toHaveLength(0)
  })

  it('ESPN reads the session user\'s cookies', async () => {
    signInAsAdmin()
    leagueFindFirst.mockResolvedValue({ id: 'lg2', platform: 'espn', platformLeagueId: E_LEAGUE, season: 2026 })
    const res = await POST(post({ leagueId: 'lg2', userId: 'victim-user' }))
    expect(res.status).toBe(200)
    expect(getDecryptedAuth).toHaveBeenCalledWith(OWNER, 'espn')
  })
})

/* ── 3. redaction ──────────────────────────────────────────────────────────────────────── */

describe('redaction', () => {
  it('Yahoo: removes every sensitive value, keeps players, and reports each status', async () => {
    signInAsAdmin()
    leagueFindFirst.mockResolvedValue({ id: 'lg1', platform: 'yahoo', platformLeagueId: Y_LEAGUE, season: 2026 })
    const res = await POST(post({ leagueId: 'lg1', week: 11 }))
    const text = await res.text()
    for (const value of Y_SENSITIVE) expect(text, value).not.toContain(value)
    expect(text).toContain('Patrick Mahomes')
    expect(text).toContain('423.p.30123')
    expect(text).toContain('22.56')
    const doc = JSON.parse(text)
    expect(doc.provider).toBe('yahoo')
    expect(doc.ownerTeam).toBe('423.l.999001.t.1')
    expect(doc.requests.map((r: any) => [r.resource, r.httpStatus])).toEqual([
      ['league_teams', 200], ['team_roster_week_stats', 200], ['league_scoreboard_week', 200], ['pending_trades_for_team', 200],
    ])
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="af-contract-capture-yahoo-nfl-\d{4}-\d{2}-\d{2}\.json"$/)
  })

  it('ESPN: removes members, SWIDs, team names and the league id; records a non-2xx candidate status', async () => {
    signInAsAdmin()
    leagueFindFirst.mockResolvedValue({ id: 'lg2', platform: 'espn', platformLeagueId: E_LEAGUE, season: 2026 })
    const res = await POST(post({ leagueId: 'lg2' }))
    expect(res.status).toBe(200)
    const text = await res.text()
    for (const value of E_SENSITIVE) expect(text, value).not.toContain(value)
    expect(text).toContain('Patrick Mahomes')
    expect(text).toContain('fixture-manager-1')
    const doc = JSON.parse(text)
    expect(doc.requests.map((r: any) => [r.resource, r.httpStatus, r.body === null])).toEqual([
      ['league_teams_transactions', 200, false],
      ['pending_transactions_candidate', 400, true],
    ])
  })

  it('refuses — throws, no document — when an original value survives', () => {
    const run = () =>
      buildRedactedCaptureDocument({
        provider: 'yahoo', capturedAt: '2026-11-25T00:00:00Z', sport: 'NFL', season: 2026, week: 11,
        leagueIdentifiers: [Y_LEAGUE], ownerTeamKey: null, credentialValues: [ACCESS_TOKEN], notes: [],
        // A token pasted into a field no rule knows about: nothing rewrites it, so the verifier must catch it.
        requests: [{ resource: 'league_teams', requestTemplate: 'x', httpStatus: 200, body: { odd_field: `echo ${ACCESS_TOKEN}` } }],
      })
    expect(run).toThrow(ContractCaptureRedactionError)
  })

  it('a three-letter member name inside an NFL player name is not a leak (owner capture 2026-11-27)', () => {
    const doc = buildRedactedCaptureDocument({
      provider: 'espn', capturedAt: '2026-11-27T00:00:00Z', sport: 'NFL', season: 2026, week: null,
      leagueIdentifiers: ['919055'], ownerTeamKey: null, credentialValues: [], notes: [],
      requests: [{ resource: 'league_teams_transactions', requestTemplate: 'x', httpStatus: 200, body: {
        members: [{ id: '{AAAAAAAA-1111-2222-3333-444444444444}', firstName: 'Rob', lastName: 'Quinnbury', displayName: 'robq' }],
        teams: [{ id: 1, name: 'Quinnbury Crew', abbrev: 'QBC', roster: { entries: [{ playerPoolEntry: { player: { fullName: 'Bijan Robinson' } } }] } }],
      } }],
    })
    expect(doc.json).toContain('Bijan Robinson')
    expect(doc.json).not.toContain('"Rob"')
    expect(doc.json).not.toContain('Quinnbury')
  })

  it('a short value left standing as a whole field is still refused, and the refusal names its kind, not the value', () => {
    let error: unknown
    try {
      buildRedactedCaptureDocument({
        provider: 'espn', capturedAt: '2026-11-27T00:00:00Z', sport: 'NFL', season: 2026, week: null,
        leagueIdentifiers: ['919055'], ownerTeamKey: null, credentialValues: [], notes: [],
        requests: [{ resource: 'league_teams_transactions', requestTemplate: 'x', httpStatus: 200, body: {
          members: [{ id: '{AAAAAAAA-1111-2222-3333-444444444444}', firstName: 'Rob' }],
          // An unknown field holding the short name as a whole value: no rule rewrites it.
          extra: { owner_label: 'Rob' },
        } }],
      })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(ContractCaptureRedactionError)
    expect((error as Error).message).toContain('person, 3 chars')
    expect((error as Error).message).not.toContain('Rob')
  })

  it('the refusal reaches the client as an error with no body', async () => {
    signInAsAdmin()
    leagueFindFirst.mockResolvedValue({ id: 'lg1', platform: 'yahoo', platformLeagueId: Y_LEAGUE, season: 2026 })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ fantasy_content: { leaked: `token ${ACCESS_TOKEN}` } })))
    const res = await POST(post({ leagueId: 'lg1', week: 11 }))
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).not.toContain(ACCESS_TOKEN)
    expect(text).not.toContain('fantasy_content')
  })
})

/* ── 4. no credential in the output ────────────────────────────────────────────────────── */

describe('credentials never leave the server', () => {
  it('Yahoo token is sent to Yahoo only as a header, and is absent from body and headers', async () => {
    signInAsAdmin()
    leagueFindFirst.mockResolvedValue({ id: 'lg1', platform: 'yahoo', platformLeagueId: Y_LEAGUE, season: 2026 })
    const res = await POST(post({ leagueId: 'lg1', week: 11 }))
    const serialized = `${await res.text()}\n${JSON.stringify([...res.headers.entries()])}`
    for (const s of [ACCESS_TOKEN, REFRESH_TOKEN]) expect(serialized).not.toContain(s)
    expect(fetchCalls.every((c) => !c.url.includes(ACCESS_TOKEN))).toBe(true)
    expect(fetchCalls.every((c) => c.headers.Authorization === `Bearer ${ACCESS_TOKEN}`)).toBe(true)
  })

  it('ESPN cookies are absent from body and headers, and never in a URL', async () => {
    signInAsAdmin()
    leagueFindFirst.mockResolvedValue({ id: 'lg2', platform: 'espn', platformLeagueId: E_LEAGUE, season: 2026 })
    const res = await POST(post({ leagueId: 'lg2' }))
    const serialized = `${await res.text()}\n${JSON.stringify([...res.headers.entries()])}`
    for (const s of [SWID, ESPN_S2, 'AAAAAAAA-1111', 'espn_s2']) expect(serialized).not.toContain(s)
    expect(fetchCalls.every((c) => !c.url.includes(ESPN_S2) && !c.url.toUpperCase().includes('AAAAAAAA'))).toBe(true)
  })
})

/* ── 5. the request allowlist ──────────────────────────────────────────────────────────── */

describe('request allowlist', () => {
  it('Yahoo sends exactly the four allowlisted requests, whatever the body says', async () => {
    signInAsAdmin()
    leagueFindFirst.mockResolvedValue({ id: 'lg1', platform: 'yahoo', platformLeagueId: Y_LEAGUE, season: 2026 })
    await POST(post({ leagueId: 'lg1', week: 11, path: 'users;use_login=1/games', resource: 'league_settings', url: 'https://evil.example/' }))
    const paths = fetchCalls.map((c) => c.url.replace(/^https:\/\/fantasysports\.yahooapis\.com\/fantasy\/v2\//, ''))
    expect(paths).toEqual([
      `league/${Y_LEAGUE}/teams?format=json`,
      `team/${Y_TEAM}/roster;week=11/players/stats;type=week;week=11?format=json`,
      `league/${Y_LEAGUE}/scoreboard;week=11?format=json`,
      `league/${Y_LEAGUE}/transactions;types=pending_trade;team_key=${Y_TEAM}?format=json`,
    ])
  })

  it('ESPN sends only the two fixed view lists', async () => {
    signInAsAdmin()
    leagueFindFirst.mockResolvedValue({ id: 'lg2', platform: 'espn', platformLeagueId: E_LEAGUE, season: 2026 })
    await POST(post({ leagueId: 'lg2', views: ['kona_league_communication'], week: 3 }))
    const views = fetchCalls.map((c) => new URL(c.url).searchParams.getAll('view'))
    expect(views).toEqual([['mTeam', 'mTransactions2'], ['mPendingTransactions']])
  })

  it.each([
    ['week with a matrix param', { leagueId: 'lg1', week: '11;type=season' }],
    ['week out of range', { leagueId: 'lg1', week: 99 }],
    ['league id with a path', { leagueId: '../users;use_login=1', week: 11 }],
  ])('400s a %s before any provider call', async (_label, body) => {
    signInAsAdmin()
    leagueFindFirst.mockResolvedValue({ id: 'lg1', platform: 'yahoo', platformLeagueId: Y_LEAGUE, season: 2026 })
    const res = await POST(post(body))
    expect(res.status).toBe(400)
    expect(fetchCalls).toHaveLength(0)
  })

  it('a stored league key that is not Yahoo grammar is refused, not sent', async () => {
    signInAsAdmin()
    leagueFindFirst.mockResolvedValue({ id: 'lg1', platform: 'yahoo', platformLeagueId: '423.l.1/../../users;use_login=1', season: 2026 })
    const res = await POST(post({ leagueId: 'lg1', week: 11 }))
    expect(res.status).toBe(404)
    expect(fetchCalls).toHaveLength(0)
  })

  it('the path builder rejects anything off the allowlist', () => {
    const bad: any[] = [
      { resource: 'league_settings', leagueKey: Y_LEAGUE },
      { resource: 'league_teams', leagueKey: `${Y_LEAGUE}/settings` },
      { resource: 'team_roster_week_stats', teamKey: `${Y_TEAM};out=stats`, week: 1 },
      { resource: 'team_roster_week_stats', teamKey: Y_TEAM, week: '1' },
      { resource: 'pending_trades_for_team', leagueKey: Y_LEAGUE, teamKey: '423.l.11111.t.1' },
    ]
    for (const req of bad) expect(() => buildYahooContractCapturePath(req), JSON.stringify(req)).toThrow()
  })
})
