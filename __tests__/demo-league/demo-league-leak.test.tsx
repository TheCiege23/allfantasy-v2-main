// @vitest-environment node
/**
 * DEMO LEAGUE LEAK TESTS.
 *
 * Requests every demo page and every demo API endpoint against a fixture source league
 * full of distinctive REAL identifiers, and fails if any real manager name, team name,
 * username, email, platform/user id, avatar URL or league name appears in:
 *   - any API response body or header,
 *   - any rendered page (the HTML a browser would receive),
 *   - the prompt sent to the model for demo Chimmy,
 *   - anything logged while serving demo requests.
 *
 * The leak CHECKER here is written independently of `DemoRedactor` on purpose: if the
 * product's own detector had a blind spot, a test that reused it would share it.
 *
 * Two completeness guards keep this from rotting: every `page.tsx` under app/demo and
 * every `route.ts` under app/api/demo must appear in the lists below, so a new demo
 * surface without a leak test fails the suite.
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// ── Fixture: a real league with identifiers that cannot occur by accident ───────────
const REAL = {
  leagueId: 'lg-real-0f9e8d7c-6b5a-4321',
  leagueName: 'Gainesville Glory Dynasty Circle',
  platformLeagueId: '1048576000123456789',
  importerUserId: 'usr-commish-aa11bb22cc33',
  leagueAvatar: 'https://sleepercdn.com/avatars/leagueavatar998877',
  teams: [
    { id: 'lt-0001-aaaa', externalId: '1', ownerName: 'Bartholomew Quincey', teamName: "Quincey's Quarterback Cartel", platformUserId: '738291045566778899', claimedByUserId: 'usr-bart-77aa66bb55cc', avatarUrl: 'https://sleepercdn.com/avatars/bartavatar0011' },
    { id: 'lt-0002-bbbb', externalId: '2', ownerName: 'Philippa Wrenfield', teamName: 'Wrenfield Wrecking Crew', platformUserId: '738291045566770002', claimedByUserId: 'usr-pip-0022dd33ee44', avatarUrl: 'https://sleepercdn.com/avatars/pipavatar0022' },
    { id: 'lt-0003-cccc', externalId: '3', ownerName: 'Josh', teamName: 'Thunderbluff Tailgaters', platformUserId: '738291045566770003', claimedByUserId: null, avatarUrl: null },
    { id: 'lt-0004-dddd', externalId: '4', ownerName: 'Marisol Okonkwo-Brandt', teamName: 'Okonkwo Overdrive', platformUserId: '738291045566770004', claimedByUserId: 'usr-mari-0044ff55gg66', avatarUrl: null },
  ],
  users: [
    { id: 'usr-commish-aa11bb22cc33', email: 'commissioner.realperson@realmail-example.com', username: 'commish_realperson', displayName: 'Commissioner Realperson' },
    { id: 'usr-bart-77aa66bb55cc', email: 'bart.quincey@realmail-example.com', username: 'bquincey_ff', displayName: 'Bart Q' },
    { id: 'usr-pip-0022dd33ee44', email: 'pippa.wrenfield@realmail-example.com', username: 'pippawren', displayName: 'Pippa W.' },
    { id: 'usr-mari-0044ff55gg66', email: 'marisol.ob@realmail-example.com', username: 'marisol_ob', displayName: 'Marisol' },
  ],
}

const PLAYERS: Record<string, { name: string; position: string; team: string }> = {
  p1: { name: 'Josh Allen', position: 'QB', team: 'BUF' },
  p2: { name: 'Bijan Robinson', position: 'RB', team: 'ATL' },
  p3: { name: "Ja'Marr Chase", position: 'WR', team: 'CIN' },
  p4: { name: 'Sam LaPorta', position: 'TE', team: 'DET' },
  p5: { name: 'Jalen Hurts', position: 'QB', team: 'PHI' },
  p6: { name: 'Breece Hall', position: 'RB', team: 'NYJ' },
  p7: { name: 'Puka Nacua', position: 'WR', team: 'LAR' },
  p8: { name: 'Trey McBride', position: 'TE', team: 'ARI' },
}
const PLAYER_NAMES = Object.values(PLAYERS).map((p) => p.name)

const REAL_TERMS: string[] = [
  REAL.leagueId, REAL.leagueName, REAL.platformLeagueId, REAL.importerUserId, REAL.leagueAvatar,
  ...REAL.teams.flatMap((t) => [t.id, t.ownerName, t.teamName, t.platformUserId, t.claimedByUserId ?? '', t.avatarUrl ?? '']),
  ...REAL.users.flatMap((u) => [u.id, u.email, u.username, u.displayName]),
].filter(Boolean)

/** Independent leak checker. Player names are removed first so "Josh" ≠ "Josh Allen". */
function findLeaks(text: string): string[] {
  let hay = text
  for (const n of PLAYER_NAMES) hay = hay.split(n).join(' ')
  // HTML/JSON escaping of the apostrophe in "Quincey's".
  hay = hay.replace(/&#x27;|&#39;|\\u0027/g, "'")
  const lower = hay.toLowerCase()
  return REAL_TERMS.filter((term) => {
    const t = term.toLowerCase()
    if (t.length <= 4) return new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(lower)
    return lower.includes(t)
  })
}

// ── In-memory prisma ────────────────────────────────────────────────────────────────
const config = new Map<string, string>()
const db = {
  platformConfig: {
    findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (config.has(where.key) ? { value: config.get(where.key)! } : null)),
    upsert: vi.fn(async ({ where, create, update }: { where: { key: string }; create: { value: string }; update: { value: string } }) => {
      config.set(where.key, config.has(where.key) ? update.value : create.value)
      return {}
    }),
    deleteMany: vi.fn(async ({ where }: { where: { key: string } }) => {
      config.delete(where.key)
      return { count: 1 }
    }),
  },
  league: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
      where.id === REAL.leagueId
        ? {
            id: REAL.leagueId, name: REAL.leagueName, platform: 'sleeper', platformLeagueId: REAL.platformLeagueId, sport: 'NFL',
            season: 2026, scoring: 'ppr', leagueType: 'dynasty', isDynasty: true, leagueSize: 4,
            starters: ['QB', 'RB', 'WR', 'TE', 'SUPER_FLEX'], playoffTeams: 2, playoffStartWeek: 14, tradeDeadlineWeek: 11,
            waiverType: 'FAAB', lastSyncedAt: new Date(Date.now() - 5 * 60_000), avatarUrl: REAL.leagueAvatar, logoUrl: null,
            userId: REAL.importerUserId,
          }
        : null,
    ),
  },
  leagueTeam: {
    findMany: vi.fn(async () =>
      REAL.teams.map((t, i) => ({
        ...t, wins: 6 - i, losses: 2 + i, ties: 0, pointsFor: 1100 - i * 40.5, pointsAgainst: 1000 + i * 12.25, currentRank: i + 1, isOrphan: false,
      })),
    ),
  },
  appUser: { findMany: vi.fn(async () => REAL.users) },
  weeklyMatchup: {
    findMany: vi.fn(async () => {
      const rows = []
      for (const week of [1, 2, 3]) {
        const scored = week < 3
        rows.push(
          { seasonYear: 2026, week, rosterId: '1', matchupId: 1, pointsFor: scored ? 120.4 + week : 0, pointsAgainst: scored ? 101.2 : 0, win: 1 },
          { seasonYear: 2026, week, rosterId: '2', matchupId: 1, pointsFor: scored ? 101.2 : 0, pointsAgainst: scored ? 120.4 + week : 0, win: 0 },
          { seasonYear: 2026, week, rosterId: '3', matchupId: 2, pointsFor: scored ? 99.9 : 0, pointsAgainst: scored ? 110.1 : 0, win: 0 },
          { seasonYear: 2026, week, rosterId: '4', matchupId: 2, pointsFor: scored ? 110.1 : 0, pointsAgainst: scored ? 99.9 : 0, win: 1 },
        )
      }
      return rows
    }),
  },
  roster: {
    findMany: vi.fn(async () => [
      // playerData deliberately carries the import block with real identities — it must never pass through.
      { platformUserId: '738291045566778899', playerData: { players: ['p1', 'p2'], starters: ['p1', 'p2'], import: { ownerName: 'Bartholomew Quincey', teamName: "Quincey's Quarterback Cartel", avatarUrl: 'https://sleepercdn.com/avatars/bartavatar0011', sourceManagerId: '738291045566778899' } } },
      { platformUserId: 'usr-pip-0022dd33ee44', playerData: { players: ['p3', 'p4'], starters: ['p3', '0'] } },
      { platformUserId: '3', playerData: { players: ['p5', 'p6'], starters: ['p5', 'p6'] } },
      { platformUserId: '738291045566770004', playerData: { players: ['p7', 'p8'], starters: ['p7', 'p8'] } },
    ]),
  },
  aiCommissionerAlert: {
    findMany: vi.fn(async () => [
      { headline: 'Bartholomew Quincey has left an empty starting slot' },
      { headline: 'bquincey_ff and Philippa Wrenfield traded twice this week' },
    ]),
  },
  $executeRaw: vi.fn(async () => 1),
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
}

