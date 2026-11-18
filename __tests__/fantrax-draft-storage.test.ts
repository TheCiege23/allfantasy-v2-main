// @vitest-environment node
/**
 * Guards the stored Fantrax draft: what the import writes to
 * `FantraxLeague.draftBoard` / `draftPicks`, and what the reader takes back out.
 *
 * Driven by the same committed fixtures as `fantrax-draft.test.ts` (opaque ids
 * only, no names or owners).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  futurePicksFromStoredInventory,
  madePicksFromStoredBoard,
  parseStoredFantraxDraftBoard,
  toStoredFantraxDraftBoard,
  toStoredFantraxPickInventory,
} from '@/lib/league-import/fantrax/fantraxDraft'
import {
  getFantraxDraftPicks,
  parseFantraxFuturePicks,
  type FantraxDraftResults,
} from '@/lib/league-import/fantrax/fantraxApi'
import { FantraxAdapter } from '@/lib/league-import/adapters/fantrax/FantraxAdapter'
import type { FantraxImportPayload } from '@/lib/league-import/adapters/fantrax/types'

const rawResults = JSON.parse(readFileSync('__tests__/fixtures/fantrax-draft-results.json', 'utf8')) as {
  draftPicks: Array<Record<string, unknown>>
  draftState: string
  draftType: string
  draftOrder: string[]
}
const rawPicks = JSON.parse(readFileSync('__tests__/fixtures/fantrax-draft-picks.json', 'utf8')) as {
  currentDraftPicks: Array<Record<string, unknown>>
  futureDraftPicks: unknown[]
}

const results: FantraxDraftResults = {
  picks: rawResults.draftPicks.map((p) => ({
    round: Number(p.round),
    pick: Number(p.pick),
    pickInRound: Number(p.pickInRound),
    teamId: String(p.teamId),
    time: typeof p.time === 'number' ? p.time : null,
    playerId: typeof p.playerId === 'string' ? p.playerId : null,
  })),
  draftState: rawResults.draftState,
  draftType: rawResults.draftType,
  draftOrder: rawResults.draftOrder,
  draftDate: null,
  startDate: null,
  endDate: null,
}

const firstMade = results.picks.find((p) => p.playerId)!
const NOW = new Date('2026-11-18T12:00:00Z')

afterEach(() => vi.unstubAllGlobals())

describe('storing the draft board', () => {
  it('keeps every slot, made or not', () => {
    const stored = toStoredFantraxDraftBoard(results, {}, NOW)
    expect(stored.picks).toHaveLength(192)
    expect(stored.picks.filter((p) => p.playerId).length).toBe(156)
    expect(stored.draftState).toBe(rawResults.draftState)
    expect(stored.fetchedAt).toBe(NOW.toISOString())
  })

  /**
   * ⚠ NAMED AT STORE TIME. The reader only knows players currently on a roster,
   * so a drafted player who was later dropped would otherwise be nameless.
   */
  it('names the drafted player from the directory it is given', () => {
    const stored = toStoredFantraxDraftBoard(
      results,
      { [firstMade.playerId!]: { name: 'Test Player', position: 'WR', team: 'TxSt' } },
      NOW,
    )
    expect(stored.picks.find((p) => p.playerId === firstMade.playerId)).toMatchObject({
      playerName: 'Test Player',
      playerPosition: 'WR',
      playerTeam: 'TxSt',
    })
    /* A player missing from the directory stays null rather than getting his id as a name. */
    expect(stored.picks.filter((p) => p.playerId && p.playerName).length).toBe(1)
  })

  it('survives a trip through JSON, which is what a JSON column does to it', () => {
    const stored = toStoredFantraxDraftBoard(results, {}, NOW)
    const back = parseStoredFantraxDraftBoard(JSON.parse(JSON.stringify(stored)))
    expect(back).toEqual(stored)
  })
})

describe('reading the draft board back', () => {
  it('returns only the picks that were made, in overall order', () => {
    const board = parseStoredFantraxDraftBoard(JSON.parse(JSON.stringify(toStoredFantraxDraftBoard(results, {}, NOW))))
    const out = madePicksFromStoredBoard(board)

    expect(out.slots).toBe(192)
    expect(out.picks).toHaveLength(156)
    expect(out.outstanding).toBe(36)
    expect(out.picks.every((p) => p.playerId)).toBe(true)
    const numbers = out.picks.map((p) => p.pickNumber)
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
    /* OVERALL pick numbers, so they run past the 12 picks of a single round. */
    expect(Math.max(...numbers)).toBeGreaterThan(12)
  })

  it('treats an empty or foreign column as no board', () => {
    for (const junk of [null, undefined, 'x', 7, [], {}, { picks: 'nope' }]) {
      expect(parseStoredFantraxDraftBoard(junk)).toBeNull()
    }
    expect(madePicksFromStoredBoard(null)).toEqual({ picks: [], slots: 0, outstanding: 0, draftState: null })
  })

  it('drops a stored row that is not a pick instead of coercing it', () => {
    const board = parseStoredFantraxDraftBoard({
      picks: [
        { round: 1, pick: 1, pickInRound: 1, teamId: 't1', playerId: 'p1' },
        { round: '1', pick: 2, pickInRound: 2, teamId: 't2', playerId: 'p2' },
        { round: 1, pick: 3, pickInRound: 3, teamId: '', playerId: 'p3' },
        null,
      ],
    })
    expect(board?.picks.map((p) => p.playerId)).toEqual(['p1'])
  })
})

