/**
 * Regression lock for the NFL redraft Trades UI wiring bug: `/api/league/trades-panel` hardcoded
 * `activeTrades: []` for every native (non-Sleeper) league regardless of what existed in
 * `AfLeagueTrade` — so the redraft Trades tab's "Active Trades" list, and any accept/reject/
 * cancel/commissioner-review controls built on top of it, could never reflect a real trade.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const getServerSession = vi.fn()
const findFirstLeague = vi.fn()
const findFirstRoster = vi.fn()
const findManyRoster = vi.fn()
const findManyAppUser = vi.fn()
const listAfLeagueTrades = vi.fn()
const isElevatedCommissioner = vi.fn()
/*
 * 🛑 THESE THREE MODELS WENT MISSING AND TOOK THE SUITE DOWN FOR DAYS.
 *
 * d1d2261d6 added `prisma.tradeDraft.findUnique` to the route without touching this
 * mock, and all 3 tests died with `Cannot read properties of undefined (reading
 * 'findUnique')` — pointing at the ROUTE, which was fine, rather than at the mock,
 * which was not.
 *
 * ⚠ AND THE ROUTE'S OWN DEFENCE CANNOT SAVE IT, WHICH IS WHY THE ERROR MISLEADS. Every
 * one of these calls is written `prisma.x.findUnique(...).catch(() => null)`, with a
 * comment explaining that a missing table must be a null rather than a 500. That
 * `.catch` handles a REJECTED QUERY. It cannot handle `prisma.x` being `undefined`,
 * because the TypeError is thrown synchronously on property access before any promise
 * exists. So the code reads as protected and is not, in tests only.
 *
 * A census of the route found THREE unmocked models, not one — `tradeDraft` was merely
 * the first the code path reached. `userProfile` sits inside `buildNativeActiveTrades`,
 * the exact path these tests take, so fixing only `tradeDraft` would have moved the
 * failure rather than removed it. The guard at the bottom of this file exists so the
 * next one is named instead of discovered.
 */
const findUniqueTradeDraft = vi.fn()
const findUniqueUserProfile = vi.fn()
const findFirstLeagueTeam = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => getServerSession(...args) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: (...args: unknown[]) => findFirstLeague(...args) },
    roster: {
      findFirst: (...args: unknown[]) => findFirstRoster(...args),
      findMany: (...args: unknown[]) => findManyRoster(...args),
    },
    appUser: { findMany: (...args: unknown[]) => findManyAppUser(...args) },
    tradeBlockEntry: { findMany: vi.fn().mockResolvedValue([]) },
    /*
     * delete/upsert belong to the POST and DELETE handlers rather than GET. They are
     * mocked anyway: the completeness guard below censuses the whole route module, and
     * a model that exists with a missing METHOD fails as
     * `prisma.tradeDraft.upsert is not a function` — the same opaque class of error,
     * one level down.
     */
    tradeDraft: {
      findUnique: (...args: unknown[]) => findUniqueTradeDraft(...args),
      delete: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ updatedAt: new Date(0) }),
    },
    userProfile: { findUnique: (...args: unknown[]) => findUniqueUserProfile(...args) },
    leagueTeam: { findFirst: (...args: unknown[]) => findFirstLeagueTeam(...args) },
  },
}))
vi.mock('@/lib/league-trade-engine/tradeService', () => ({
  listAfLeagueTrades: (...args: unknown[]) => listAfLeagueTrades(...args),
}))
vi.mock('@/server/services/permissionService', () => ({
  isElevatedCommissioner: (...args: unknown[]) => isElevatedCommissioner(...args),
}))

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/league/trades-panel/route'
/* Resolves to the mock above, so the guard reads what the route will actually get. */
import { prisma as mockedPrisma } from '@/lib/prisma'

const ROUTE_PATH = 'app/api/league/trades-panel/route.ts'
const ROUTE_SRC = readFileSync(resolve(process.cwd(), ROUTE_PATH), 'utf8')

/** model -> methods called on it, e.g. tradeDraft -> {findUnique, delete, upsert}. */
function censusPrismaUsage(src: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  // `\s*\.\s*` because the route wraps several of these across lines.
  for (const m of src.matchAll(/prisma\.([a-zA-Z]+)\s*\.\s*([a-zA-Z]+)/g)) {
    const model = m[1]!
    if (!out.has(model)) out.set(model, new Set())
    out.get(model)!.add(m[2]!)
  }
  return out
}

