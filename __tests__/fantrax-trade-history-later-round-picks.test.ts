// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Later-round pick ownership from the Fantrax trade-history export.
 *
 * Fantrax's API publishes future picks for rounds 1-4 only (measured on a 34-team dynasty league:
 * 1,360 rows, none past round 4, while its trade history showed a 2029 Round 5 pick moving). The
 * export is the only place a later-round pick trade is visible, so the upload also places those.
 */
const m = vi.hoisted(() => ({
  snapshot: null as Record<string, unknown> | null,
  traded: [] as Array<{ leagueId: string; picks: unknown[] }>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ platform: 'fantrax', platformLeagueId: 'fx-league', sport: 'NFL', season: 2026 })) },
    leagueTeam: {
      findMany: vi.fn(async () => [
        { externalId: '101', teamName: 'Harbor Owls', platformUserId: 'fantrax-user:owl' },
        { externalId: '202', teamName: 'Mesa Comets', platformUserId: 'fantrax-manager:mesa-comets' },
      ]),
    },
    playerIdentityMap: {
      findMany: vi.fn(async () => [{ fantraxId: 'fx-qb1', canonicalName: 'Quarterback One', currentTeam: 'PHI', position: 'QB' }]),
    },
    fantraxLeague: { findFirst: vi.fn(async () => m.snapshot) },
  },
}))
vi.mock('@/lib/dynasty-import/normalize-historical', () => ({
  persistTradesForSeason: vi.fn(async (_id: string, _season: number, facts: unknown[]) => facts.length * 2),
}))
vi.mock('@/lib/league-import/ImportedLeagueCommitService', () => ({
  persistTradedPicks: vi.fn(async (leagueId: string, picks: unknown[]) => {
    m.traded.push({ leagueId, picks })
    return { written: picks.length, skipped: 0 }
  }),
}))

import { laterRoundPickOwnership } from '@/lib/league-import/fantrax/fantraxTradeHistoryPicks'
import { importFantraxTradeHistory } from '@/lib/league-import/fantrax/importFantraxTradeHistory'

const pick = (season: number, round: number, original: string, from: string, to: string) =>
  ({ season: String(season), round, rosterId: original, previousOwnerId: from, ownerId: to })

describe('who holds a later-round pick', () => {
  const none = new Set<string>()

  it('follows a pick through two trades to its last holder, whatever order the trades arrive in', () => {
    const facts = [
      { created: 2000, draftPicks: [pick(2029, 5, 'A', 'B', 'C')] },
      { created: 1000, draftPicks: [pick(2029, 5, 'A', 'A', 'B')] },
    ]
    const want = { traded: [{ season: 2029, round: 5, original_roster_id: 'A', current_owner_roster_id: 'C' }], returned: [] }
    expect(laterRoundPickOwnership({ facts, publishedRounds: none, afterSeason: 2026 })).toEqual(want)
    expect(laterRoundPickOwnership({ facts: [...facts].reverse(), publishedRounds: none, afterSeason: 2026 })).toEqual(want)
  })

  it('reports a pick traded back to its original team as returned', () => {
    const out = laterRoundPickOwnership({
      facts: [
        { created: 1000, draftPicks: [pick(2029, 5, 'A', 'A', 'B')] },
        { created: 2000, draftPicks: [pick(2029, 5, 'A', 'B', 'A')] },
      ],
      publishedRounds: none,
      afterSeason: 2026,
    })
    expect(out).toEqual({ traded: [], returned: [{ season: 2029, round: 5, original_roster_id: 'A' }] })
  })

  /** The API is current and an export is a point in time, so the API wins where it lists a pick. */
  it('leaves alone any season and round the API publishes', () => {
    const out = laterRoundPickOwnership({
      facts: [{ created: 1000, draftPicks: [pick(2027, 2, 'A', 'A', 'B'), pick(2029, 5, 'A', 'A', 'B')] }],
      publishedRounds: new Set(['2027:2']),
      afterSeason: 2026,
    })
    expect(out.traded).toEqual([{ season: 2029, round: 5, original_roster_id: 'A', current_owner_roster_id: 'B' }])
  })

  it('skips a pick for a draft already held', () => {
    const out = laterRoundPickOwnership({
      facts: [{ created: 1000, draftPicks: [pick(2026, 6, 'A', 'A', 'B'), pick(2025, 6, 'A', 'A', 'B')] }],
      publishedRounds: none,
      afterSeason: 2026,
    })
    expect(out).toEqual({ traded: [], returned: [] })
  })
})