describe('storing pick ownership', () => {
  it('keeps the current picks and the future rows exactly as sent', async () => {
    const future = [{ year: 2027, round: 1, someKeyWeHaveNeverSeen: 'abc' }]
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ...rawPicks, futureDraftPicks: future }),
      }),
    )
    const res = await getFantraxDraftPicks('v2kzedypmm8jp61b')
    expect(res.ok).toBe(true)
    if (!res.ok) return

    const stored = toStoredFantraxPickInventory(res.data, NOW)
    expect(stored.current).toHaveLength(rawPicks.currentDraftPicks.length)
    expect(stored.current[0]).toEqual({
      round: Number(rawPicks.currentDraftPicks[0]!.round),
      pick: Number(rawPicks.currentDraftPicks[0]!.pick),
      teamId: String(rawPicks.currentDraftPicks[0]!.teamId),
    })
    /* Unknown keys survive: the shape is unverified, so nothing is thrown away. */
    expect(stored.futureRaw).toEqual(future)
  })
})

describe('future picks', () => {
  /**
   * 🛑 THE SHAPE, MEASURED. A real future pick has `year`, `round` and two owner
   * ids — no `pick`, no `teamId`. The reader used to look for the current-pick
   * keys and returned nothing for a league with 1,360 future picks.
   */
  const REAL_SHAPE = [
    { year: 2027, round: 1, currentOwnerTeamId: 'jets', originalOwnerTeamId: 'oilers' },
    { year: 2027, round: 2, currentOwnerTeamId: 'oilers', originalOwnerTeamId: 'oilers' },
  ]

  it('reads the four real keys', () => {
    expect(parseFantraxFuturePicks(REAL_SHAPE)).toEqual([
      { season: 2027, round: 1, currentOwnerTeamId: 'jets', originalOwnerTeamId: 'oilers' },
      { season: 2027, round: 2, currentOwnerTeamId: 'oilers', originalOwnerTeamId: 'oilers' },
    ])
  })

  it('drops a row missing an owner, a season or a round', () => {
    expect(
      parseFantraxFuturePicks([
        { year: 2027, round: 1, currentOwnerTeamId: 'jets' },
        { year: 2027, round: 1, originalOwnerTeamId: 'oilers', currentOwnerTeamId: '' },
        { round: 1, currentOwnerTeamId: 'jets', originalOwnerTeamId: 'oilers' },
        { year: 2027, currentOwnerTeamId: 'jets', originalOwnerTeamId: 'oilers' },
        /* The CURRENT-pick shape is not a future pick. */
        { round: 15, pick: 10, teamId: 'i116r2iumm8jp61f' },
        null,
      ]),
    ).toEqual([])
    expect(parseFantraxFuturePicks('nope')).toEqual([])
  })

  it('the API wrapper returns them parsed as well as raw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ currentDraftPicks: [], futureDraftPicks: REAL_SHAPE }),
      }),
    )
    const res = await getFantraxDraftPicks('tau9a8fomvmq84sx')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.future).toHaveLength(2)
    expect(res.data.futureRaw).toEqual(REAL_SHAPE)
  })

  it('tells an empty column apart from a stored inventory with no future picks', () => {
    expect(futurePicksFromStoredInventory(null)).toEqual({ stored: false, picks: [] })
    expect(futurePicksFromStoredInventory({})).toEqual({ stored: false, picks: [] })
    expect(futurePicksFromStoredInventory({ version: 1, current: [], futureRaw: [] })).toEqual({ stored: true, picks: [] })
    expect(futurePicksFromStoredInventory({ futureRaw: REAL_SHAPE }).picks).toHaveLength(2)
  })

  it('traded picks reach the normalized result, and absence stays absence', async () => {
    const base = {
      sourceInput: 'id:x',
      league: { leagueId: 'x', name: 'L', sport: 'NFL', season: 2026, size: 0, currentWeek: null, isFinished: false, url: null, isDevy: false },
      settings: null, teams: [], schedule: [], transactions: [], draftPicks: [], playerMap: {}, previousSeasons: [],
    } as unknown as FantraxImportPayload

    const none = await FantraxAdapter.normalize(base)
    expect('traded_picks' in none).toBe(false)

    const empty = await FantraxAdapter.normalize({ ...base, tradedPicks: [] })
    expect(empty.traded_picks).toEqual([])

    const some = await FantraxAdapter.normalize({
      ...base,
      tradedPicks: [{ season: 2027, round: 1, originalTeamId: '27', currentOwnerTeamId: '9' }],
    })
    expect(some.traded_picks).toEqual([
      { season: 2027, round: 1, original_roster_id: '27', current_owner_roster_id: '9' },
    ])
  })
})

describe('draft coverage says what is actually on file', () => {
  const base = {
    sourceInput: 'id:x',
    league: { leagueId: 'x', name: 'L', sport: 'NFL', season: 2026, size: 0, currentWeek: null, isFinished: false, url: null, isDevy: false },
    settings: null,
    teams: [],
    schedule: [],
    transactions: [],
    draftPicks: [],
    playerMap: {},
    previousSeasons: [],
  } as unknown as FantraxImportPayload

  it('reports a complete board as full', async () => {
    const out = await FantraxAdapter.normalize({
      ...base,
      draftBoard: { slots: 192, made: 192, outstanding: 0, state: 'completed' },
    })
    expect(out.coverage.draftHistory).toMatchObject({ state: 'full', count: 192 })
  })

  it('reports a part-finished board as partial, with the numbers', async () => {
    const out = await FantraxAdapter.normalize({
      ...base,
      draftBoard: { slots: 192, made: 156, outstanding: 36, state: 'in_progress' },
    })
    expect(out.coverage.draftHistory.state).toBe('partial')
    expect(out.coverage.draftHistory.note).toMatch(/156 of 192/)
  })

  it('does not call traded-pick rows a draft when no board is on file', async () => {
    const out = await FantraxAdapter.normalize({ ...base, draftBoard: null })
    expect(out.coverage.draftHistory.state).toBe('missing')
  })
})