vi.mock('@/lib/prisma', () => ({ prisma: db }))

vi.mock('@/lib/core-app/sleeperPlayerRefs', () => ({
  resolveSleeperPlayers: vi.fn(async (ids: string[]) =>
    new Map(ids.filter((id) => PLAYERS[id]).map((id) => [id, { sleeperId: id, ...PLAYERS[id]!, imageUrl: `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`, ref: null }])),
  ),
}))
vi.mock('@/lib/player-identity/resolveProviderRosterPlayers', () => ({ resolveProviderRosterPlayers: vi.fn(async () => new Map()) }))

vi.mock('@/lib/core-app/persistedRecentTrades', () => ({
  persistedRecentTrades: vi.fn(async () => [
    {
      id: `sleeper:${REAL.platformLeagueId}:tx1`, leagueId: REAL.leagueId, leagueName: REAL.leagueName, leagueAvatarUrl: REAL.leagueAvatar,
      platformLeagueId: REAL.platformLeagueId, acceptedAt: new Date().toISOString(), partial: false, verdict: null,
      sides: [
        { rosterId: '1', managerName: 'Bartholomew Quincey', teamName: "Quincey's Quarterback Cartel", avatarUrl: 'https://sleepercdn.com/avatars/bartavatar0011', received: [{ kind: 'player', playerId: 'p3', name: "Ja'Marr Chase", position: 'WR', team: 'CIN', headshotUrl: null, teamLogoUrl: null }], grade: null, gradeBasis: null, gradeReason: 'Trade note from Bartholomew Quincey: dont tell Pippa' },
        // An unmatched side keyed by a platform USER id rather than a roster id.
        { rosterId: '738291045566770002', managerName: 'Philippa Wrenfield', teamName: 'Wrenfield Wrecking Crew', avatarUrl: null, received: [{ kind: 'player', playerId: 'p1', name: 'Josh Allen', position: 'QB', team: 'BUF', headshotUrl: null, teamLogoUrl: null }], grade: null, gradeBasis: null, gradeReason: '' },
      ],
    },
  ]),
}))

