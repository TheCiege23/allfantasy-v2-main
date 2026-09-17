/**
 * @vitest-environment node
 *
 * An orphan roster's owner key is a placeholder (`orphan-<provider>-<teamId>` for imports, or
 * `orphan-<uuid>` for native open slots). The best-ball and guillotine War Rooms fell back to showing
 * that key as the owner's name; they now fall back to "Team", as they do for a roster with no key.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ league: null as unknown }))

vi.mock('@/lib/prisma', () => {
  // Every read the builders make besides the league itself comes back empty.
  const model = new Proxy(
    {},
    {
      get: (_t, method: string) => async () => (method === 'findMany' ? [] : method === 'findUnique' ? state.league : null),
    },
  )
  return { prisma: new Proxy({}, { get: () => model }) }
})
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn(async () => ({ isMember: true, isCommissioner: false })) }))
vi.mock('@/lib/league/getEffectiveLeagueRosterTemplate', () => ({
  getEffectiveLeagueRosterTemplate: vi.fn(async () => ({ template: { slots: [] } })),
}))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({ getGuillotineConfig: vi.fn(async () => null) }))
vi.mock('@/lib/guillotine/GuillotineDangerEngine', () => ({ getDangerTiers: vi.fn(async () => []) }))
vi.mock('@/lib/redraft-war-room/redraftFreeAgentPool', () => ({ fetchAdpByPlayerKey: vi.fn(async () => new Map()) }))
vi.mock('@/lib/redraft-war-room/redraftInjuryNews', () => ({
  fetchRedraftInjuryNews: vi.fn(async () => ({ injuryByName: new Map(), newsCount: 0, injuriesAsOf: null })),
  injuryNameKey: (n: string) => String(n ?? '').trim().toLowerCase(),
}))

import { buildBestBallWarRoomContext } from '@/lib/best-ball-war-room/bestBallWarRoomContext'
import { buildGuillotineWarRoomContext } from '@/lib/guillotine-war-room/guillotineWarRoomContext'

const rosters = [
  { id: 'r-orphan', platformUserId: 'orphan-sleeper-3', playerData: { players: [] }, faabRemaining: null },
  { id: 'r-native-orphan', platformUserId: 'orphan-2f1c', playerData: { players: [] }, faabRemaining: null },
  // [control] a manager with no team row still shows the id it has.
  { id: 'r-unlinked', platformUserId: 'sleeper-77', playerData: { players: [] }, faabRemaining: null },
  // [control] a manager with a team row shows the team's owner name.
  { id: 'r-owned', platformUserId: 'sleeper-1', playerData: { players: [] }, faabRemaining: null },
]
const teams = [{ teamName: 'Alpha', ownerName: 'Alice', platformUserId: 'sleeper-1' }]

function names(ctx: { teams: Array<{ rosterId: string; ownerName: string }> }) {
  return Object.fromEntries(ctx.teams.map((t) => [t.rosterId, t.ownerName]))
}
const expected = { 'r-orphan': 'Team', 'r-native-orphan': 'Team', 'r-unlinked': 'sleeper-77', 'r-owned': 'Alice' }

beforeEach(() => {
  state.league = null
})

describe('an orphan roster is not named after its placeholder key', () => {
  it('best ball', async () => {
    state.league = { sport: 'NFL', season: 2026, leagueSize: 4, bestBallMode: true, settings: {}, rosters, teams }
    const res = await buildBestBallWarRoomContext({ leagueId: 'L', userId: 'u' })
    if (!res.ok) throw new Error(res.error)
    expect(names(res.context)).toEqual(expected)
  })

  it('guillotine', async () => {
    state.league = { sport: 'NFL', season: 2026, guillotineMode: true, leagueVariant: 'guillotine', settings: {}, rosters, teams }
    const res = await buildGuillotineWarRoomContext({ leagueId: 'L', userId: 'u' })
    if (!res.ok) throw new Error(res.error)
    expect(names(res.context)).toEqual(expected)
  })
})
