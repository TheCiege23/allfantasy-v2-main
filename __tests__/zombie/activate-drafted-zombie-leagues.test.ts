import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  zombieFindMany: vi.fn(),
  draftFindFirst: vi.fn(),
  seasonFindFirst: vi.fn(),
  activate: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    zombieLeague: { findMany: m.zombieFindMany },
    draftSession: { findFirst: m.draftFindFirst },
    redraftSeason: { findFirst: m.seasonFindFirst },
  },
}))
vi.mock('@/lib/zombie/activateNativeZombieLeague', () => ({ ensureZombieSeasonActivated: m.activate }))

import { activateDraftedZombieLeagues } from '@/lib/zombie/activateDraftedZombieLeagues'

/*
 * 🛑 Zombie Chimmy Test, 2026-11-22: activation failed once after its draft, the fix deployed, and the
 * league still sat in `setup`, because activation only re-ran when someone opened the league.
 */
describe('activateDraftedZombieLeagues (score-sync tick)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.seasonFindFirst.mockResolvedValue({ id: 'season-1' })
    m.activate.mockResolvedValue({ ok: true, activated: true, whispererPicked: false, zombieLeagueId: 'z' })
  })

  it('only looks at leagues still in setup or registering', async () => {
    m.zombieFindMany.mockResolvedValue([])
    await activateDraftedZombieLeagues()
    expect(m.zombieFindMany.mock.calls[0][0]).toMatchObject({ where: { status: { in: ['setup', 'registering'] } } })
  })

  it('activates a league whose draft is complete, on its latest redraft season', async () => {
    m.zombieFindMany.mockResolvedValue([{ leagueId: 'L1' }])
    m.draftFindFirst.mockResolvedValue({ status: 'completed' })

    const out = await activateDraftedZombieLeagues()

    expect(m.activate).toHaveBeenCalledWith({ leagueId: 'L1', redraftSeasonId: 'season-1' })
    expect(out).toEqual({ checked: 1, activated: 1, failures: [] })
  })

  it('[control] leaves a league that is still drafting, or has no draft, alone', async () => {
    m.zombieFindMany.mockResolvedValue([{ leagueId: 'drafting' }, { leagueId: 'none' }])
    m.draftFindFirst.mockImplementation(async (args: any) =>
      args.where.leagueId === 'drafting' ? { status: 'in_progress' } : null)

    const out = await activateDraftedZombieLeagues()

    expect(m.activate).not.toHaveBeenCalled()
    expect(out.checked).toBe(0)
  })

  it('reports one league refusing without stopping the next', async () => {
    m.zombieFindMany.mockResolvedValue([{ leagueId: 'bad' }, { leagueId: 'good' }])
    m.draftFindFirst.mockResolvedValue({ status: 'completed' })
    m.activate.mockImplementation(async ({ leagueId }: { leagueId: string }) => {
      if (leagueId === 'bad') throw new Error('Fill every seat with a manager, or hand it to Chimmy, before the Whisperer draw.')
      return { ok: true, activated: true, whispererPicked: false, zombieLeagueId: 'z' }
    })

    const out = await activateDraftedZombieLeagues()

    expect(out.activated).toBe(1)
    expect(out.failures).toEqual([{ leagueId: 'bad', error: expect.stringContaining('Fill every seat') }])
  })
})
