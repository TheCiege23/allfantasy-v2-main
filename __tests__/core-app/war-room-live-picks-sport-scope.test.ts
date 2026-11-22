/**
 * @vitest-environment node
 *
 * A Sleeper id is only unique within one sport. A Sleeper NBA draft's pick 9228 is not Bryce Young,
 * so the live-picks board must look each Sleeper draft's ids up in THAT draft's sport — an NBA pick
 * must never borrow an NFL player's headshot, club, position or card id.
 *
 * The mock database honours the query's `where`, including `sport`.
 */
import { describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type Where = Record<string, unknown>

const SPORTS_PLAYERS: Row[] = [
  { sport: 'NFL', sleeperId: '9228', externalId: 'sleeper:9228', source: 'sleeper', imageUrl: 'bryce.png', team: 'CAR', position: 'QB' },
  { sport: 'NBA', sleeperId: '9228', externalId: 'sleeper:9228', source: 'sleeper', imageUrl: 'hoops.png', team: 'BOS', position: 'PG' },
]

function matches(row: Row, where: Where): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(cond as Where[]).some((c) => matches(row, c))) return false
    } else if (cond && typeof cond === 'object') {
      const c = cond as { in?: unknown[]; not?: unknown }
      if (c.in && !c.in.includes(row[key])) return false
      if ('not' in c && row[key] === c.not) return false
    } else if (row[key] !== cond) return false
  }
  return true
}

const pick = (sessionId: string, playerId: string) => ({
  sessionId, overall: 1, round: 1, roundPick: 1, rosterId: 'r1', displayName: 'Pat',
  playerName: 'Someone', position: '', team: null, playerImageUrl: null, playerId,
})

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: {
      findMany: vi.fn(async () => [
        { id: 's-nfl', leagueId: 'L-nfl', slotOrder: [], teamCount: 12, league: { platform: 'sleeper', sport: 'NFL' } },
        { id: 's-nba', leagueId: 'L-nba', slotOrder: [], teamCount: 12, league: { platform: 'sleeper', sport: 'NBA' } },
      ]),
    },
    draftPick: { findMany: vi.fn(async () => [pick('s-nfl', '9228'), pick('s-nba', '9228')]) },
    leagueTeam: { findMany: vi.fn(async () => []) },
    draftQueueEntry: { findMany: vi.fn(async () => []) },
    draftQueue: { findMany: vi.fn(async () => []) },
    sportsPlayer: { findMany: vi.fn(async ({ where }: { where: Where }) => SPORTS_PLAYERS.filter((r) => matches(r, where))) },
  },
}))

import { getLiveDraftPicks } from '@/lib/core-app/warRoomBoard'

describe('getLiveDraftPicks — Sleeper ids are resolved in the draft’s own sport', () => {
  it('the NFL draft’s 9228 is the NFL row and the NBA draft’s 9228 is the NBA row', async () => {
    const out = await getLiveDraftPicks('u1', ['L-nfl', 'L-nba'])
    expect(out.byLeague['L-nfl']![0]).toMatchObject({ imageUrl: 'bryce.png', team: 'CAR', position: 'QB', sleeperId: '9228' })
    expect(out.byLeague['L-nba']![0]).toMatchObject({ imageUrl: 'hoops.png', team: 'BOS', position: 'PG', sleeperId: '9228' })
  })
})