function makeRequest(leagueId: string): NextRequest {
  return new NextRequest(`http://localhost/api/league/trades-panel?leagueId=${leagueId}`)
}

describe('GET /api/league/trades-panel — native league real trade data', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSession.mockResolvedValue({ user: { id: 'user-receiver' } })
    findFirstLeague.mockResolvedValue({ id: 'league-1', platform: 'native', platformLeagueId: null, name: 'Test League' })
    findFirstRoster.mockResolvedValue({ id: 'roster-receiver' })
    isElevatedCommissioner.mockResolvedValue(false)
    /*
     * Defaults chosen to match a native league with a plain viewer: no saved scratchpad,
     * no linked Sleeper account, no claimed provider team. Each returns a resolved null
     * rather than being left undefined, because the route chains `.catch()` onto all
     * three and an undefined return would throw on `.catch` instead.
     */
    findUniqueTradeDraft.mockResolvedValue(null)
    findUniqueUserProfile.mockResolvedValue(null)
    findFirstLeagueTeam.mockResolvedValue(null)
  })

  it('returns real pending AfLeagueTrade rows for a native league, not a hardcoded empty array', async () => {
    listAfLeagueTrades.mockResolvedValue([
      {
        id: 'trade-1',
        status: 'pending',
        proposerRosterId: 'roster-proposer',
        receiverRosterId: 'roster-receiver',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        items: [
          { id: 'item-1', fromRosterId: 'roster-proposer', toRosterId: 'roster-receiver', itemReference: 'p1', metadata: { playerName: 'Player One', position: 'RB' } },
          { id: 'item-2', fromRosterId: 'roster-receiver', toRosterId: 'roster-proposer', itemReference: 'p2', metadata: { playerName: 'Player Two', position: 'WR' } },
        ],
      },
    ])
    findManyRoster.mockResolvedValue([
      { id: 'roster-proposer', platformUserId: 'user-proposer' },
      { id: 'roster-receiver', platformUserId: 'user-receiver' },
    ])
    findManyAppUser.mockResolvedValue([
      { id: 'user-proposer', displayName: 'Proposer FC', username: 'proposer' },
      { id: 'user-receiver', displayName: 'Receiver FC', username: 'receiver' },
    ])

    const res = await GET(makeRequest('league-1'))
    const body = (await res.json()) as { activeTrades: Array<Record<string, unknown>>; activeCount: number; source: string }

    expect(body.source).toBe('native')
    expect(body.activeCount).toBe(1)
    expect(body.activeTrades).toHaveLength(1)
    const trade = body.activeTrades[0]
    expect(trade.id).toBe('trade-1')
    expect(trade.status).toBe('pending')
    expect(trade.direction).toBe('incoming')
    expect(trade.viewerIsReceiver).toBe(true)
    expect(trade.viewerIsProposer).toBe(false)
    expect(trade.partnerName).toBe('Proposer FC')
    expect((trade.received as Array<{ label: string }>)[0].label).toBe('Player One')
    expect((trade.sent as Array<{ label: string }>)[0].label).toBe('Player Two')
  })

  it('regression guard: still returns an empty, well-formed response when there are no active trades', async () => {
    listAfLeagueTrades.mockResolvedValue([])

    const res = await GET(makeRequest('league-1'))
    const body = (await res.json()) as { activeTrades: unknown[]; activeCount: number; source: string }

    expect(body.source).toBe('native')
    expect(body.activeTrades).toEqual([])
    expect(body.activeCount).toBe(0)
  })

  it('excludes terminal-status trades (processed/rejected/cancelled) from the active list', async () => {
    listAfLeagueTrades.mockResolvedValue([
      {
        id: 'trade-done',
        status: 'processed',
        proposerRosterId: 'roster-proposer',
        receiverRosterId: 'roster-receiver',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        items: [],
      },
    ])
    findManyRoster.mockResolvedValue([])
    findManyAppUser.mockResolvedValue([])

    const res = await GET(makeRequest('league-1'))
    const body = (await res.json()) as { activeTrades: unknown[]; activeCount: number }
    expect(body.activeTrades).toEqual([])
    expect(body.activeCount).toBe(0)
  })

  /*
   * ⚠ COVERING THE DEPENDENCY THAT BROKE THE SUITE, not merely silencing it. Adding
   * `tradeDraft` to the mock stops the crash; it does not test that the draft the route
   * reads is the draft it returns. Without these two, the mock is a workaround and the
   * next change to the draft contract goes unnoticed.
   */
  it('passes the saved draft through to the response', async () => {
    listAfLeagueTrades.mockResolvedValue([])
    const updatedAt = new Date('2026-02-02T00:00:00.000Z')
    findUniqueTradeDraft.mockResolvedValue({ payload: { give: ['p1'], get: ['p2'] }, updatedAt })

    const res = await GET(makeRequest('league-1'))
    const body = (await res.json()) as { draft: { payload: { give: string[]; get: string[] } } | null }

    expect(body.draft).not.toBeNull()
    expect(body.draft?.payload).toEqual({ give: ['p1'], get: ['p2'] })
    expect(findUniqueTradeDraft).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_leagueId: { userId: 'user-receiver', leagueId: 'league-1' } } }),
    )
  })

  it('⚠ a null draft is a null field, not a 500 — the table is applied by hand here', async () => {
    /*
     * The route's own comment says a missing table must degrade to null because the
     * migration is applied manually on this project, so the code can land before the
     * column does. That intent is worth a test: it is the difference between the Trade
     * Center falling back to the browser and the whole panel going down over a scratchpad.
     */
    listAfLeagueTrades.mockResolvedValue([])
    findUniqueTradeDraft.mockRejectedValue(new Error('relation "TradeDraft" does not exist'))

    const res = await GET(makeRequest('league-1'))
    const body = (await res.json()) as { draft: unknown; source: string }

    expect(res.status).toBe(200)
    expect(body.draft).toBeNull()
    expect(body.source).toBe('native')
  })
})

