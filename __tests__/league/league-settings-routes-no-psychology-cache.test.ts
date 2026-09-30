// @vitest-environment node
/**
 * Milestone 32: `League.settings.psychologyCache` (+ `psychologyCachedAt`) holds manager
 * characterisation labels written by the retired power-rankings "psychology" job. Every route that
 * hands `League.settings` to a client strips them on the way out.
 *
 * Each case drives the REAL route with a league whose stored settings still carry the labels, and
 * checks two things: the response carries the league's ordinary settings (positive control — an
 * empty response cannot pass) and not the labels. Where the route also WRITES settings back, the
 * write is checked to still carry the stored keys: this is a read-side strip, and changing stored
 * production data is the owner's decision, not a side effect of a PATCH.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const LABELS = {
  psychologyCache: { '3': { archetype: 'Shark', blindSpot: 'Overpays for RBs' } },
  psychologyCachedAt: '2026-09-01T00:00:00.000Z',
}
const STORED = { lineupLockRule: 'game', description: 'Home league', ...LABELS }
const LEAKED = /psychologyCache|psychologyCachedAt|Shark|Overpays/

const db = vi.hoisted(() => ({
  answers: {} as Record<string, (args: any) => unknown>,
  calls: [] as Array<{ key: string; args: any }>,
}))

vi.mock('@/lib/prisma', () => {
  const fallback = (method: string) => (method === 'count' ? 0 : method === 'findMany' || method === 'groupBy' ? [] : null)
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) =>
          vi.fn(async (args: unknown) => {
            db.calls.push({ key: `${name}.${method}`, args })
            const answer = db.answers[`${name}.${method}`]
            return answer ? answer(args) : fallback(method)
          }),
      },
    )
  const prisma = new Proxy({}, { get: (_t, key: string) => (key === 'then' ? undefined : model(key)) })
  return { prisma, default: prisma }
})

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: vi.fn(async () => undefined) }))
vi.mock('@/lib/league/permissions', () => ({
  requireCommissionerRole: vi.fn(async () => undefined),
  getLeagueRole: vi.fn(async () => 'member'),
}))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/sleeper-client', () => ({ getLeagueDrafts: vi.fn(async () => []) }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    resolveForUser() {
      return Promise.resolve({ hasAccess: false })
    }
  },
}))
vi.mock('@/lib/scoring-defaults/LeagueScoringConfigResolver', () => ({
  getLeagueScoringConfig: vi.fn(async () => null),
}))

import { GET as leagueDetail } from '@/app/api/league/detail/route'
import { GET as leagueSettings } from '@/app/api/league/settings/route'
import { POST as operations } from '@/app/api/commissioner/leagues/[leagueId]/operations/route'
import { PATCH as commissionerPatch } from '@/app/api/commissioner/leagues/[leagueId]/route'
import { POST as commissionerLineup } from '@/app/api/commissioner/leagues/[leagueId]/lineup/route'
import { PATCH as bestBallSettings } from '@/app/api/bestball/settings/route'

function req(url: string, init?: { method?: string; body?: unknown }) {
  return new NextRequest(url, {
    method: init?.method ?? 'GET',
    headers: { 'content-type': 'application/json' },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
}

const leagueRow = {
  id: 'L1',
  userId: 'u1',
  name: 'League One',
  sport: 'NFL',
  platform: 'allfantasy',
  platformLeagueId: null,
  leagueVariant: null,
  isDynasty: false,
  scoring: 'PPR',
  leagueSize: 12,
  season: 2026,
  rosterSize: 16,
  bestBallMode: true,
  bbContestId: null,
  bbWaiversEnabled: false,
  bbTradesEnabled: false,
  bbFaEnabled: false,
  bbIrEnabled: false,
  bbTaxiEnabled: false,
  timezone: null,
  settings: STORED,
  teams: [{ id: 't1', externalId: '1', claimedByUserId: 'u1', role: 'member' }],
  invites: [],
  leagueSettings: null,
}

/** An update answers with the row as written, like Prisma does. */
const echoUpdate = (args: any) => ({ ...leagueRow, ...args.data, id: 'L1', updatedAt: new Date(0) })

beforeEach(() => {
  db.calls = []
  db.answers = {
    'league.findFirst': () => leagueRow,
    'league.findUnique': () => leagueRow,
    'league.update': echoUpdate,
  }
})

async function body(res: Response) {
  return (await res.json()) as Record<string, any>
}

describe('member-facing reads', () => {
  it('GET /api/league/detail', async () => {
    const out = await body(await leagueDetail(req('http://localhost/api/league/detail?leagueId=L1')))
    expect(out.settings).toMatchObject({ lineupLockRule: 'game', description: 'Home league' })
    expect(JSON.stringify(out)).not.toMatch(LEAKED)
  })

  it('GET /api/league/settings (settingsSnapshot)', async () => {
    const out = await body(await leagueSettings(req('http://localhost/api/league/settings?leagueId=L1')))
    expect(out.settingsSnapshot).toMatchObject({ lineupLockRule: 'game', description: 'Home league' })
    expect(JSON.stringify(out)).not.toMatch(LEAKED)
  })
})

describe('commissioner writes that echo settings back', () => {
  it('POST /api/commissioner/leagues/[id]/operations', async () => {
    const res = await operations(
      req('http://localhost/api/commissioner/leagues/L1/operations', {
        method: 'POST',
        body: { action: 'set_orphan_seeking', value: true },
      }),
      { params: { leagueId: 'L1' } },
    )
    const out = await body(res)
    expect(out.settings).toMatchObject({ lineupLockRule: 'game', orphanSeeking: true })
    expect(JSON.stringify(out)).not.toMatch(LEAKED)
    // Stored data is not the response's business: the write keeps what was there.
    const write = db.calls.find((c) => c.key === 'league.update')!
    expect(write.args.data.settings).toHaveProperty('psychologyCache')
  })

  it('PATCH /api/commissioner/leagues/[id]', async () => {
    const res = await commissionerPatch(
      req('http://localhost/api/commissioner/leagues/L1', { method: 'PATCH', body: { description: 'New' } }),
      { params: { leagueId: 'L1' } },
    )
    const out = await body(res)
    expect(out.settings).toMatchObject({ description: 'New', lineupLockRule: 'game' })
    expect(JSON.stringify(out)).not.toMatch(LEAKED)
    const write = db.calls.find((c) => c.key === 'league.update')!
    expect(write.args.data.settings).toHaveProperty('psychologyCache')
  })

  it('POST /api/commissioner/leagues/[id]/lineup', async () => {
    const res = await commissionerLineup(
      req('http://localhost/api/commissioner/leagues/L1/lineup', { method: 'POST', body: { lineupLockRule: 'week' } }),
      { params: { leagueId: 'L1' } },
    )
    const out = await body(res)
    expect(out.settings).toMatchObject({ lineupLockRule: 'week', description: 'Home league' })
    expect(JSON.stringify(out)).not.toMatch(LEAKED)
    const write = db.calls.find((c) => c.key === 'league.update')!
    expect(write.args.data.settings).toHaveProperty('psychologyCache')
  })

  it('PATCH /api/bestball/settings', async () => {
    const res = await bestBallSettings(
      req('http://localhost/api/bestball/settings', { method: 'PATCH', body: { leagueId: 'L1', bbWaiversEnabled: true } }),
    )
    const out = await body(res)
    expect(res.status).toBe(200)
    expect(out.league.settings).toMatchObject({ lineupLockRule: 'game' })
    expect(JSON.stringify(out)).not.toMatch(LEAKED)
  })
})
