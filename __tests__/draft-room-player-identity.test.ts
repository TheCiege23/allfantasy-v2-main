// @vitest-environment node
/**
 * Draft room (`/draft`) — every player id is a SLEEPER id, resolved in the Sleeper namespace.
 *
 * The prisma mock below is a tiny in-memory table that APPLIES the `where` it is given and returns
 * rows in their fixture ("physical") order when no `orderBy` is set — so a query with no `source`
 * filter and no ordering gets the wrong row first, exactly as production did on 2026-10-11:
 *
 *   "Josh Allen"       -> backfill row, externalId 2135  (RI 2135 = Josh Hines-Allen,
 *                                                        Sleeper 2135 = Ha Ha Clinton-Dix)
 *   "Justin Jefferson" -> the CLE linebacker's Rolling Insights row
 *   "Mike Williams"    -> retired sleeper:748
 *
 * Fixture rows are copied from production SELECTs taken that day.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'

type Row = Record<string, unknown>

// ---------------------------------------------------------------- in-memory where/orderBy
function matchValue(actual: unknown, cond: unknown): boolean {
  if (cond === null) return actual == null
  if (typeof cond !== 'object' || cond instanceof Date) return actual === cond
  const c = cond as Record<string, unknown>
  const insensitive = c.mode === 'insensitive'
  const norm = (v: unknown) => (insensitive && typeof v === 'string' ? v.toLowerCase() : v)
  if ('in' in c && !(c.in as unknown[]).map(norm).includes(norm(actual))) return false
  if ('equals' in c && norm(actual) !== norm(c.equals)) return false
  if ('not' in c) {
    if (c.not === null ? actual == null : actual === c.not) return false
  }
  if ('has' in c && !(Array.isArray(actual) && actual.includes(c.has))) return false
  return true
}

function matches(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true
  for (const [k, v] of Object.entries(where)) {
    if (k === 'OR') {
      if (!(v as Record<string, unknown>[]).some((w) => matches(row, w))) return false
    } else if (k === 'AND') {
      if (!(v as Record<string, unknown>[]).every((w) => matches(row, w))) return false
    } else if (!matchValue(row[k], v)) {
      return false
    }
  }
  return true
}

function query(table: Row[], args: { where?: Record<string, unknown>; orderBy?: unknown; take?: number } = {}): Row[] {
  let out = table.filter((r) => matches(r, args.where))
  const orders = args.orderBy ? (Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy]) : []
  if (orders.length) {
    out = [...out].sort((a, b) => {
      for (const o of orders as Record<string, 'asc' | 'desc'>[]) {
        const [k, dir] = Object.entries(o)[0]!
        const x = a[k] as string | number | Date
        const y = b[k] as string | number | Date
        if (x === y) continue
        const cmp = x < y ? -1 : 1
        return dir === 'desc' ? -cmp : cmp
      }
      return 0
    })
  }
  return args.take ? out.slice(0, args.take) : out
}

// ---------------------------------------------------------------- fixtures (production shapes)
const d = new Date('2026-10-01T00:00:00Z')
const sp = (r: Partial<Row>): Row => ({
  sport: 'NFL',
  sleeperId: null,
  imageUrl: null,
  status: null,
  height: null,
  weight: null,
  age: null,
  college: null,
  fetchedAt: d,
  ...r,
})

const SPORTS_PLAYER: Row[] = [
  // Wrong rows FIRST, as Postgres returned them.
  sp({ id: 'bf-2135', source: 'backfill', externalId: '2135', name: 'Josh Allen', position: 'QB', team: 'Buffalo Bills', imageUrl: 'https://img/backfill-allen.png' }),
  sp({ id: 'ri-2135', source: 'rolling_insights', externalId: '2135', name: 'Josh Hines-Allen', position: 'DL', team: 'Jacksonville Jaguars', imageUrl: 'https://img/ri-hines-allen.png' }),
  sp({ id: 'ri-3348', source: 'rolling_insights', externalId: '3348', name: 'Josh Allen', position: 'QB', team: 'Buffalo Bills' }),
  sp({ id: 'sl-2212', source: 'sleeper', externalId: 'sleeper:2212', sleeperId: '2212', name: 'Josh Allen', position: 'G', team: null, imageUrl: 'https://img/sleeper-2212.png' }),
  sp({ id: 'sl-4984', source: 'sleeper', externalId: 'sleeper:4984', sleeperId: '4984', name: 'Josh Allen', position: 'QB', team: 'Buffalo Bills', imageUrl: 'https://img/sleeper-4984.png', status: 'Active', college: 'Wyoming' }),
  sp({ id: 'sl-2135', source: 'sleeper', externalId: 'sleeper:2135', sleeperId: '2135', name: 'Ha Ha Clinton-Dix', position: 'DB', team: 'Denver Broncos', imageUrl: 'https://img/sleeper-2135.png' }),
  sp({ id: 'sl-748', source: 'sleeper', externalId: 'sleeper:748', sleeperId: '748', name: 'Mike Williams', position: 'WR', team: null, status: 'Inactive' }),
  sp({ id: 'sl-4068', source: 'sleeper', externalId: 'sleeper:4068', sleeperId: '4068', name: 'Mike Williams', position: 'WR', team: null, status: 'Active' }),
  sp({ id: 'ri-9728', source: 'rolling_insights', externalId: '9728', name: 'Justin Jefferson', position: 'LB', team: 'Cleveland Browns' }),
  sp({ id: 'sl-13524', source: 'sleeper', externalId: 'sleeper:13524', sleeperId: '13524', name: 'Justin Jefferson', position: 'LB', team: 'Cleveland Browns' }),
  sp({ id: 'ri-5904', source: 'rolling_insights', externalId: '5904', name: 'Justin Jefferson', position: 'WR', team: 'Minnesota Vikings' }),
  sp({ id: 'sl-6794', source: 'sleeper', externalId: 'sleeper:6794', sleeperId: '6794', name: 'Justin Jefferson', position: 'WR', team: 'Minnesota Vikings', imageUrl: 'https://img/sleeper-6794.png' }),
  sp({ id: 'sl-7564', source: 'sleeper', externalId: 'sleeper:7564', sleeperId: '7564', name: "Ja'Marr Chase", position: 'WR', team: 'Cincinnati Bengals' }),
  sp({ id: 'sl-5859', source: 'sleeper', externalId: 'sleeper:5859', sleeperId: '5859', name: 'A.J. Brown', position: 'WR', team: 'New England Patriots' }),
  sp({ id: 'sl-7000', source: 'sleeper', externalId: 'sleeper:7000', sleeperId: '7000', name: 'Right Guy', position: 'WR', team: 'Detroit Lions' }),
]

const IDENTITY: Row[] = [
  { sport: 'NFL', canonicalName: 'Josh Allen', normalizedName: 'josh allen', position: 'DL', currentTeam: 'JAX', sleeperId: '5840' },
  { sport: 'NFL', canonicalName: 'Josh Allen', normalizedName: 'josh allen', position: 'QB', currentTeam: 'BUF', sleeperId: '4984' },
  // No Sleeper SportsPlayer row spells him this way — the identity map is the only Sleeper-id path.
  { sport: 'NFL', canonicalName: 'Travis Etienne Jr.', normalizedName: 'travis etienne', position: 'RB', currentTeam: 'NO', sleeperId: '7543' },
]

const RECORDS: Row[] = [
  { id: 'NFL:2135', sport: 'NFL', name: 'Ha Ha Clinton-Dix', team: 'DEN', position: 'DB', dataSource: 'manual', stats: {}, projections: {}, adp: null, headshotUrl: null },
  { id: 'NFL:4984', sport: 'NFL', name: 'Josh Allen', team: 'BUF', position: 'QB', dataSource: 'manual', stats: { passYds: 4000 }, projections: {}, adp: 29, headshotUrl: null },
  { id: 'NFL:7000', sport: 'NFL', name: 'Wrong Guy', team: 'CLE', position: 'LB', dataSource: 'cached', stats: { tackles: 99 }, projections: {}, adp: null, headshotUrl: 'https://img/wrong-guy.png' },
]

const NEWS: Row[] = [
  { id: 'n-jax', sport: 'NFL', title: 'Allen sacks the QB twice', playerName: 'Josh Allen', team: 'JAX', teams: ['JAX'], source: 'espn', content: null, sourceUrl: null, publishedAt: d, fetchedAt: d, category: null },
  { id: 'n-buf', sport: 'NFL', title: 'Allen throws three touchdowns', playerName: 'Josh Allen', team: 'BUF', teams: ['BUF'], source: 'espn', content: null, sourceUrl: null, publishedAt: d, fetchedAt: d, category: null },
]

const adpEntry = (name: string, adp: number, position: string, team: string) => ({
  name, adp, position, team, providerCount: 4, providers: [], adpSpread: null, season: 2026, week: 35, format: 'redraft', scoring: 'standard',
})
const ADP_BOARD = [
  adpEntry("Ja'Marr Chase", 3.04, 'WR', 'CIN'),
  adpEntry('Justin Jefferson', 9.73, 'WR', 'MIN'),
  // ADP's team lags the trade (Sleeper: NE). Must still bind — he is the only A.J. Brown.
  adpEntry('A.J. Brown', 15.7, 'WR', 'PHI'),
  adpEntry('Josh Allen', 24.4, 'QB', 'BUF'),
  adpEntry('Travis Etienne Jr.', 90.57, 'RB', 'JAX'),
  adpEntry('Mike Williams', 400, 'WR', 'LAC'),
]

// ---------------------------------------------------------------- mocks
const h = vi.hoisted(() => ({
  session: vi.fn(),
  adp: vi.fn(),
  executeDraftPick: vi.fn(),
  draftAiText: vi.fn(),
  picks: [] as Array<{ playerId: string | null }>,
  queue: null as null | { playerIds: string[] },
  state: null as null | Record<string, unknown>,
}))

vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/adp/liveAdpFallback', () => ({ getLiveAdpByName: (...a: unknown[]) => h.adp(...a) }))
vi.mock('@/lib/draft/execute-pick', () => ({ executeDraftPick: (...a: unknown[]) => h.executeDraftPick(...a) }))
vi.mock('@/lib/draft/ai-claude', () => ({ draftAiText: (...a: unknown[]) => h.draftAiText(...a) }))
vi.mock('@/lib/injuries/injuryReadPort', () => ({
  resolveInjuryFacts: vi.fn(async () => ({ byPlayer: new Map() })),
}))
vi.mock('@/lib/prisma', () => {
  const table = (rows: () => Row[]) => ({
    findMany: vi.fn(async (args?: Parameters<typeof query>[1]) => query(rows(), args)),
    findFirst: vi.fn(async (args?: Parameters<typeof query>[1]) => query(rows(), args)[0] ?? null),
    findUnique: vi.fn(async (args?: { where?: Record<string, unknown> }) => query(rows(), args)[0] ?? null),
  })
  return {
    prisma: {
      sportsPlayer: table(() => SPORTS_PLAYER),
      playerIdentityMap: table(() => IDENTITY),
      sportsPlayerRecord: table(() => RECORDS),
      sportsNews: table(() => NEWS),
      draftRoomPickRecord: {
        findMany: vi.fn(async () => h.picks),
        count: vi.fn(async () => h.picks.length),
      },
      draftRoomUserQueue: { findUnique: vi.fn(async () => h.queue) },
      draftRoomStateRow: { findUnique: vi.fn(async () => h.state) },
      draftAutopickSetting: { findUnique: vi.fn(async () => ({ enabled: true })) },
    },
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  h.session.mockResolvedValue({ user: { id: 'u1' } })
  h.adp.mockResolvedValue(new Map(ADP_BOARD.map((e) => [e.name.toLowerCase(), e])))
  h.executeDraftPick.mockResolvedValue({ ok: true, overallPick: 1 })
  h.draftAiText.mockRejectedValue(new Error('no ai in tests'))
  h.picks = []
  h.queue = null
  h.state = { id: 'mock:room1', status: 'active', pickOrder: [{ id: 'u1' }, { id: 'cpu-1' }], numTeams: 2, numRounds: 15 }
})

async function board(): Promise<Array<{ id: string; name: string; position: string; team: string; adp: number | null; imageUrl: string | null }>> {
  const { GET } = await import('@/app/api/draft/players/route')
  const res = await GET(createMockNextRequest('http://localhost/api/draft/players?sport=NFL') as never)
  return (await res.json()).players
}

async function detail(playerId: string) {
  const { GET } = await import('@/app/api/draft/player-detail/route')
  const res = await GET(createMockNextRequest(`http://localhost/api/draft/player-detail?sport=NFL&playerId=${playerId}`) as never)
  return res.json()
}

async function postSession(path: '@/app/api/draft/worker/route' | '@/app/api/draft/mock/cpu-pick/route') {
  const { POST } = await import(path)
  const req = new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ sessionId: 'mock:room1' }) })
  return POST(req as never)
}

// ---------------------------------------------------------------- 1. the board
describe('/api/draft/players — the board speaks Sleeper ids', () => {
  it('Josh Allen is Sleeper 4984 — not the backfill/RI number 2135 (Josh Hines-Allen)', async () => {
    const allen = (await board()).find((p) => p.name === 'Josh Allen')
    expect(allen?.id).toBe('4984')
    expect(allen?.id).not.toBe('2135')
    expect(allen?.position).toBe('QB')
    expect(allen?.team).toBe('BUF')
  })

  it('Justin Jefferson is the MIN receiver (6794), never a CLE linebacker row', async () => {
    const jj = (await board()).filter((p) => p.name === 'Justin Jefferson')
    expect(jj.map((p) => p.id)).toEqual(['6794'])
    expect(jj[0]!.position).toBe('WR')
  })

  it('refuses Mike Williams — two Sleeper WRs, no team on either — rather than taking retired 748', async () => {
    const ids = (await board()).filter((p) => p.name === 'Mike Williams').map((p) => p.id)
    expect(ids).toEqual([])
  })

  it('every id is a bare Sleeper id, ordered by ADP', async () => {
    const b = await board()
    expect(b.map((p) => p.id)).toEqual(['7564', '6794', '5859', '4984', '7543'])
    for (const p of b) expect(p.id).toMatch(/^\d+$/)
  })

  it('a stale ADP team does not drop a lone match (A.J. Brown PHI on the board, NE in Sleeper)', async () => {
    expect((await board()).find((p) => p.id === '5859')?.name).toBe('A.J. Brown')
  })

  it('reaches players only the identity map spells the board’s way (Travis Etienne Jr. -> 7543)', async () => {
    const te = (await board()).find((p) => p.id === '7543')
    expect(te?.name).toBe('Travis Etienne Jr.')
    expect(te?.imageUrl).toContain('7543')
  })
})

// ---------------------------------------------------------------- 2. the player modal
describe('/api/draft/player-detail — reads the id in its own namespace', () => {
  it('2135 with no record falls back through the SLEEPER namespace (Clinton-Dix), not externalId (Allen / Hines-Allen)', async () => {
    RECORDS.splice(0, 1) // drop NFL:2135 so only the seed fallback answers
    try {
      const j = await detail('2135')
      expect(j.profile.name).toBe('Ha Ha Clinton-Dix')
      expect(j.profile.headshotUrl).toBe('https://img/sleeper-2135.png')
    } finally {
      RECORDS.unshift({ id: 'NFL:2135', sport: 'NFL', name: 'Ha Ha Clinton-Dix', team: 'DEN', position: 'DB', dataSource: 'manual', stats: {}, projections: {}, adp: null, headshotUrl: null })
    }
  })

  it('refuses a SportsPlayerRecord whose name disagrees with the Sleeper player the id names', async () => {
    const j = await detail('7000')
    expect(j.profile.name).toBe('Right Guy')
    expect(j.stats).toBeNull()
    expect(j.profile.headshotUrl).not.toBe('https://img/wrong-guy.png')
  })

  it('4984 opens Josh Allen QB BUF with his record, and news matched on name AND team (not the JAX story)', async () => {
    const j = await detail('4984')
    expect(j.profile.name).toBe('Josh Allen')
    expect(j.profile.position).toBe('QB')
    expect(j.profile.team).toBe('BUF')
    expect(j.stats).toEqual({ passYds: 4000 })
    expect(j.news.map((n: { id: string }) => n.id)).toEqual(['n-buf'])
  })
})

// ---------------------------------------------------------------- 3. autopick + CPU pick
describe('/api/draft/worker and /api/draft/mock/cpu-pick — draft from the Sleeper-id board', () => {
  it('a queued Sleeper id drafts exactly that player (4984 -> Josh Allen QB)', async () => {
    h.queue = { playerIds: ['4984'] }
    await postSession('@/app/api/draft/worker/route')
    expect(h.executeDraftPick).toHaveBeenCalledTimes(1)
    const arg = h.executeDraftPick.mock.calls[0]![0] as Record<string, unknown>
    expect(arg.playerId).toBe('4984')
    expect(arg.playerName).toBe('Josh Allen')
    expect(arg.position).toBe('QB')
  })

  it('a stale queued provider id (2135) is not looked up by externalId — it is skipped for best ADP', async () => {
    h.queue = { playerIds: ['2135'] }
    await postSession('@/app/api/draft/worker/route')
    const arg = h.executeDraftPick.mock.calls[0]![0] as Record<string, unknown>
    expect(arg.playerName).not.toBe('Josh Hines-Allen')
    expect(arg.playerId).toBe('7564')
  })

  it('autopick with an empty queue takes the best ADP, not the alphabet', async () => {
    h.picks = [{ playerId: '7564' }] // Chase gone
    h.state = { ...h.state, pickOrder: [{ id: 'cpu-1' }, { id: 'u1' }] } // overall 2 -> slot 1 = u1
    await postSession('@/app/api/draft/worker/route')
    const arg = h.executeDraftPick.mock.calls[0]![0] as Record<string, unknown>
    expect(arg.playerName).toBe('Justin Jefferson')
    expect(arg.playerId).toBe('6794')
    // Alphabetically first in the table — what `orderBy: { name: 'asc' }` used to draft.
    expect(arg.playerName).not.toBe('A.J. Brown')
  })

  it('a CPU pick takes the best available ADP, not the alphabet', async () => {
    h.state = { ...h.state, pickOrder: [{ id: 'cpu-1' }, { id: 'u1' }] }
    await postSession('@/app/api/draft/mock/cpu-pick/route')
    const arg = h.executeDraftPick.mock.calls[0]![0] as Record<string, unknown>
    expect(arg.playerId).toBe('7564')
    expect(arg.playerName).toBe("Ja'Marr Chase")
  })
})

// ---------------------------------------------------------------- 4. commissioner pick edit
describe('resolveDraftPickPresentation — Sleeper namespace only, contradictions refused', () => {
  async function resolve(input: Record<string, unknown>) {
    const { resolveDraftPickPresentation } = await import('@/lib/live-draft-engine/resolveDraftPickPresentation')
    return resolveDraftPickPresentation({ leagueSport: 'NFL', ...input } as never)
  }

  it('id 2135 for Ha Ha Clinton-Dix saves HIS Sleeper headshot, not the RI/backfill row sharing the number', async () => {
    const r = await resolve({ playerName: 'Ha Ha Clinton-Dix', position: 'DB', team: 'DEN', playerId: '2135' })
    expect(r.playerId).toBe('2135')
    expect(r.playerImageUrl).toBe('https://img/sleeper-2135.png')
  })

  it('a stale id that names someone else is refused; the name resolves to Josh Allen 4984', async () => {
    const r = await resolve({ playerName: 'Josh Allen', position: 'QB', team: 'BUF', playerId: '2135' })
    expect(r.playerId).toBe('4984')
    expect(r.playerImageUrl).toBe('https://img/sleeper-4984.png')
  })

  it('name fallback resolves in the Sleeper namespace (Justin Jefferson WR MIN -> 6794, not RI 5904)', async () => {
    const r = await resolve({ playerName: 'Justin Jefferson', position: 'WR', team: 'MIN' })
    expect(r.playerId).toBe('6794')
    expect(r.playerImageUrl).toBe('https://img/sleeper-6794.png')
  })

  it('name fallback refuses namesakes it cannot separate instead of taking row 0', async () => {
    const r = await resolve({ playerName: 'Mike Williams', position: 'WR', team: null })
    expect(r.playerId).toBeNull()
    expect(r.playerImageUrl).toBeNull()
  })

  it('identity-map fallback keeps the team: Josh Allen DL JAX is 5840, never the Bills QB', async () => {
    const r = await resolve({ playerName: 'Josh Allen', position: 'DL', team: 'JAX' })
    expect(r.playerId).toBe('5840')
  })
})
