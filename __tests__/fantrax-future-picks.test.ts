/**
 * Fantrax future draft picks: read, stored on the snapshot, carried into the import and listed.
 *
 * Fantrax's `getDraftPicks.futureDraftPicks` lists EVERY future pick with its original team and its
 * holder (contracts/fantrax/GAPS.md F-05). The fixture is a real public 34-team NFL dynasty league,
 * redacted and trimmed to two seasons: 272 picks, 8 of them traded.
 */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ pickFindMany: vi.fn(), draftGroupBy: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: { futureDraftPick: { findMany: h.pickFindMany }, draftFact: { groupBy: h.draftGroupBy } },
}))

import { getFantraxDraftPicks } from '@/lib/league-import/fantrax/fantraxApi'
import {
  buildStoredFantraxFuturePicks,
  mergeFantraxSnapshotHistory,
  readStoredFantraxDraft,
  readStoredFantraxFuturePicks,
  rekeyFantraxFuturePicks,
} from '@/lib/league-import/fantrax/fantraxSnapshotHistory'
import { FantraxAdapter } from '@/lib/league-import/adapters/fantrax/FantraxAdapter'
import type { FantraxImportPayload } from '@/lib/league-import/adapters/fantrax/types'
import { hasSyncedProviderPicks, loadTeamFuturePicks } from '@/lib/league-trade-engine/importedFuturePicks'

const capture = JSON.parse(readFileSync('tests/fixtures/fantrax/nfl-dynasty-future-picks-public.json', 'utf8')) as {
  currentDraftPicks: unknown[]
  futureDraftPicks: Array<{ year: number; round: number; originalOwnerTeamId: string; currentOwnerTeamId: string }>
}
const respond = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) })

afterEach(() => vi.unstubAllGlobals())
beforeEach(() => vi.resetAllMocks())

async function readCapture() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(capture)))
  const res = await getFantraxDraftPicks('SomeLeagueId')
  if (!res.ok) throw new Error('capture did not parse')
  return res.data
}

describe('reading getDraftPicks', () => {
  it('keeps every future pick with its year, round, original team and holder', async () => {
    const inventory = await readCapture()
    expect(inventory.future).toHaveLength(272)
    expect(inventory.future.filter((p) => p.originalOwnerTeamId !== p.currentOwnerTeamId)).toHaveLength(8)
    expect(new Set(inventory.future.map((p) => p.year))).toEqual(new Set([2027, 2028]))
    expect(inventory.future[0]).toEqual({
      year: capture.futureDraftPicks[0].year,
      round: capture.futureDraftPicks[0].round,
      originalOwnerTeamId: capture.futureDraftPicks[0].originalOwnerTeamId,
      currentOwnerTeamId: capture.futureDraftPicks[0].currentOwnerTeamId,
    })
  })

  it('skips a row that cannot say who holds the pick, and reads a redraft league as having none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({
      currentDraftPicks: [{ round: 1, pick: 3, teamId: 'a' }],
      futureDraftPicks: [
        { year: 2027, round: 1, originalOwnerTeamId: 'a', currentOwnerTeamId: 'b' },
        { year: 2027, round: 2, originalOwnerTeamId: 'a' },
        { year: 2027, round: 0, originalOwnerTeamId: 'a', currentOwnerTeamId: 'a' },
        { round: 1, originalOwnerTeamId: 'a', currentOwnerTeamId: 'a' },
      ],
    })))
    const mixed = await getFantraxDraftPicks('SomeLeagueId')
    expect(mixed.ok && mixed.data.future).toEqual([{ year: 2027, round: 1, originalOwnerTeamId: 'a', currentOwnerTeamId: 'b' }])
    expect(mixed.ok && mixed.data.current).toEqual([{ round: 1, pick: 3, teamId: 'a' }])

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ currentDraftPicks: [] })))
    const redraft = await getFantraxDraftPicks('SomeLeagueId')
    expect(redraft.ok && redraft.data.future).toEqual([])
  })
})

describe('the inventory on the snapshot', () => {
  const stored = () => buildStoredFantraxFuturePicks(
    [
      { year: 2027, round: 1, originalOwnerTeamId: 'fx-a', currentOwnerTeamId: 'fx-b' },
      { year: 2027, round: 1, originalOwnerTeamId: 'fx-b', currentOwnerTeamId: 'fx-b' },
    ],
    { 'fx-a': ' Alpha ', 'fx-b': 'Bravo' },
    '2026-11-18T00:00:00.000Z',
  )

  it('is written beside the draft board and the export groups, and read back', () => {
    const merged = mergeFantraxSnapshotHistory(
      { claims: [{ type: 'claim', player: 'Kept Export' }], fantraxDraft: { draftState: 'DONE', slots: 1, picks: [{ round: 1, pick: 1, pickInRound: 1, teamId: 'fx-a', playerId: 'p1' }] } },
      { draft: null, futurePicks: stored(), moves: [], suspectedTrades: [], period: 1, observedAt: '2026-11-18T00:00:00.000Z' },
    )
    expect(merged.claims).toEqual([{ type: 'claim', player: 'Kept Export' }])
    expect(readStoredFantraxDraft(merged)?.picks).toHaveLength(1)
    expect(readStoredFantraxFuturePicks(merged)?.picks).toEqual([
      { season: 2027, round: 1, originalTeamId: 'fx-a', ownerTeamId: 'fx-b', originalTeamName: 'Alpha', ownerTeamName: 'Bravo' },
      { season: 2027, round: 1, originalTeamId: 'fx-b', ownerTeamId: 'fx-b', originalTeamName: 'Bravo', ownerTeamName: 'Bravo' },
    ])
  })

  it('a read that failed keeps what is on file; a read that found none replaces it', () => {
    const base = { draft: null, moves: [], suspectedTrades: [], period: 1, observedAt: '2026-11-19T00:00:00.000Z' }
    const first = mergeFantraxSnapshotHistory(null, { ...base, futurePicks: stored() })
    const failed = mergeFantraxSnapshotHistory(first, { ...base, futurePicks: null })
    expect(readStoredFantraxFuturePicks(failed)?.picks).toHaveLength(2)
    const emptied = mergeFantraxSnapshotHistory(first, { ...base, futurePicks: buildStoredFantraxFuturePicks([], {}, base.observedAt) })
    expect(readStoredFantraxFuturePicks(emptied)?.picks).toEqual([])
    // A snapshot from before picks were read has no inventory at all, which is not the same as none.
    expect(readStoredFantraxFuturePicks({ claims: [] })).toBeNull()
  })

  it('is re-keyed to our team ids by name, then by Fantrax id, and drops a pick it cannot place', () => {
    const ours: Record<string, string> = { Alpha: '101', 'fx-b': '202' }
    const teamIdFor = (name: string | null, fantraxId: string) => ours[name ?? ''] ?? ours[fantraxId] ?? null
    const withStranger = buildStoredFantraxFuturePicks(
      [
        { year: 2027, round: 1, originalOwnerTeamId: 'fx-a', currentOwnerTeamId: 'fx-b' },
        { year: 2027, round: 2, originalOwnerTeamId: 'fx-a', currentOwnerTeamId: 'fx-gone' },
      ],
      { 'fx-a': 'Alpha' },
      '2026-11-18T00:00:00.000Z',
    )
    expect(rekeyFantraxFuturePicks(withStranger, teamIdFor)).toEqual([
      { season: 2027, round: 1, originalTeamId: '101', ownerTeamId: '202' },
    ])
  })
})

