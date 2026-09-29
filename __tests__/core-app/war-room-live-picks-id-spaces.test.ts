/**
 * @vitest-environment node
 *
 * 🛑 A live draft pick's headshot, club, position and player-card id come from HIS row.
 *
 * `DraftPick.playerId` is in the league's own id space. Measured on production 2026-09-29: all 6,692
 * Sleeper-league picks are Sleeper ids (none is our row id), and 3,558 of them ALSO match a Rolling
 * Insights / backfill `externalId` row for a different-named player. The board matched every id
 * against `id`, `externalId` AND `sleeperId` and keyed rows under all three, last write winning —
 * so Sleeper 9228 (Bryce Young) could render as RI 9228 (Michael Tarquin, an OT), and the card link
 * could carry the wrong id or none. A native NHL draft holds Rolling Insights ids, which must still
 * resolve; a Fleaflicker draft's ids are its own and resolve to nobody.
 *
 * The mock database honours the query's `where`.
 */
import { describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type Where = Record<string, unknown>

// Tarquin's row LAST on purpose: the old keying let the last row written win.
const SPORTS_PLAYERS: Row[] = [
  { sport: 'NFL', sleeperId: '9228', externalId: 'sleeper:9228', source: 'sleeper', imageUrl: 'bryce.png', team: 'CAR', position: 'QB' },
  { sport: 'NHL', sleeperId: null, externalId: '1086', source: 'rolling_insights', imageUrl: 'dell.png', team: 'NJD', position: 'G' },
  { sport: 'NFL', sleeperId: null, externalId: '9228', source: 'rolling_insights', imageUrl: 'tarquin.png', team: 'MIA', position: 'OT' },
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

const pick = (sessionId: string, playerId: string, playerName: string) => ({
  sessionId,
  overall: 1,
  round: 1,
  roundPick: 1,
  rosterId: 'r1',
  displayName: 'Pat',
  playerName,
  position: '',
  team: null,
  playerImageUrl: null,
  playerId,
})

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: {
      findMany: vi.fn(async () => [
        { id: 's-slp', leagueId: 'L-slp', slotOrder: [], teamCount: 12, league: { platform: 'sleeper', sport: 'NFL' } },
        { id: 's-nhl', leagueId: 'L-nhl', slotOrder: [], teamCount: 4, league: { platform: 'manual', sport: 'NHL' } },
        { id: 's-flea', leagueId: 'L-flea', slotOrder: [], teamCount: 12, league: { platform: 'fleaflicker', sport: 'NFL' } },
      ]),
    },
    draftPick: {
      findMany: vi.fn(async () => [
        pick('s-slp', '9228', 'Bryce Young'),
        pick('s-nhl', '1086', 'Aaron Dell'),
        pick('s-flea', '9228', 'Someone On Fleaflicker'),
      ]),
    },
    leagueTeam: { findMany: vi.fn(async () => []) },
    draftQueueEntry: { findMany: vi.fn(async () => []) },
    draftQueue: { findMany: vi.fn(async () => []) },
    sportsPlayer: { findMany: vi.fn(async ({ where }: { where: Where }) => SPORTS_PLAYERS.filter((r) => matches(r, where))) },
  },
}))

import { getLiveDraftPicks } from '@/lib/core-app/warRoomBoard'

describe('getLiveDraftPicks — each pick resolved in its own league’s id space', () => {
  it('a Sleeper draft’s 9228 is Bryce Young’s row — never Rolling Insights’ Tarquin — and links to his card', async () => {
    const out = await getLiveDraftPicks('u1', ['L-slp', 'L-nhl', 'L-flea'])
    const p = out.byLeague['L-slp']![0]!
    expect(p.imageUrl).toBe('bryce.png')
    expect(p.team).toBe('CAR')
    expect(p.position).toBe('QB')
    expect(p.sleeperId).toBe('9228')
  })

  it('a native NHL draft’s Rolling Insights id still resolves', async () => {
    const out = await getLiveDraftPicks('u1', ['L-slp', 'L-nhl', 'L-flea'])
    expect(out.byLeague['L-nhl']![0]!.imageUrl).toBe('dell.png')
  })

  it('a Fleaflicker draft’s ids resolve to nobody — plain text, no card link', async () => {
    const out = await getLiveDraftPicks('u1', ['L-slp', 'L-nhl', 'L-flea'])
    const p = out.byLeague['L-flea']![0]!
    expect(p.imageUrl).toBeNull()
    expect(p.sleeperId).toBeNull()
  })
})
