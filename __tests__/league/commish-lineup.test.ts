/**
 * Commish lineup editor. What matters beyond "the lineup changed":
 *   - the caller sends ids per section, and they must be exactly the team's players, each once — the
 *     older override took raw playerData and could name players the team does not have;
 *   - starters are positional, so a player must fit the slot, and an empty slot may only trail the
 *     last filled one (a hole would slide later starters into the wrong slots on save);
 *   - the write goes through the engine's commish override (which syncs scoring and skips locks);
 *   - commish or co-commish only; imported leagues and chopped teams refuse.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  role: 'co_commissioner' as string | null,
  platform: 'allfantasy',
  chopped: false,
  playerData: {} as Record<string, unknown>,
  forced: [] as Array<Record<string, any>>,
  forceResult: { ok: true } as { ok: true } | { ok: false; error: string; status?: number },
}))

const template = {
  templateId: 't',
  sportType: 'NFL',
  name: 't',
  formatType: 'standard',
  slots: [
    { slotName: 'QB', allowedPositions: ['QB'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 1 },
    { slotName: 'RB', allowedPositions: ['RB'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 2 },
    { slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: true, slotOrder: 3 },
    { slotName: 'BENCH', allowedPositions: ['*'], starterCount: 0, benchCount: 4, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 4 },
    { slotName: 'IR', allowedPositions: ['*'], starterCount: 0, benchCount: 0, reserveCount: 1, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 5 },
  ],
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ platform: h.platform, sport: 'NFL', leagueVariant: null, settings: { currentWeek: 7 }, season: 2026 })) },
    roster: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === 'A' ? { id: 'A', playerData: JSON.parse(JSON.stringify(h.playerData)), redraftRosterId: 'rA' } : null,
      ),
      findMany: vi.fn(async () => [{ id: 'A' }, { id: 'B' }]),
    },
    redraftRosterPlayer: {
      findMany: vi.fn(async () => [
        { playerId: 'qb1', playerName: 'Quinn QB', position: 'QB', team: 'KC' },
        { playerId: 'rb1', playerName: 'Ray RB', position: 'RB', team: 'SF' },
        { playerId: 'wr1', playerName: 'Wade WR', position: 'WR', team: 'DAL' },
        { playerId: 'rb2', playerName: 'Rex RB', position: 'RB', team: 'NYJ' },
      ]),
    },
  },
}))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u-co' } })) }))
vi.mock('@/lib/league/permissions', () => ({
  getLeagueRole: vi.fn(async () => h.role),
  isCommissionerRole: (r: string | null) => r === 'commissioner' || r === 'co_commissioner',
}))
vi.mock('@/lib/scoring-engine/resolveTeamLabels', () => ({ buildRosterLabelMap: vi.fn(async () => new Map([['A', 'Aces'], ['B', 'Bees']])) }))
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({ getRosterTemplateForLeague: vi.fn(async () => template) }))
vi.mock('@/lib/sport-defaults/LeagueVariantRegistry', () => ({ getFormatTypeForVariant: () => 'standard' }))
vi.mock('@/lib/guillotine/guillotineGuard', () => ({ isRosterChopped: vi.fn(async () => h.chopped) }))
vi.mock('@/lib/roster-lineup-engine/commissionerRosterOverride', () => ({
  commissionerForceRosterLineup: vi.fn(async (input: Record<string, unknown>) => {
    h.forced.push(input)
    if (h.forceResult.ok) h.playerData = input.nextPlayerData as Record<string, unknown>
    return h.forceResult
  }),
}))

import { validateCommishLineup } from '@/lib/league/commishLineupEdits'
import { fitsSlot } from '@/lib/league/lineup-expand-template'
import { GET, PUT, parseCommishLineup } from '@/app/api/leagues/[leagueId]/commish-lineup/handler'

const ctx = { params: { leagueId: 'L1' } }
const put = (body: unknown) =>
  PUT(new Request('http://localhost/x', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never, ctx)
const get = (qs = '') => GET(new Request(`http://localhost/x${qs}`) as never, ctx)

beforeEach(() => {
  h.role = 'co_commissioner'
  h.platform = 'allfantasy'
  h.chopped = false
  h.forced = []
  h.forceResult = { ok: true }
  h.playerData = {
    players: ['qb1', 'rb1', 'wr1', 'rb2'],
    starters: ['qb1', 'rb1', 'wr1'],
    lineup_sections: { starters: [{ id: 'qb1', name: 'Quinn QB', position: 'QB' }, 'rb1', 'wr1'], bench: ['rb2'], ir: [], taxi: [], devy: [] },
  }
})

describe('slot eligibility', () => {
  it('a player fits a slot that lists his position, a wildcard, or when his position is unknown', () => {
    expect(fitsSlot({ allowedPositions: ['RB', 'WR'] }, 'WR')).toBe(true)
    expect(fitsSlot({ allowedPositions: ['RB', 'WR'] }, 'QB')).toBe(false)
    expect(fitsSlot({ allowedPositions: ['*'] }, 'K')).toBe(true)
    expect(fitsSlot({ allowedPositions: ['QB'] }, null)).toBe(true)
  })
})

describe('validateCommishLineup', () => {
  const slots = [
    { label: 'QB', allowedPositions: ['QB'] },
    { label: 'RB', allowedPositions: ['RB'] },
    { label: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'] },
  ]
  const pos: Record<string, string> = { qb1: 'QB', rb1: 'RB', wr1: 'WR', rb2: 'RB' }
  const v = (lineup: Record<string, unknown>) =>
    validateCommishLineup({
      lineup: { starters: [], bench: [], ir: [], taxi: [], devy: [], ...lineup } as never,
      rosterIds: ['qb1', 'rb1', 'wr1', 'rb2'],
      slots,
      limits: { starters: 3, bench: 4, ir: 1, taxi: 0, devy: 0 },
      positionOf: (id) => pos[id] ?? null,
      nameOf: (id) => id,
    })

  it('accepts a full, legal lineup and a trailing empty slot', () => {
    expect(v({ starters: ['qb1', 'rb1', 'wr1'], bench: ['rb2'] })).toBeNull()
    expect(v({ starters: ['qb1', 'rb1', ''], bench: ['rb2'], ir: ['wr1'] })).toBeNull()
  })
  it.each([
    [{ starters: ['qb1', '', 'wr1'], bench: ['rb1', 'rb2'] }, /from the top/],
    [{ starters: ['rb1', 'qb1', 'wr1'], bench: ['rb2'] }, /cannot start at QB/],
    [{ starters: ['qb1', 'rb1', 'wr1'], bench: ['rb2', 'rb1'] }, /only one spot/],
    [{ starters: ['qb1', 'rb1', 'wr1'], bench: [] }, /needs a spot/],
    [{ starters: ['qb1', 'rb1', 'wr1'], bench: ['rb2', 'zz9'] }, /not on this team/],
    [{ starters: ['qb1', 'rb1', 'wr1'], taxi: ['rb2'] }, /no TAXI spots/],
    [{ starters: ['qb1', 'rb1', 'wr1', 'rb2'] }, /more starters than/],
  ])('refuses %j', (lineup, msg) => {
    expect(v(lineup)).toMatch(msg)
  })
})

describe('GET', () => {
  it('lists teams without a rosterId', async () => {
    expect((await (await get()).json()).teams).toEqual([{ rosterId: 'A', name: 'Aces' }, { rosterId: 'B', name: 'Bees' }])
  })
  it('returns slots, names from scoring rows, and the current lineup aligned to slots', async () => {
    const body = await (await get('?rosterId=A')).json()
    expect(body.week).toBe(7)
    expect(body.slots.map((s: { label: string }) => s.label)).toEqual(['QB', 'RB', 'FLEX'])
    expect(body.lineup).toEqual({ starters: ['qb1', 'rb1', 'wr1'], bench: ['rb2'], ir: [], taxi: [], devy: [] })
    expect(body.players.find((p: { id: string }) => p.id === 'wr1')).toEqual({ id: 'wr1', name: 'Wade WR', position: 'WR', team: 'DAL' })
  })
  it('a player the sections never mention lands on the bench', async () => {
    h.playerData = { players: ['qb1', 'rb1', 'wr1', 'rb2'], lineup_sections: { starters: ['qb1'], bench: [] } }
    const body = await (await get('?rosterId=A')).json()
    expect(body.lineup.starters).toEqual(['qb1', '', ''])
    expect(body.lineup.bench.sort()).toEqual(['rb1', 'rb2', 'wr1'])
  })
  it('refuses a member', async () => {
    h.role = 'member'
    expect((await get('?rosterId=A')).status).toBe(403)
  })
})

describe('PUT', () => {
  it('rebuilds the lineup server-side and saves it through the commish override', async () => {
    const res = await put({ rosterId: 'A', lineup: { starters: ['qb1', 'rb2', 'rb1'], bench: [], ir: ['wr1'] } })
    expect(res.status).toBe(200)
    expect(h.forced).toHaveLength(1)
    const f = h.forced[0]!
    expect(f).toMatchObject({ leagueId: 'L1', rosterId: 'A', commissionerUserId: 'u-co', week: 7, season: 2026 })
    expect(f.nextPlayerData.starters).toEqual(['qb1', 'rb2', 'rb1'])
    expect(f.nextPlayerData.reserve).toEqual(['wr1'])
    expect(f.nextPlayerData.lineup_sections.starters[0]).toMatchObject({ id: 'qb1', name: 'Quinn QB', position: 'QB', team: 'KC' })
    const body = await res.json()
    expect(body.lineup.ir).toEqual(['wr1'])
  })

  it.each([
    [{ starters: ['qb1', 'rb1', 'wr1'], bench: ['rb2', 'stranger'] }, 'a player from another team'],
    [{ starters: ['wr1', 'rb1', 'qb1'], bench: ['rb2'] }, 'an ineligible starter'],
    [{ starters: ['qb1', '', 'wr1'], bench: ['rb1', 'rb2'] }, 'a hole in the starters'],
  ])('refuses %j (%s) and writes nothing', async (lineup) => {
    expect((await put({ rosterId: 'A', lineup })).status).toBe(400)
    expect(h.forced).toEqual([])
  })

  it('imported leagues, chopped teams and members are refused', async () => {
    const ok = { rosterId: 'A', lineup: { starters: ['qb1', 'rb1', 'wr1'], bench: ['rb2'] } }
    h.platform = 'sleeper'
    expect((await put(ok)).status).toBe(409)
    h.platform = 'allfantasy'
    h.chopped = true
    expect((await put(ok)).status).toBe(409)
    h.chopped = false
    h.role = 'member'
    expect((await put(ok)).status).toBe(403)
    expect(h.forced).toEqual([])
  })

  it('passes the engine’s own refusal through', async () => {
    h.forceResult = { ok: false, error: 'BENCH has 5 players, max 4.', status: 400 }
    const res = await put({ rosterId: 'A', lineup: { starters: ['qb1', 'rb1', 'wr1'], bench: ['rb2'] } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/BENCH/)
  })

  it('parses only a well-formed body', () => {
    expect(parseCommishLineup({ rosterId: 'A', lineup: { starters: ['qb1', null], bench: [' rb2 ', ''] } })).toEqual({
      rosterId: 'A',
      lineup: { starters: ['qb1', ''], bench: ['rb2'], ir: [], taxi: [], devy: [] },
    })
    expect(parseCommishLineup({ rosterId: 'A', lineup: { bench: [] } })).toBeNull()
    expect(parseCommishLineup({ lineup: { starters: [] } })).toBeNull()
  })
})
