// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Fantrax's "Transaction History → Claim/Drop" export, read into confirmed claims and drops.
 *
 * Until this, a Fantrax add or drop was only ever INFERRED from two roster snapshots (contracts/fantrax/GAPS.md
 * F-13). The export is Fantrax's own record (GAPS F-19): the player, the fantasy team, the winning bid and the
 * time. Prisma and the fact writer are mocked; nothing here calls Fantrax.
 */
const m = vi.hoisted(() => ({
  commissioner: true,
  league: { name: 'Test Dynasty', platform: 'fantrax', platformLeagueId: 'snap-1', sport: 'NFL' } as Record<string, unknown> | null,
  snapshot: { sourceLeagueId: 'abcdefgh1234' } as Record<string, unknown> | null,
  facts: [] as Array<Record<string, any>>,
  tradeImport: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/league/commissionerAccess', () => ({ canCommissionerAct: async () => m.commissioner }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => m.league) },
    fantraxLeague: { findUnique: vi.fn(async () => m.snapshot) },
    leagueTeam: {
      findMany: vi.fn(async () => [
        { externalId: '101', teamName: 'Harbor Owls', platformUserId: 'fantrax-user:owl' },
        { externalId: '202', teamName: 'Mesa Comets', platformUserId: null },
      ]),
    },
    playerIdentityMap: {
      findMany: vi.fn(async () => [
        { fantraxId: 'fx-wr1', canonicalName: 'Receiver One', currentTeam: 'PHI', position: 'WR' },
        { fantraxId: 'fx-rb1', canonicalName: 'Back One', currentTeam: 'NYG', position: 'RB' },
        { fantraxId: 'fx-qb1', canonicalName: 'Passer One', currentTeam: 'NYJ', position: 'QB' },
      ]),
    },
  },
}))
vi.mock('@/lib/league-import/persistProviderTransactionFacts', () => ({
  persistProviderTransactionFacts: vi.fn(async (rows: Array<Record<string, any>>) => { m.facts.push(...rows); return rows.length }),
}))
vi.mock('@/lib/league-import/fantrax/importFantraxTradeHistory', () => ({ importFantraxTradeHistory: m.tradeImport }))

import { parseFantraxClaimDropCsv, WRONG_CLAIM_DROP_EXPORT_ERROR } from '@/lib/league-import/fantrax/fantraxClaimDropCsv'
import { claimDropFactType, importFantraxClaimDropHistory } from '@/lib/league-import/fantrax/importFantraxClaimDropHistory'
import { fantraxTransactionContext, fantraxTransactionDownloadUrl, importFantraxTransactionExports } from '@/lib/import-os/collector/fantraxTransactionSync'

const H = '"Player","Team","Position","Type","Team","Bid","Date (EST)","Week"'
const GOOD = [
  H,
  '"Receiver One","PHI","WR","Claim","#5 Harbor Owls","7000.00","Sat Nov 21, 2026, 9:00AM","11"',
  '"Back One","NYG","RB","Drop","#9 Mesa Comets","","Sat Nov 21, 2026, 6:07AM","11"',
  '"Passer One","NYJ","SFX","Claim","#9 Mesa Comets","","Fri Nov 20, 2026, 9:00AM","11"',
].join('\n')

