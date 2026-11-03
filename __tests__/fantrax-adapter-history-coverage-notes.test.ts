/**
 * The Fantrax import's draft and transaction coverage notes are true for BOTH import paths.
 *
 * They read "No Fantrax … was available from uploaded data." On a live (league-id) import nothing was
 * uploaded, and the draft board IS read (`getFantraxDraftResults` in importFantraxLeague.ts) — and,
 * since fantraxSnapshotHistory.ts, stored in the snapshot's `transactions` column — so the note
 * blamed an upload that never happened. Transactions: Fantrax publishes no
 * transactions endpoint, so a league-id import reads none; only an uploaded export supplies them.
 */
import { describe, expect, it } from 'vitest'
import { FantraxAdapter } from '@/lib/league-import/adapters/fantrax/FantraxAdapter'
import type { FantraxImportPayload } from '@/lib/league-import/adapters/fantrax/types'

const payload = (over: Partial<FantraxImportPayload> = {}): FantraxImportPayload => ({
  sourceInput: 'fantrax-league:abc123|Team A',
  league: { leagueId: 'abc123', name: 'L', sport: 'NFL', season: 2026, size: 2, currentWeek: 1, isFinished: false, url: null, isDevy: false },
  settings: null,
  teams: ['1', '2'].map((teamId) => ({
    teamId, managerId: `m${teamId}`, managerName: `M${teamId}`, teamName: `T${teamId}`, logoUrl: null,
    wins: 0, losses: 0, ties: 0, rank: Number(teamId), pointsFor: 0, pointsAgainst: 0, faabRemaining: null, waiverPriority: null,
    rosterPlayerIds: [], starterPlayerIds: [], reservePlayerIds: [], playerMap: {},
  })),
  schedule: [],
  transactions: [],
  draftPicks: [],
  playerMap: {},
  previousSeasons: [],
  ...over,
})

describe('FantraxAdapter coverage notes — draft and transactions', () => {
  it('an empty draft does not blame an upload, and says when a league-id import stores the board', async () => {
    const note = (await FantraxAdapter.normalize(payload())).coverage?.draftHistory?.note ?? ''
    expect(note).not.toMatch(/uploaded data/)
    expect(note).toMatch(/league-id import/i)
    /* The board IS stored now (fantraxSnapshotHistory.ts); an empty one means the league has not drafted. */
    expect(note).toMatch(/stores the draft board once the league has drafted/i)
    expect(note).not.toMatch(/not stored|does not store|is not stored/i)
  })

  it('empty transactions do not blame an upload, and say where they can come from', async () => {
    const note = (await FantraxAdapter.normalize(payload())).coverage?.tradeHistory?.note ?? ''
    expect(note).not.toMatch(/uploaded data/)
    expect(note).toMatch(/league-id import/i)
    expect(note).toMatch(/export/i)
  })

  it('the populated-draft note is unchanged', async () => {
    const result = await FantraxAdapter.normalize(payload({ draftPicks: [{ round: 1, pickNumber: 1, teamId: '1', playerId: 'p1' }] }))
    expect(result.coverage?.draftHistory).toMatchObject({ state: 'partial', count: 1 })
  })
})
