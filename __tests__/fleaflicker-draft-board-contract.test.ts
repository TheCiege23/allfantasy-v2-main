// @vitest-environment node
/**
 * Pins what the `FetchLeagueDraftBoard` fixtures actually prove, before a mapper is
 * written on top of them.
 *
 * 🛑 THE FINDING THIS EXISTS FOR: THE ENDPOINT RETURNS TWO STRUCTURALLY DIFFERENT
 * ENVELOPES. Same league, same request but for the season — 2019 gives a BOARD
 * (`{draftOrder, rows, rosters}`), 2020 gives a FLAT LIST (`{orderedSelections}`),
 * 2021 gives `{}`. All three are HTTP 200. A mapper written against either shape
 * alone reads the other as "no draft" and says nothing about it.
 *
 * ⚠ THE SAFE BRANCH IS ON THE KEY, NOT THE SEASON. The pick object is identical in
 * both envelopes, so one mapper works — provided it asks which key is present. The
 * season is a correlate of something unknown (draft type? platform change?); keying
 * on the year would pass on this league and fail on the next. See G-10.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const fx = (n: string) =>
  JSON.parse(readFileSync(`contracts/fleaflicker/fixtures/${n}`, 'utf8'))

const board = fx('draftBoard.NFL.2019.json')
const list = fx('draftBoard.NFL.2020.json')
const empty = fx('draftBoard.NFL.2021.empty.json')
const rosters2021 = fx('rosters.NFL.2021.json')

/** The presence-branch this contract recommends — the thing a mapper should do. */
function picksOf(payload: Record<string, unknown>): unknown[] {
  if (Array.isArray(payload.rows)) {
    return (payload.rows as { cells?: unknown[] }[]).flatMap((r) => r.cells ?? [])
  }
  if (Array.isArray(payload.orderedSelections)) return payload.orderedSelections as unknown[]
  return []
}

describe('FetchLeagueDraftBoard returns two envelopes, and the season is not the rule', () => {
  it('2019 is a BOARD: rounds of cells', () => {
    expect(Object.keys(board).sort()).toEqual(['draftOrder', 'rosters', 'rows'])
    expect(board.rows.length).toBeGreaterThan(0)
    expect(Array.isArray(board.rows[0].cells)).toBe(true)
    expect(typeof board.rows[0].round).toBe('number')
  })

  it('2020 is a FLAT LIST of the same cells', () => {
    expect(Object.keys(list)).toEqual(['orderedSelections'])
    expect(list.orderedSelections.length).toBeGreaterThan(0)
  })

  it('🛑 2021 is an EMPTY OBJECT under HTTP 200 — not an error, not "never drafted"', () => {
    /*
     * The same league answers richly for 2019 and 2020, and `draft_number` does not
     * change it. A reader who treats `{}` as a fetch failure will retry forever; one
     * who treats it as "no draft history" will erase two seasons that exist.
     */
    expect(empty).toEqual({})
    expect(picksOf(empty)).toEqual([])
  })

  it('⚡ ONE mapper serves both, because the pick object is identical', () => {
    const a = picksOf(board)[0] as Record<string, unknown>
    const b = picksOf(list)[0] as Record<string, unknown>
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort())
    expect(Object.keys(a).sort()).toEqual(['color', 'player', 'slot', 'team'])
  })

  it('the presence-branch, not the season, is what selects the shape', () => {
    /*
     * Control on the recommendation itself: a payload carrying NEITHER key must
     * yield no picks rather than throwing, and one carrying `rows` must not be
     * mistaken for the list form.
     */
    expect(picksOf({})).toEqual([])
    expect(picksOf({ somethingElse: [1, 2] })).toEqual([])
    expect(picksOf({ rows: [{ cells: [1, 2] }, { cells: [3] }] })).toEqual([1, 2, 3])
    expect(picksOf({ orderedSelections: [9] })).toEqual([9])
  })
})

describe('player identity is now PROVEN by a fixture, not just asserted by code', () => {
  /*
   * 🛑 WHY THIS BLOCK EXISTS. `NormalizedDraftPick.source_player_id` is a required
   * string, and `FleaflickerAdapter` already reads `proPlayer.id` — but the only
   * committed rosters fixture was a PRE-DRAFT league with 1 roster and 0 players, so
   * that field was used in code and proven by nothing. A draft mapper cannot be
   * written against an unproven id.
   */
  it('the pre-draft fixture really does carry zero players — the gap was real', () => {
    const pre = fx('rosters.NFL.json')
    const total = pre.rosters.reduce(
      (n: number, r: { players?: unknown[] }) => n + (r.players?.length ?? 0),
      0,
    )
    expect(total).toBe(0)
  })

  it('a played season carries proPlayer with the fields the adapter reads', () => {
    const p = rosters2021.rosters[0].players[0].proPlayer
    expect(p).toMatchObject({
      id: expect.any(Number),
      nameFull: expect.any(String),
      position: expect.any(String),
    })
  })

  it('⚠ `proPlayer.id` is a NUMBER, so every consumer must stringify it', () => {
    /*
     * The adapter already does `String(p.proPlayer?.id ?? '')`. Pinned because a
     * future mapper reaching for `source_player_id` (a required STRING) would
     * otherwise assign a number and only find out at a type boundary — or not at
     * all, since this repo never typechecks its tests.
     */
    const ids = rosters2021.rosters.flatMap((r: { players?: { proPlayer: { id: unknown } }[] }) =>
      (r.players ?? []).map((x) => typeof x.proPlayer.id),
    )
    expect(new Set(ids)).toEqual(new Set(['number']))
  })

  it('and the draft cell carries the SAME proPlayer shape, so the join is direct', () => {
    const cell = picksOf(board)[0] as { player: { proPlayer: { id: unknown } } }
    expect(typeof cell.player.proPlayer.id).toBe('number')
  })
})
