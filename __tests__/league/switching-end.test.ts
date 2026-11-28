/**
 * Step 5 of a switching league: the switching period ends, by the head commissioner's "Everyone's here" or by itself
 * when the last team switches. From then on every team counts as switched, so the old platform's copy leaves every
 * team alone. lib/league/switching/endSwitching.ts, switchingLeague.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = { settings: {} as Record<string, unknown> }
  const db = {
    league: {
      findUnique: vi.fn(async () => ({ settings: state.settings, userId: 'commish', platform: 'sleeper' })),
      update: vi.fn(async ({ data }: { data: { settings: Record<string, unknown> } }) => {
        state.settings = data.settings
        return {}
      }),
    },
    leagueTeam: {
      findMany: vi.fn(async () => [
        { id: 'team-1', teamName: 'Ghosts', ownerName: 'A', externalId: '1' },
        { id: 'team-2', teamName: 'Owls', ownerName: 'B', externalId: '2' },
        { id: 'team-3', teamName: 'Tanks', ownerName: null, externalId: '3' },
      ]),
      findFirst: vi.fn(),
    },
    roster: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  }
  db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db))
  return { state, db, dispatch: vi.fn(async () => ({})), resolveActingRoster: vi.fn() }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/league/viewerTeams', () => ({ resolveActingRoster: h.resolveActingRoster }))

import { endSwitchingPeriod } from '@/lib/league/switching/endSwitching'
import { switchTeamToAllFantasy } from '@/lib/league/switching/switchTeam'
import { hasTeamSwitched, isSwitchingEnded, teamsRunOnAllFantasy } from '@/lib/league/switching/switchingLeague'

const stamp = (by: string) => ({ at: '2026-11-20T00:00:00.000Z', byUserId: by })
const now = new Date('2026-11-28T12:00:00.000Z')
const teams = [{ id: 'team-1', externalId: '1' }, { id: 'team-2', externalId: '2' }, { id: 'team-3', externalId: '3' }]

beforeEach(() => {
  vi.clearAllMocks()
  h.state.settings = { switching: { official: stamp('commish'), teams: { 'team-1': stamp('commish') } } }
})

describe("Everyone's here", () => {
  it('ends the switching period, records who had not switched, and tells the commissioner', async () => {
    const out = await endSwitchingPeriod({ leagueId: 'L1', userId: 'commish', now })

    expect(out).toEqual({
      ok: true, alreadyEnded: false,
      leftBehind: [{ teamId: 'team-2', name: 'Owls', manager: 'B' }, { teamId: 'team-3', name: 'Tanks', manager: null }],
    })
    expect(isSwitchingEnded(h.state.settings)).toBe(true)
    // Every team now counts as switched, so the copy from the platform leaves them all alone.
    expect(hasTeamSwitched(h.state.settings, 'team-2')).toBe(true)
    expect([...teamsRunOnAllFantasy(h.state.settings, teams)]).toEqual(['1', '2', '3'])
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      userIds: ['commish'], type: 'switching_ended', dedupePrefix: 'switching_ended:L1',
      body: expect.stringContaining('Owls (B), Tanks'),
    }))
  })

  it('does nothing the second time', async () => {
    await endSwitchingPeriod({ leagueId: 'L1', userId: 'commish', now })
    h.db.league.update.mockClear()
    h.dispatch.mockClear()
    expect(await endSwitchingPeriod({ leagueId: 'L1', userId: 'commish', now })).toMatchObject({ ok: true, alreadyEnded: true })
    expect(h.db.league.update).not.toHaveBeenCalled()
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('is refused before the league is official', async () => {
    h.state.settings = { switching: { official: null, teams: {} } }
    expect(await endSwitchingPeriod({ leagueId: 'L1', userId: 'commish', now })).toMatchObject({ ok: false, status: 409 })
    expect(h.db.league.update).not.toHaveBeenCalled()
  })

  it('[control] before it ends, only switched teams are run here', () => {
    expect(hasTeamSwitched(h.state.settings, 'team-2')).toBe(false)
    expect([...teamsRunOnAllFantasy(h.state.settings, teams)]).toEqual(['1'])
  })
})

describe('the last team to switch ends it', () => {
  const switchTeam = async (rosterId: string, externalId: string, teamId: string, user: string) => {
    h.resolveActingRoster.mockResolvedValue({ ok: true, rosterId, redraftRosterId: null, heldCount: 1, viaCoOwner: false })
    h.db.roster.findFirst.mockResolvedValue({ playerData: { source_team_id: externalId } })
    h.db.leagueTeam.findFirst.mockResolvedValue({ id: teamId, teamName: teamId })
    return switchTeamToAllFantasy({ leagueId: 'L1', userId: user, now })
  }

  it('ends when the last one switches, with nobody left behind', async () => {
    expect(await switchTeam('r2', '2', 'team-2', 'mgr-2')).toMatchObject({ ok: true, switchingEnded: false })
    expect(isSwitchingEnded(h.state.settings)).toBe(false)

    expect(await switchTeam('r3', '3', 'team-3', 'mgr-3')).toMatchObject({ ok: true, switchingEnded: true })
    expect(isSwitchingEnded(h.state.settings)).toBe(true)
    expect((h.state.settings.switching as { leftBehind: unknown[] }).leftBehind).toEqual([])
    expect(h.dispatch).toHaveBeenCalledTimes(1)
  })

  it('[control] not while the league is not official: everyone switching early is still practice', async () => {
    h.state.settings = { switching: { official: null, teams: { 'team-1': stamp('a'), 'team-2': stamp('b') } } }
    expect(await switchTeam('r3', '3', 'team-3', 'mgr-3')).toMatchObject({ ok: true, switchingEnded: false })
    expect(isSwitchingEnded(h.state.settings)).toBe(false)
  })
})