const prompts: string[] = []
vi.mock('@/lib/ai/providerRouter', () => ({
  routeTextCall: vi.fn(async (args: { messages: Array<{ content: string }> }) => {
    prompts.push(args.messages.map((m) => m.content).join('\n'))
    // A model that "hallucinates" or echoes a real name must still never get it to the browser.
    return { ok: true, text: 'The top team is run by Bartholomew Quincey (bquincey_ff) — just kidding, it is a demo.', model: 'mock', provider: 'openai', tokensUsed: 1 }
  }),
}))

vi.mock('@/lib/fantasycalc-db', () => ({
  getFantasyCalcValuesDbFirst: vi.fn(async () =>
    PLAYER_NAMES.map((name, i) => ({ player: { id: i, name, position: 'QB', maybeTeam: null, sleeperId: String(i) }, value: 9000 - i * 700, overallRank: i + 1, positionRank: 1 })),
  ),
}))

vi.mock('@/lib/core-app/playerFinder', () => ({
  searchPlayers: vi.fn(async () => [{ externalId: 'x1', sleeperId: 'p1', name: 'Josh Allen', position: 'QB', team: 'BUF', imageUrl: null, number: 17, rosteredIn: null, platforms: [], sport: 'NFL' }]),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => React.createElement('a', { href, ...rest }, children),
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/demo',
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  redirect: () => {
    throw new Error('NEXT_REDIRECT')
  },
}))

