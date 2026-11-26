// @vitest-environment node
/** Which teams Chimmy may act for in the league trade engine, and as whom. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  playable: {} as Record<string, unknown>,
  rosters: [] as Array<{ id: string; platformUserId: string | null }>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ id: 'L', userId: 'owner', settings: m.settings })) },
    roster: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => m.rosters.filter((r) => where.id.in.includes(r.id))) },
  },
}))
vi.mock('@/lib/inactive-manager/chimmyPlayable', () => ({ readPlayableChimmyLineups: vi.fn(async () => m.playable) }))

import { chimmyRunTeams, chimmyTradeTeams, resolveChimmyActor } from '@/lib/league-trade-engine/chimmyActor'

const ap = (extra: Record<string, unknown> = {}) => ({ style: 'win_now', since: 's', byUserId: 'commish', ...extra })
const entry = (owner: string | null, autopilot: Record<string, unknown> | null) => ({ since: 's', byUserId: 'commish', ownerUserId: owner, ...(autopilot ? { autopilot } : {}) })

beforeEach(() => {
  m.settings = {
    af_managed_lineups: {
      answers: entry('orphan-1', ap()),
      sends: entry('orphan-2', ap({ trades: 'answer_and_send' })),
      off: entry('orphan-3', ap({ trades: 'off' })),
      lapsed: entry('orphan-4', ap()),
      handedOn: entry('old-owner', ap()),
      lineupsOnly: entry('u9', null),
    },
  }
  // The plan lapsed for `lapsed`: it is still switched on but Chimmy does not play it.
  const managed = m.settings.af_managed_lineups as Record<string, Record<string, unknown>>
  m.playable = Object.fromEntries(Object.entries(managed).map(([id, e]) => [id, id === 'lapsed' ? { since: e.since, byUserId: e.byUserId, ownerUserId: e.ownerUserId } : e]))
  m.rosters = [
    { id: 'answers', platformUserId: 'orphan-1' }, { id: 'sends', platformUserId: 'orphan-2' }, { id: 'off', platformUserId: 'orphan-3' },
    { id: 'lapsed', platformUserId: 'orphan-4' }, { id: 'handedOn', platformUserId: 'new-owner' }, { id: 'lineupsOnly', platformUserId: 'u9' },
  ]
})

describe('chimmyTradeTeams', () => {
  it('is every team Chimmy plays and takes offers for, answered by the commissioner who handed it over', async () => {
    const teams = await chimmyTradeTeams('L')
    expect([...teams.keys()].sort()).toEqual(['answers', 'sends'])
    expect(teams.get('answers')).toEqual({ rosterId: 'answers', actorUserId: 'commish', trades: 'answer' })
    expect(teams.get('sends')!.trades).toBe('answer_and_send')
  })
})

describe('chimmyRunTeams', () => {
  it('names every team Chimmy runs for its current owner, and says which take no offers', async () => {
    const teams = await chimmyRunTeams('L')
    expect(Object.fromEntries(teams)).toEqual({ answers: 'answer', sends: 'answer_and_send', off: 'off', lapsed: 'off' })
  })
})

describe('resolveChimmyActor', () => {
  it('says yes only for a team Chimmy runs AND the commissioner who handed it over', async () => {
    expect(await resolveChimmyActor('L', 'answers', 'commish')).toMatchObject({ rosterId: 'answers' })
    expect(await resolveChimmyActor('L', 'answers', 'someone-else')).toBeNull()
    for (const id of ['off', 'lapsed', 'handedOn', 'lineupsOnly', 'nope']) expect(await resolveChimmyActor('L', id, 'commish')).toBeNull()
  })
})