describe('the import result', () => {
  const payload = (futurePicks?: FantraxImportPayload['futurePicks']): FantraxImportPayload => ({
    sourceInput: 'x',
    league: { leagueId: 'L1', name: 'League', sport: 'NFL', season: 2026, size: 2, isDevy: false } as FantraxImportPayload['league'],
    settings: null,
    teams: [],
    schedule: [],
    transactions: [],
    draftPicks: [],
    ...(futurePicks ? { futurePicks } : {}),
    playerMap: {},
    previousSeasons: [],
  } as unknown as FantraxImportPayload)

  it('carries every pick, flagged with whether it has changed hands', async () => {
    const result = await FantraxAdapter.normalize(payload([
      { season: 2027, round: 1, originalTeamId: '101', ownerTeamId: '202' },
      { season: 2027, round: 1, originalTeamId: '202', ownerTeamId: '202' },
    ]))
    expect(result.traded_picks).toEqual([
      { season: 2027, round: 1, original_roster_id: '101', current_owner_roster_id: '202', traded: true },
      { season: 2027, round: 1, original_roster_id: '202', current_owner_roster_id: '202', traded: false },
    ])
  })

  it('says nothing about picks when no inventory is on file, so stored rows are left alone', async () => {
    const result = await FantraxAdapter.normalize(payload())
    expect('traded_picks' in result).toBe(false)
  })
})

describe('listing a Fantrax league\'s picks', () => {
  const teams = [
    { id: 't1', externalId: '101', platformUserId: null, claimedByUserId: null, teamName: 'Alpha' },
    { id: 't2', externalId: '202', platformUserId: null, claimedByUserId: null, teamName: 'Bravo' },
  ]
  const args = { leagueId: 'lea', platform: 'fantrax', isDynasty: false, leagueSeason: 2026, status: 'in_season', teams }

  it('is a provider whose picks are synced', () => {
    expect(hasSyncedProviderPicks('Fantrax')).toBe(true)
  })

  it('lists the stored rows as the whole inventory for the next three drafts, with no round guess', async () => {
    const row = (pickSeason: number, round: number, originalRosterId: string, currentOwnerId: string) => ({ pickSeason, round, originalRosterId, currentOwnerId })
    h.pickFindMany.mockResolvedValue([
      row(2027, 1, '101', '202'), row(2027, 1, '202', '202'), row(2027, 2, '101', '101'), row(2027, 2, '202', '202'),
      row(2028, 1, '101', '101'), row(2029, 1, '202', '202'), row(2030, 1, '202', '202'),
    ])
    const bravo = await loadTeamFuturePicks({ ...args, teamExternalId: '202' })
    expect(bravo.coverage).toBe('complete')
    expect(bravo.picks.map((p) => [p.season, p.round, p.originalTeamId, p.fromTeamName])).toEqual([
      [2027, 1, '101', 'Alpha'],
      [2027, 1, '202', null],
      [2027, 2, '202', null],
      [2029, 1, '202', null],
    ])
    const alpha = await loadTeamFuturePicks({ ...args, teamExternalId: '101' })
    expect(alpha.picks.map((p) => [p.season, p.round])).toEqual([[2027, 2], [2028, 1]])
    // The league's draft history is never used to invent rounds for a Fantrax league.
    expect(h.draftGroupBy).not.toHaveBeenCalled()
    expect(h.pickFindMany.mock.calls[0][0].where).toMatchObject({ leagueId: 'lea', status: 'active', pickSeason: { gte: 2026 } })
  })

  it('lists nothing for a league with no rows, and reports a failed read as failed', async () => {
    h.pickFindMany.mockResolvedValue([])
    expect(await loadTeamFuturePicks({ ...args, teamExternalId: '202' })).toEqual({ picks: [], coverage: 'none', readFailed: false })
    h.pickFindMany.mockRejectedValue(new Error('down'))
    expect(await loadTeamFuturePicks({ ...args, teamExternalId: '202' })).toEqual({ picks: [], coverage: 'none', readFailed: true })
  })
})