describe('parseFantraxClaimDropCsv', () => {
  it('reads a claim with its bid and a drop with none, taking the SECOND Team column as the fantasy team', () => {
    const parsed = parseFantraxClaimDropCsv(GOOD)
    if (!parsed.ok) throw new Error(parsed.error)
    expect(parsed.skipped).toEqual([])
    expect(parsed.moves.map((x) => [x.kind, x.playerName, x.proTeam, x.position, x.team, x.bid, x.week])).toEqual([
      ['claim', 'Receiver One', 'PHI', 'WR', '#5 Harbor Owls', 7000, 11],
      ['drop', 'Back One', 'NYG', 'RB', '#9 Mesa Comets', null, 11],
      ['claim', 'Passer One', 'NYJ', 'SFX', '#9 Mesa Comets', null, 11],
    ])
    // 9:00 AM US Eastern in November is 14:00 UTC.
    expect(parsed.moves[0]!.date.toISOString()).toBe('2026-11-21T14:00:00.000Z')
  })

  it('gives the same move the same id on every read, and a repeated row its own', () => {
    const once = parseFantraxClaimDropCsv(GOOD)
    const again = parseFantraxClaimDropCsv(GOOD)
    const doubled = parseFantraxClaimDropCsv([GOOD, GOOD.split('\n')[1]].join('\n'))
    if (!once.ok || !again.ok || !doubled.ok) throw new Error('parse failed')
    expect(again.moves.map((x) => x.id)).toEqual(once.moves.map((x) => x.id))
    expect(new Set(doubled.moves.map((x) => x.id)).size).toBe(4)
  })

  it('skips a row it cannot read and says which line, without losing the rest', () => {
    const parsed = parseFantraxClaimDropCsv([
      H,
      '"Receiver One","PHI","WR","Claim","#5 Harbor Owls","7000.00","Sat Nov 21, 2026, 9:00AM","11"',
      '"Back One","NYG","RB","Lineup","#9 Mesa Comets","","Sat Nov 21, 2026, 6:07AM","11"',
      '"Back One","NYG","RB","Drop","#9 Mesa Comets","","yesterday","11"',
      '"Back One","NYG","RB","Claim","#9 Mesa Comets","lots","Sat Nov 21, 2026, 6:07AM","11"',
    ].join('\n'))
    if (!parsed.ok) throw new Error(parsed.error)
    expect(parsed.moves).toHaveLength(1)
    expect(parsed.skipped.map((s) => s.line)).toEqual([3, 4, 5])
  })

  it('refuses the Trades export by name, and any other file', () => {
    expect(parseFantraxClaimDropCsv('"Player","Team","Position","From","To","# Obj","Date (EST)","Week"\n')).toEqual({ ok: false, error: WRONG_CLAIM_DROP_EXPORT_ERROR })
    expect(parseFantraxClaimDropCsv('"Player","Points"\n"x","1"').ok).toBe(false)
    expect(parseFantraxClaimDropCsv('').ok).toBe(false)
  })
})

describe('importFantraxClaimDropHistory', () => {
  beforeEach(() => {
    m.facts.length = 0
    m.commissioner = true
    m.league = { name: 'Test Dynasty', platform: 'fantrax', platformLeagueId: 'snap-1', sport: 'NFL' }
    m.snapshot = { sourceLeagueId: 'abcdefgh1234' }
    m.tradeImport.mockReset()
  })

  it('writes each placed move as a completed fact with the league’s own ids', async () => {
    const result = await importFantraxClaimDropHistory({ leagueId: 'af-league', csvText: GOOD })
    expect(result).toMatchObject({ ok: true, placed: 3, claims: 2, drops: 1, refused: [] })
    expect(m.facts.map((f) => [f.type, f.playerId, f.rosterId, f.managerId, f.season, f.weekOrPeriod, f.lifecycleStage])).toEqual([
      ['waiver', 'fx-wr1', '101', 'fantrax-user:owl', 2026, 11, 'completed'],
      ['drop', 'fx-rb1', '202', null, 2026, 11, 'completed'],
      // A claim with no bid needed none; "SFX" is a lineup slot, not a position, so it does not block the match.
      ['free_agent', 'fx-qb1', '202', null, 2026, 11, 'completed'],
    ])
    expect(m.facts[0]).toMatchObject({ provider: 'fantrax', leagueId: 'af-league', sport: 'NFL' })
    expect(m.facts[0]!.payload).toMatchObject({ status: 'completed', direction: 'obtained', source: 'fantrax_transaction_history', bid: 7000, playerName: 'Receiver One' })
    expect(m.facts[1]!.payload).toMatchObject({ status: 'completed', direction: 'dropped', bid: null })
    expect(m.facts[0]!.occurredAt.toISOString()).toBe('2026-11-21T14:00:00.000Z')
    expect(m.facts[0]!.upstreamTransactionId).toMatch(/^fantrax-csv:claim-drop:[a-f0-9]{40}$/)
  })

  it('refuses a move whose team or player cannot be placed, and writes the rest', async () => {
    const result = await importFantraxClaimDropHistory({
      leagueId: 'af-league',
      csvText: [
        H,
        '"Receiver One","PHI","WR","Claim","#5 Harbor Owls","7000.00","Sat Nov 21, 2026, 9:00AM","11"',
        '"Nobody Known","KC","WR","Claim","#5 Harbor Owls","1000.00","Sat Nov 21, 2026, 9:00AM","11"',
        '"Back One","NYG","RB","Drop","#2 Ghost Team","","Sat Nov 21, 2026, 6:07AM","11"',
        '"Receiver One","DAL","WR","Drop","#5 Harbor Owls","","Sat Nov 21, 2026, 6:07AM","11"',
      ].join('\n'),
    })
    if (!result.ok) throw new Error(result.error)
    expect(result.placed).toBe(1)
    expect(m.facts).toHaveLength(1)
    expect(result.refused.map((r) => r.playerName)).toEqual(['Nobody Known', 'Back One', 'Receiver One'])
    expect(result.refused[1]!.reason).toContain('Ghost Team')
  })

  it('refuses a league that is not an imported Fantrax league, and writes nothing', async () => {
    m.league = { name: 'x', platform: 'sleeper', platformLeagueId: '1', sport: 'NFL' }
    expect(await importFantraxClaimDropHistory({ leagueId: 'af-league', csvText: GOOD })).toMatchObject({ ok: false, status: 409 })
    m.league = null
    expect(await importFantraxClaimDropHistory({ leagueId: 'af-league', csvText: GOOD })).toMatchObject({ ok: false, status: 404 })
    expect(m.facts).toHaveLength(0)
  })

  it('names a claim by whether Fantrax recorded a bid', () => {
    expect(claimDropFactType({ kind: 'claim', bid: 0 })).toBe('waiver')
    expect(claimDropFactType({ kind: 'claim', bid: null })).toBe('free_agent')
    expect(claimDropFactType({ kind: 'drop', bid: null })).toBe('drop')
  })
})

