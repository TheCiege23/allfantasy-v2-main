/**
 * A waiver award on a chopped team's player stamps his release row with the winner and the bid
 * (lib/guillotine/choppedReleases.ts `recordChopReleaseClaim`), and the waiver engine calls it for a
 * guillotine league. The bid had no writer: a $37 award left the row `pending` with no bid.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { id: string; leagueId: string; playerId: string; scoringPeriod: number; releaseStatus: string; claimedByRosterId: string | null; claimedAt: Date | null; winningBid: number | null }
const state = vi.hoisted(() => ({ rows: [] as Row[] }))
const db = {
  guillotineWaiverRelease: {
    findFirst: vi.fn(async ({ where, orderBy }: { where: { leagueId: string; playerId: string; claimedAt: null }; orderBy: { scoringPeriod: 'desc' } }) => {
      expect(orderBy).toEqual({ scoringPeriod: 'desc' })
      const hits = state.rows.filter((r) => r.leagueId === where.leagueId && r.playerId === where.playerId && r.claimedAt == null)
      return hits.sort((a, b) => b.scoringPeriod - a.scoringPeriod)[0] ?? null
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const row = state.rows.find((r) => r.id === where.id)!
      Object.assign(row, data)
      return row
    }),
  },
}
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { recordChopReleaseClaim } from '@/lib/guillotine/choppedReleases'

const row = (id: string, over: Partial<Row> = {}): Row => ({ id, leagueId: 'L1', playerId: 'p1', scoringPeriod: 1, releaseStatus: 'pending', claimedByRosterId: null, claimedAt: null, winningBid: null, ...over })
const AT = new Date('2026-11-20T12:00:00Z')

beforeEach(() => {
  state.rows = []
  vi.clearAllMocks()
})

describe('recordChopReleaseClaim', () => {
  it('stamps the winner, the time and the bid', async () => {
    state.rows = [row('a')]
    expect(await recordChopReleaseClaim({ leagueId: 'L1', playerId: 'p1', rosterId: 'r-win', winningBid: 37, at: AT }, db as never)).toBe(true)
    expect(state.rows[0]).toMatchObject({ releaseStatus: 'claimed', claimedByRosterId: 'r-win', claimedAt: AT, winningBid: 37 })
  })

  it('a player released twice: the earlier award stands, the latest release takes this one', async () => {
    state.rows = [row('wk1', { releaseStatus: 'claimed', claimedByRosterId: 'r-old', claimedAt: AT, winningBid: 12 }), row('wk3', { scoringPeriod: 3 })]
    await recordChopReleaseClaim({ leagueId: 'L1', playerId: 'p1', rosterId: 'r-new', winningBid: 5, at: AT }, db as never)
    expect(state.rows[0]).toMatchObject({ claimedByRosterId: 'r-old', winningBid: 12 })
    expect(state.rows[1]).toMatchObject({ releaseStatus: 'claimed', claimedByRosterId: 'r-new', winningBid: 5 })
  })

  it('a league without bidding records the claim with no bid', async () => {
    state.rows = [row('a')]
    await recordChopReleaseClaim({ leagueId: 'L1', playerId: 'p1', rosterId: 'r', winningBid: null, at: AT }, db as never)
    expect(state.rows[0]).toMatchObject({ releaseStatus: 'claimed', winningBid: null })
  })

  it('a player no chop released, or another league\'s row, stamps nothing', async () => {
    state.rows = [row('a', { leagueId: 'L2' })]
    expect(await recordChopReleaseClaim({ leagueId: 'L1', playerId: 'p1', rosterId: 'r', winningBid: 9 }, db as never)).toBe(false)
    expect(await recordChopReleaseClaim({ leagueId: 'L1', playerId: 'nobody', rosterId: 'r', winningBid: 9 }, db as never)).toBe(false)
    expect(db.guillotineWaiverRelease.update).not.toHaveBeenCalled()
  })
})

describe('the waiver engine records the award', () => {
  // CRLF -> LF: a Windows checkout (core.autocrlf=true) has \r\n on disk, and the `\n` in the pattern below then
  // never matches, so the test failed on every Windows run while CI (LF) stayed green.
  const src = readFileSync(join(process.cwd(), 'lib/waiver-wire/process-engine.ts'), 'utf8').replace(/\r\n/g, '\n')
  it('calls it on an award in a guillotine league, with the FAAB spent, and never lets it fail the award', () => {
    expect(src).toMatch(/^\s*if \(league\.guillotineMode\) \{\n\s*await recordChopReleaseClaim\(\{ leagueId, playerId: addId, rosterId: claim\.rosterId, winningBid: faabSpent \}\)\.catch\(/m)
  })
})