// ── Log capture ─────────────────────────────────────────────────────────────────────
const logged: string[] = []
const LOG_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const
beforeEach(() => {
  for (const m of LOG_METHODS) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
    })
  }
})
afterEach(() => {
  vi.restoreAllMocks()
})

// ── Surfaces under test ────────────────────────────────────────────────────────────
const API_ROUTE_FILES = [
  'app/api/demo/league/route.ts',
  'app/api/demo/team/[slot]/route.ts',
  'app/api/demo/chimmy/route.ts',
  'app/api/demo/trade/route.ts',
  'app/api/demo/players/route.ts',
]
const PAGE_FILES = [
  'app/demo/page.tsx',
  'app/demo/teams/[slot]/page.tsx',
  'app/demo/trades/page.tsx',
  'app/demo/chimmy/page.tsx',
  'app/demo/players/page.tsx',
  'app/demo/trade-evaluator/page.tsx',
  // Generated sample leagues: no source data at all. Rendered, and checked to never touch the
  // database, in demo-formats.test.tsx.
  'app/demo/formats/page.tsx',
  'app/demo/formats/[format]/page.tsx',
]

function walk(dir: string, name: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p, name) : e.name === name ? [path.relative(process.cwd(), p).split(path.sep).join('/')] : []
  })
}

function req(url: string, init?: RequestInit) {
  return new Request(`http://localhost${url}`, { headers: { 'x-forwarded-for': '203.0.113.7', 'content-type': 'application/json' }, ...init })
}

async function bodyOf(res: Response): Promise<{ status: number; text: string; headers: string }> {
  const text = await res.text()
  const headers = JSON.stringify(Object.fromEntries(res.headers.entries()))
  return { status: res.status, text, headers }
}

