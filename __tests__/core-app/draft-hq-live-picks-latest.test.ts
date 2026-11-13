/**
 * @vitest-environment node
 *
 * The cross-league Draft HQ's "Last picks" for a running draft (lib/core-app/warRoomBoard.ts).
 *
 * Two bugs measured on the live board, 2026-11-13:
 *   1. "Picks made 3" over "No picks recorded yet." The loader read EVERY draft a live league has ever
 *      had and wrote the league's tail once per draft, so an older draft could overwrite the live one.
 *   2. One shared `take` across all live drafts, ordered by overall pick, handed the whole cap to the
 *      draft furthest along — a 200-pick draft beside a 3-pick one left the small one empty.
 *
 * The mock database honours `where.leagueId.in`, `where.sessionId`, `orderBy` and `take`, so dropping
 * either fix turns these red.
 */
import { describe, expect, it, vi } from 'vitest'

type Session = { id: string; leagueId: string; createdAt: Date; slotOrder: unknown; teamCount: number; league: { platform: string; sport: string } }
type Pick = {
  sessionId: string; overall: number; round: number; roundPick: number; rosterId: string; displayName: string | null
  playerName: string; position: string; team: string | null; playerImageUrl: string | null; playerId: string | null
}

const league = { platform: 'allfantasy', sport: 'NFL' }
const SESSIONS: Session[] = [
  // Listed oldest first on purpose: the loader must ask for newest first, not trust storage order.
  { id: 's-old', leagueId: 'L1', createdAt: new Date('2025-08-01'), slotOrder: [], teamCount: 10, league },
  { id: 's-new', leagueId: 'L1', createdAt: new Date('2026-08-01'), slotOrder: [{ slot: 1, rosterId: 'r1', displayName: 'Unknown' }], teamCount: 10, league },
  { id: 's-big', leagueId: 'L2', createdAt: new Date('2026-08-02'), slotOrder: [], teamCount: 10, league },
]

const mk = (sessionId: string, overall: number, rosterId = 'r1', displayName: string | null = null): Pick => ({
  sessionId, overall, round: Math.floor((overall - 1) / 10) + 1, roundPick: ((overall - 1) % 10) + 1, rosterId, displayName,
  playerName: `${sessionId} #${overall}`, position: 'WR', team: null, playerImageUrl: null, playerId: null,
})
const PICKS: Pick[] = [
  ...Array.from({ length: 150 }, (_, i) => mk('s-old', i + 1)),
  mk('s-new', 1, 'r1', 'Unknown'), mk('s-new', 2), mk('s-new', 3),
  ...Array.from({ length: 200 }, (_, i) => mk('s-big', i + 1)),
]

type OrderBy = Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>
function ordered<T extends Record<string, unknown>>(rows: T[], orderBy?: OrderBy): T[] {
  if (!orderBy) return rows
  const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o))
  return [...rows].sort((a, b) => {
    for (const [k, dir] of keys) {
      const av = a[k] instanceof Date ? (a[k] as Date).getTime() : (a[k] as number | string)
      const bv = b[k] instanceof Date ? (b[k] as Date).getTime() : (b[k] as number | string)
      if (av === bv) continue
      return (av < bv ? -1 : 1) * (dir === 'desc' ? -1 : 1)
    }
    return 0
  })
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: {
      findMany: vi.fn(async ({ where, orderBy }: { where: { leagueId: { in: string[] } }; orderBy?: OrderBy }) =>
        ordered(SESSIONS.filter((s) => where.leagueId.in.includes(s.leagueId)), orderBy)),
    },
    draftPick: {
      findMany: vi.fn(async ({ where, orderBy, take }: { where: { sessionId: string | { in: string[] } }; orderBy?: OrderBy; take?: number }) => {
        const ids = typeof where.sessionId === 'string' ? [where.sessionId] : where.sessionId.in
        const rows = ordered(PICKS.filter((p) => ids.includes(p.sessionId)), orderBy)
        return take != null ? rows.slice(0, take) : rows
      }),
    },
    leagueTeam: { findMany: vi.fn(async () => []) },
    draftQueueEntry: { findMany: vi.fn(async () => []) },
    draftQueue: { findMany: vi.fn(async () => []) },
    sportsPlayer: { findMany: vi.fn(async () => []) },
  },
}))

import { getLiveDraftPicks } from '@/lib/core-app/warRoomBoard'
import { realManagerName } from '@/lib/core-app/draftHqState'

describe('getLiveDraftPicks — the latest draft per league, each with its own tail', () => {
  it('shows the live draft’s picks, not an older draft in the same league', async () => {
    const out = await getLiveDraftPicks('u1', ['L1', 'L2'])
    const l1 = out.byLeague['L1'] ?? []
    expect(l1.map((p) => p.playerName)).toEqual(['s-new #1', 's-new #2', 's-new #3'])
  })

  it('gives a 3-pick draft its tail even beside a 200-pick draft', async () => {
    const out = await getLiveDraftPicks('u1', ['L1', 'L2'])
    expect(out.byLeague['L1']).toHaveLength(3)
    expect((out.byLeague['L2'] ?? []).map((p) => p.overall)).toEqual([197, 198, 199, 200])
  })

  it('never prints a stored "Unknown" as the manager of a pick', async () => {
    const out = await getLiveDraftPicks('u1', ['L1'])
    expect(out.byLeague['L1']![0]!.managerName).toBeNull()
  })
})

describe('realManagerName', () => {
  it('keeps real names and drops placeholders', () => {
    expect(realManagerName('  Riley ')).toBe('Riley')
    expect(realManagerName('Unknown')).toBeNull()
    expect(realManagerName('unknown')).toBeNull()
    expect(realManagerName('')).toBeNull()
    expect(realManagerName(null)).toBeNull()
    expect(realManagerName('Unknown Soldiers')).toBe('Unknown Soldiers')
  })
})