const CSV = [
  '"Player","Team","Position","From","To","# Obj","Date (EST)","Week"',
  '"2029 Draft Pick, Round 5 (Mesa Comets)","","","Mesa Comets","Harbor Owls","0","Mon Nov 16, 2026, 4:26PM","11"',
  '"2027 Draft Pick, Round 2 (Mesa Comets)","","","Mesa Comets","Harbor Owls","0","Mon Nov 16, 2026, 4:26PM","11"',
  '"Quarterback One","PHI","QB","Harbor Owls","Mesa Comets","0","Mon Nov 16, 2026, 4:26PM","11"',
].join('\n')

describe('the upload places later-round picks', () => {
  beforeEach(() => {
    m.traded = []
    /* Fantrax publishes rounds 1-4 for 2027 through 2029. */
    m.snapshot = {
      transactions: {
        fantraxFuturePicks: {
          picks: [2027, 2028, 2029].flatMap((year) =>
            [1, 2, 3, 4].map((round) => ({ season: year, round, originalTeamId: 't', ownerTeamId: 't' })),
          ),
        },
      },
    }
  })

  it('writes the round 5 pick and leaves the round 2 pick to the API', async () => {
    const res = await importFantraxTradeHistory({ leagueId: 'af-league', csvText: CSV })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.imported).toBe(1)
    expect(res.laterRoundPicks).toEqual({ traded: 1, returned: 0 })
    expect(m.traded).toEqual([
      { leagueId: 'af-league', picks: [{ season: 2029, round: 5, original_roster_id: '202', current_owner_roster_id: '101' }] },
    ])
  })

  it('with no pick list on file, the export is the only source and both picks are placed', async () => {
    m.snapshot = { transactions: { claims: [] } }
    const res = await importFantraxTradeHistory({ leagueId: 'af-league', csvText: CSV })
    expect(res.ok && res.laterRoundPicks).toEqual({ traded: 2, returned: 0 })
  })

  /** A Fantrax league stores every pick, own ones flagged untraded, so a pick that came home is rewritten as that. */
  it('a later-round pick traded away and back is stored as its original team\'s own', async () => {
    const BACK = [
      '"Player","Team","Position","From","To","# Obj","Date (EST)","Week"',
      '"2029 Draft Pick, Round 5 (Mesa Comets)","","","Harbor Owls","Mesa Comets","0","Tue Nov 17, 2026, 5:23PM","11"',
      '"Quarterback One","PHI","QB","Mesa Comets","Harbor Owls","0","Tue Nov 17, 2026, 5:23PM","11"',
      '"2029 Draft Pick, Round 5 (Mesa Comets)","","","Mesa Comets","Harbor Owls","0","Mon Nov 16, 2026, 4:26PM","11"',
      '"Quarterback One","PHI","QB","Harbor Owls","Mesa Comets","0","Mon Nov 16, 2026, 4:26PM","11"',
    ].join('\n')
    const res = await importFantraxTradeHistory({ leagueId: 'af-league', csvText: BACK })
    expect(res.ok && res.laterRoundPicks).toEqual({ traded: 0, returned: 1 })
    expect(m.traded).toEqual([
      { leagueId: 'af-league', picks: [{ season: 2029, round: 5, original_roster_id: '202', current_owner_roster_id: '202', traded: false }] },
    ])
  })

  it('a failure placing picks does not fail the upload', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.fantraxLeague.findFirst).mockRejectedValueOnce(new Error('connection lost'))
    const res = await importFantraxTradeHistory({ leagueId: 'af-league', csvText: CSV })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.imported).toBe(1)
    expect(res.laterRoundPicks).toBeNull()
  })
})