describe('demo league — no real identifier reaches any response, page, prompt or log', () => {
  beforeAll(async () => {
    const { setDemoSourceConfig } = await import('@/lib/demo-league/config')
    await setDemoSourceConfig(REAL.leagueId, REAL.importerUserId)
  })
  beforeEach(async () => {
    const { resetDemoCache } = await import('@/lib/demo-league/service')
    resetDemoCache()
    logged.length = 0
    prompts.length = 0
  })

  it('the leak checker itself catches a raw fixture (positive control)', () => {
    const raw = JSON.stringify({ team: REAL.teams[0], user: REAL.users[1] })
    expect(findLeaks(raw).length).toBeGreaterThan(3)
    // …and does not flag a player whose first name matches a manager's ("Josh" vs "Josh Allen").
    expect(findLeaks(JSON.stringify({ player: 'Josh Allen' }))).toEqual([])
    expect(findLeaks(JSON.stringify({ owner: 'Josh' }))).toEqual(['Josh'])
  })

  it('every app/demo page and app/api/demo route is covered by this suite', () => {
    expect(walk(path.join(process.cwd(), 'app/demo'), 'page.tsx').sort()).toEqual([...PAGE_FILES].sort())
    expect(walk(path.join(process.cwd(), 'app/api/demo'), 'route.ts').sort()).toEqual([...API_ROUTE_FILES].sort())
  })

  it('GET /api/demo/league', async () => {
    const { GET } = await import('@/app/api/demo/league/route')
    const r = await bodyOf(await GET(req('/api/demo/league')))
    expect(r.status).toBe(200)
    expect(findLeaks(r.text + r.headers)).toEqual([])
    const view = JSON.parse(r.text)
    expect(view.label).toBe('Demo league — live sample data')
    expect(view.teams).toHaveLength(4)
    // Real data is kept: players, scores, standings.
    expect(r.text).toContain('Josh Allen')
    expect(view.standings[0].pointsFor).toBeGreaterThan(0)
    expect(view.trades[0].sides).toHaveLength(2)
    // The commissioner alert survived, rewritten onto the alias.
    expect(view.alerts.some((a: { text: string }) => a.kind === 'commissioner')).toBe(true)
    expect(r.headers).toContain('no-store')
  })

  it('GET /api/demo/team/:slot for every team', async () => {
    const { GET } = await import('@/app/api/demo/team/[slot]/route')
    for (const slot of [1, 2, 3, 4]) {
      const r = await bodyOf(await GET(req(`/api/demo/team/${slot}`), { params: Promise.resolve({ slot: String(slot) }) }))
      expect(r.status).toBe(200)
      expect(findLeaks(r.text + r.headers)).toEqual([])
    }
  })

  it('POST /api/demo/chimmy — prompt contains no real identifier, and an echoed one is scrubbed', async () => {
    const { POST } = await import('@/app/api/demo/chimmy/route')
    const r = await bodyOf(await POST(req('/api/demo/chimmy', { method: 'POST', body: JSON.stringify({ message: 'Who runs the top team? Is it Bartholomew Quincey?' }) })))
    expect(r.status).toBe(200)
    expect(prompts).toHaveLength(1)
    // The SYSTEM prompt is ours; it must be alias-only. (The visitor's own message is theirs.)
    expect(findLeaks(prompts[0]!.split('Who runs the top team?')[0]!)).toEqual([])
    expect(findLeaks(r.text + r.headers)).toEqual([])
  })

  it('demo Chimmy is not a de-anonymization oracle: a typed real name never comes back as its alias', async () => {
    const { POST } = await import('@/app/api/demo/chimmy/route')
    const r = await bodyOf(await POST(req('/api/demo/chimmy', { method: 'POST', body: JSON.stringify({ message: 'Which team does Bartholomew Quincey (bquincey_ff) run?' }) })))
    expect(r.status).toBe(200)
    // The model never saw the real name, even though the visitor typed it.
    expect(findLeaks(prompts.at(-1)!)).toEqual([])
    const answer = JSON.parse(r.text).answer as string
    // The mocked model echoes "Bartholomew Quincey (bquincey_ff)"; that must become a neutral
    // placeholder — NOT the alias of the team he really runs, which would confirm the mapping.
    expect(answer).toContain('[name hidden]')
    const { aliasTeam } = await import('@/lib/demo-league/view')
    const bartsAlias = aliasTeam(0)
    expect(answer).not.toContain(bartsAlias.managerName)
    expect(answer).not.toContain(bartsAlias.teamName)
  })

  it('POST /api/demo/trade', async () => {
    const { POST } = await import('@/app/api/demo/trade/route')
    const r = await bodyOf(await POST(req('/api/demo/trade', { method: 'POST', body: JSON.stringify({ slotA: 1, slotB: 2, giveA: ['Josh Allen'], giveB: ["Ja'Marr Chase"] }) })))
    expect(r.status).toBe(200)
    expect(JSON.parse(r.text).summary).toMatch(/ahead|even/i)
    expect(findLeaks(r.text + r.headers)).toEqual([])
  })

  it('GET /api/demo/players (browse + search)', async () => {
    const { GET } = await import('@/app/api/demo/players/route')
    for (const url of ['/api/demo/players', '/api/demo/players?q=josh']) {
      const r = await bodyOf(await GET(req(url)))
      expect(r.status).toBe(200)
      expect(findLeaks(r.text + r.headers)).toEqual([])
    }
  })

  it('demo APIs refuse writes (read-only)', async () => {
    const league = await import('@/app/api/demo/league/route')
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const res = (league as Record<string, () => Response>)[m]!()
      expect(res.status).toBe(405)
    }
  })

  it('renders every demo page with no real identifier in the HTML', async () => {
    const Layout = (await import('@/app/demo/layout')).default
    const pages: Array<[string, () => Promise<React.ReactElement> | React.ReactElement]> = [
      ['/demo', async () => (await import('@/app/demo/page')).default()],
      ['/demo/trades', async () => (await import('@/app/demo/trades/page')).default()],
      ['/demo/chimmy', async () => (await import('@/app/demo/chimmy/page')).default()],
      ['/demo/players', async () => (await import('@/app/demo/players/page')).default()],
      ['/demo/trade-evaluator', async () => (await import('@/app/demo/trade-evaluator/page')).default()],
      ...[1, 2, 3, 4].map((slot) => [`/demo/teams/${slot}`, async () => (await import('@/app/demo/teams/[slot]/page')).default({ params: Promise.resolve({ slot: String(slot) }) })] as [string, () => Promise<React.ReactElement>]),
    ]
    for (const [url, render] of pages) {
      const html = renderToStaticMarkup(React.createElement(Layout, null, await render()))
      expect(html, url).toContain('Demo league — live sample data')
      expect(findLeaks(html), url).toEqual([])
      expect(html, url).not.toContain('sleepercdn.com/avatars')
    }
  })

  it('nothing logged while serving demo requests contains a real identifier', async () => {
    const { GET } = await import('@/app/api/demo/league/route')
    await GET(req('/api/demo/league'))
    const { POST } = await import('@/app/api/demo/chimmy/route')
    await POST(req('/api/demo/chimmy', { method: 'POST', body: JSON.stringify({ message: 'hi' }) }))
    expect(findLeaks(logged.join('\n'))).toEqual([])
  })

  it('fake names are stable across requests and a new team never takes an existing alias', async () => {
    const { GET } = await import('@/app/api/demo/league/route')
    const first = JSON.parse(await (await GET(req('/api/demo/league'))).text()).teams
    const { resetDemoCache } = await import('@/lib/demo-league/service')
    resetDemoCache()
    const second = JSON.parse(await (await GET(req('/api/demo/league'))).text()).teams
    expect(second).toEqual(first)

    const { ensureTeamAliases } = await import('@/lib/demo-league/config')
    const before = await ensureTeamAliases(REAL.leagueId, REAL.teams.map((t) => t.id))
    const after = await ensureTeamAliases(REAL.leagueId, ['lt-9999-new', ...REAL.teams.map((t) => t.id)])
    for (const t of REAL.teams) expect(after.get(t.id)).toBe(before.get(t.id))
    expect(after.get('lt-9999-new')).toBe(4)
  })
})

describe('demo code never reaches a notification, email, push, SMS or ad-conversion path', () => {
  const FORBIDDEN = [
    'notifications/NotificationDispatcher', 'platform/notification-service', 'push-notifications', 'resend-client',
    'twilio-client', 'notification-engine', 'chat-notifications', 'teamDeliveryReceipts', 'draft-notifications',
    'meta-capi', 'jobs/enqueue', 'automation/notifications', 'analytics/recordAnalyticsEvent',
  ]
  const tree = (dir: string): string[] =>
    fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? tree(`${dir}/${e.name}`) : [`${dir}/${e.name}`])
  const files = [
    ...tree('lib/demo-league').filter((f) => !f.endsWith('/testLeagueFill.ts')),
    ...tree('components/demo-league'),
    ...API_ROUTE_FILES,
    ...PAGE_FILES,
    'app/demo/layout.tsx',
  ]
  it.each(files)('%s imports no dispatcher', (file) => {
    const src = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
    const imports = src.match(/from\s+['"][^'"]+['"]|import\(\s*['"][^'"]+['"]\s*\)/g) ?? []
    for (const imp of imports) for (const f of FORBIDDEN) expect(imp, `${file}: ${imp}`).not.toContain(f)
  })
})