/**
 * 🛑 THE GUARD FOR THE CLASS OF BUG, NOT THE INSTANCE.
 *
 * This suite was red for days because the route grew a prisma dependency and the mock
 * did not. Nothing failed until someone ran it, and the error named the route rather
 * than the mock. A census is the cheap check that turns "discovered days later, at the
 * wrong file" into "named on the next run".
 */
describe('🛑 the prisma mock must cover everything the route actually uses', () => {
  it('[control] the census works — a broken regex would pass every test below vacuously', () => {
    /*
     * Without this, a regex that matched nothing would return an empty map, every
     * "missing is empty" assertion below would hold, and the guard would be decorative.
     * Asserts facts the route genuinely contains, so it fails if the file is renamed or
     * the read path breaks.
     */
    const used = censusPrismaUsage(ROUTE_SRC)
    expect(used.size).toBeGreaterThanOrEqual(5)
    expect([...used.keys()]).toContain('league')
    expect(used.get('league')).toContain('findFirst')
    expect(used.get('tradeDraft')).toContain('findUnique')
  })

  it('[control] the census can report a MISSING model — it is not hardcoded to succeed', () => {
    const used = censusPrismaUsage('const x = await prisma.notAModelAnyoneMocked.findUnique({})')
    const mocked = new Set(Object.keys(mockedPrisma as unknown as Record<string, unknown>))
    expect([...used.keys()].filter((m) => !mocked.has(m))).toEqual(['notAModelAnyoneMocked'])
  })

  it('every prisma MODEL the route touches exists on the mock', () => {
    const used = censusPrismaUsage(ROUTE_SRC)
    const mocked = new Set(Object.keys(mockedPrisma as unknown as Record<string, unknown>))
    // Compared as a list so a failure NAMES the missing models rather than saying "false".
    expect([...used.keys()].filter((m) => !mocked.has(m))).toEqual([])
  })

  it('every prisma METHOD the route calls exists on the mock', () => {
    /*
     * One level below the bug that started this. A present model with a missing method
     * fails as `prisma.tradeDraft.upsert is not a function` — equally opaque, and equally
     * pointed at the wrong file.
     */
    const used = censusPrismaUsage(ROUTE_SRC)
    const mock = mockedPrisma as unknown as Record<string, Record<string, unknown> | undefined>
    const missing: string[] = []
    for (const [model, methods] of used) {
      const entry = mock[model]
      if (!entry) continue // owned by the model test above; not reported twice
      for (const method of methods) {
        if (typeof entry[method] !== 'function') missing.push(`${model}.${method}`)
      }
    }
    expect(missing).toEqual([])
  })
})