describe('the connector’s transaction sync', () => {
  beforeEach(() => {
    m.facts.length = 0
    m.commissioner = true
    m.league = { name: 'Test Dynasty', platform: 'fantrax', platformLeagueId: 'snap-1', sport: 'NFL' }
    m.snapshot = { sourceLeagueId: 'abcdefgh1234' }
    m.tradeImport.mockReset()
    m.tradeImport.mockResolvedValue({ ok: true, imported: 2, rowsWritten: 4, refused: [], skippedLines: [], laterRoundPicks: null })
  })

  it('builds exactly the captured download address, one per tab', async () => {
    expect(fantraxTransactionDownloadUrl('abcdefgh1234', 'CLAIM_DROP')).toBe(
      'https://www.fantrax.com/fxpa/downloadTransactionHistory?leagueId=abcdefgh1234&pageNumber=1&team=ALL&positionOrGroup=ALL&view=CLAIM_DROP&adminMode=false&includeDeleted=false&executedOnly=true',
    )
    expect(() => fantraxTransactionDownloadUrl('../evil', 'TRADE')).toThrow()
    const context = await fantraxTransactionContext('u-comm', 'af-league')
    expect(context.leagueName).toBe('Test Dynasty')
    expect(context.downloads.map((d) => d.view)).toEqual(['TRADE', 'CLAIM_DROP'])
  })

  it('is for the commissioner of an imported Fantrax league only', async () => {
    m.commissioner = false
    await expect(fantraxTransactionContext('u-member', 'af-league')).rejects.toThrow()
    await expect(importFantraxTransactionExports('u-member', { leagueId: 'af-league', claimDrops: GOOD })).rejects.toThrow()
    expect(m.facts).toHaveLength(0)
    m.commissioner = true
    m.snapshot = { sourceLeagueId: null }
    await expect(fantraxTransactionContext('u-comm', 'af-league')).rejects.toThrow()
  })

  it('imports each file on its own and reports each', async () => {
    const both = await importFantraxTransactionExports('u-comm', { leagueId: 'af-league', trades: 'trade-csv', claimDrops: GOOD })
    expect(m.tradeImport).toHaveBeenCalledWith({ leagueId: 'af-league', csvText: 'trade-csv' })
    expect(both.trades).toMatchObject({ ok: true, imported: 2 })
    expect(both.claimDrops).toMatchObject({ ok: true, placed: 3 })
    m.tradeImport.mockResolvedValue({ ok: false, status: 400, error: 'The file is empty.' })
    const mixed = await importFantraxTransactionExports('u-comm', { leagueId: 'af-league', trades: 'bad', claimDrops: GOOD })
    expect(mixed.trades).toMatchObject({ ok: false })
    expect(mixed.claimDrops).toMatchObject({ ok: true, placed: 3 })
    const one = await importFantraxTransactionExports('u-comm', { leagueId: 'af-league', claimDrops: GOOD })
    expect(one.trades).toBeNull()
  })
})
