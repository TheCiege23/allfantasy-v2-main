import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(async () => ({})),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: h.findUnique, update: h.update } } }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'commish' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/commissioner/CommissionerChangeNotifier', () => ({ notifyCommissionerChange: vi.fn(async () => undefined) }))

import { PUT } from '@/app/api/commissioner/leagues/[leagueId]/division-settings/route'

const teams = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, teamName: `T${i + 1}`, ownerName: null, avatarUrl: null, lifecycleState: 'ACTIVE' }))

function league(n: number, extra: Record<string, unknown> = {}) {
  return { userId: 'commish', settings: {}, leagueVariant: null, teams: teams(n), ...extra }
}

async function put(body: Record<string, unknown>) {
  const res = await PUT(
    new Request('http://x/api', { method: 'PUT', body: JSON.stringify(body) }) as never,
    { params: Promise.resolve({ leagueId: 'lg' }) },
  )
  return { status: res.status, json: (await res.json()) as Record<string, any> }
}

const split = (n: number, pattern: number[]) => Object.fromEntries(pattern.map((d, i) => [`t${i + 1}`, d]).slice(0, n))

describe('PUT division-settings', () => {
  beforeEach(() => {
    h.findUnique.mockReset()
    h.update.mockClear()
  })

  it('saves an even split with the playoff rule into settings.division_config', async () => {
    h.findUnique.mockResolvedValue(league(6))
    const { status, json } = await put({ count: 2, names: ['East', 'West'], teamAssignments: split(6, [0, 0, 0, 1, 1, 1]), playoffRule: 'guaranteed' })
    expect(status).toBe(200)
    expect(json.config).toMatchObject({ count: 2, names: ['East', 'West'], playoffRule: 'guaranteed' })
    const written = (h.update.mock.calls[0] as unknown as [{ data: { settings: Record<string, any> } }])[0].data.settings
    expect(written.division_config.teamAssignments).toEqual(split(6, [0, 0, 0, 1, 1, 1]))
    expect(written.num_divisions).toBe(2)
  })

  it('refuses an uneven split and writes nothing', async () => {
    h.findUnique.mockResolvedValue(league(6))
    const { status, json } = await put({ count: 2, names: ['East', 'West'], teamAssignments: split(6, [0, 0, 0, 0, 1, 1]) })
    expect(status).toBe(400)
    expect(json.code).toBe('UNEVEN')
    expect(h.update).not.toHaveBeenCalled()
  })

  it('refuses more divisions than the league can fill, and counts outside 2–4', async () => {
    h.findUnique.mockResolvedValue(league(5))
    expect((await put({ count: 3, names: ['A', 'B', 'C'] })).json.code).toBe('TOO_FEW_TEAMS')
    expect((await put({ count: 8 })).json.code).toBe('COUNT_NOT_ALLOWED')
    expect((await put({ count: 2, playoffRule: 'byes' })).json.code).toBe('BAD_PLAYOFF_RULE')
    expect(h.update).not.toHaveBeenCalled()
  })

  it('keeps 8 tribes for a Survivor league', async () => {
    h.findUnique.mockResolvedValue(league(16, { leagueVariant: 'survivor' }))
    const { status, json } = await put({ count: 8 })
    expect(status).toBe(200)
    expect(json.config.count).toBe(8)
  })

  it('drops a departed team from the assignments instead of refusing', async () => {
    h.findUnique.mockResolvedValue({
      ...league(4),
      teams: [...teams(4), { id: 'gone', teamName: 'Gone', ownerName: null, avatarUrl: null, lifecycleState: 'ARCHIVED' }],
    })
    const { status, json } = await put({ count: 2, names: ['East', 'West'], teamAssignments: { ...split(4, [0, 0, 1, 1]), gone: 1 } })
    expect(status).toBe(200)
    expect(json.config.teamAssignments).toEqual(split(4, [0, 0, 1, 1]))
  })
})
