// @vitest-environment node
/**
 * `mapFleaflickerDraftBoard` — run against the COMMITTED fixtures, not hand-written
 * objects, so the mapper is tested on the two envelopes the vendor actually sends.
 *
 * 🛑 THE TWO FAILURES THIS GUARDS ARE BOTH SILENT:
 *
 * 1. Reading `slot.slot` instead of `slot.overall`. They are EQUAL IN ROUND 1, so a
 *    casual check passes and every later round then claims sixteen first-round picks.
 * 2. Branching on the season rather than on which key is present. That passes on the
 *    probed league and fails on the next one, because the season is a correlate of
 *    something unidentified rather than the rule. See G-10.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  mapFleaflickerDraftBoard,
  describeFleaflickerDraftCoverage,
} from '@/lib/league-import/fleaflicker/fleaflickerDraft'

const fx = (n: string) =>
  JSON.parse(readFileSync(`contracts/fleaflicker/fixtures/${n}`, 'utf8'))

const BOARD = fx('draftBoard.NFL.2019.json') // { draftOrder, rows, rosters }
const LIST = fx('draftBoard.NFL.2020.json') // { orderedSelections }
const EMPTY = fx('draftBoard.NFL.2021.empty.json') // {}

describe('both vendor envelopes map, and neither is special-cased by season', () => {
  it('the BOARD form yields picks', () => {
    const r = mapFleaflickerDraftBoard(BOARD, { season: 2019 })
    expect(r.envelope).toBe('board')
    expect(r.picks.length).toBeGreaterThan(0)
    expect(r.picks.length).toBe(r.cellCount)
    expect(r.skippedCount).toBe(0)
  })

  it('the LIST form yields picks through the same code path', () => {
    const r = mapFleaflickerDraftBoard(LIST, { season: 2020 })
    expect(r.envelope).toBe('list')
    expect(r.picks.length).toBeGreaterThan(0)
    expect(r.skippedCount).toBe(0)
  })

  it('🛑 the EMPTY form is reported as empty, NOT as a failure or as "no draft history"', () => {
    const r = mapFleaflickerDraftBoard(EMPTY)
    expect(r.envelope).toBe('empty')
    expect(r.picks).toEqual([])
    expect(describeFleaflickerDraftCoverage(r).state).toBe('missing')
    expect(describeFleaflickerDraftCoverage(r).note).toMatch(/other seasons/)
  })

  it('null and undefined are the empty case, not a throw', () => {
    expect(mapFleaflickerDraftBoard(null).envelope).toBe('empty')
    expect(mapFleaflickerDraftBoard(undefined).picks).toEqual([])
  })
})

describe('🛑 pick_no is the OVERALL number, which is the whole trap', () => {
  const all = [
    ...mapFleaflickerDraftBoard(BOARD, { season: 2019 }).picks,
    ...mapFleaflickerDraftBoard(LIST, { season: 2020 }).picks,
  ]

  it('there is at least one pick beyond round 1, or this suite proves nothing', () => {
    /*
     * ⚠ THE CONTROL FOR THE ASSERTION BELOW. `slot.slot` and `slot.overall` are equal
     * in round 1, so a fixture containing only first-round picks would pass the next
     * test with the WRONG field wired. Fail loudly if that ever becomes the case.
     */
    expect(all.some((p) => p.round > 1)).toBe(true)
  })

  it('pick_no matches the overall arithmetic, not the in-round slot', () => {
    /*
     * League size 16, measured from the fixtures: overall = (round-1)*16 + slot.
     * Reading `slot.slot` would give pick_no <= 16 on every row.
     */
    const beyondRound1 = all.filter((p) => p.round > 1)
    expect(beyondRound1.length).toBeGreaterThan(0)
    for (const p of beyondRound1) {
      expect(p.pick_no).toBeGreaterThan(16)
    }
  })

  it('and every pick_no is unique — the tell for in-round numbering', () => {
    /* In-round numbering repeats 1..16 once per round; overall never repeats. */
    const byRound = new Map<number, number[]>()
    for (const p of all) byRound.set(p.round, [...(byRound.get(p.round) ?? []), p.pick_no])
    const withinOneSource = mapFleaflickerDraftBoard(BOARD).picks.map((p) => p.pick_no)
    expect(new Set(withinOneSource).size).toBe(withinOneSource.length)
  })
})

describe('identity: ids become strings without being reformatted', () => {
  const r = mapFleaflickerDraftBoard(BOARD, { season: 2019 })

  it('player and roster ids are strings', () => {
    for (const p of r.picks) {
      expect(typeof p.source_player_id).toBe('string')
      expect(typeof p.source_roster_id).toBe('string')
    }
  })

  it('⚠ the string is the id VERBATIM — no numeric round-trip', () => {
    /*
     * This repo has already lost rows to `String(Number(x))`, which turns an MFL
     * "0001" into "1" and never joins again. Fleaflicker ids are integers today, so
     * the round-trip happens to be lossless — which is exactly why a future edit
     * could introduce it unnoticed. Pinned against the fixture's own bytes.
     */
    const firstCell = BOARD.rows[0].cells[0]
    expect(r.picks[0].source_player_id).toBe(String(firstCell.player.proPlayer.id))
    expect(r.picks[0].source_roster_id).toBe(String(firstCell.team.id))
  })

  it('carries the descriptive fields when present', () => {
    expect(r.picks[0].player_name).toBeTruthy()
    expect(r.picks[0].position).toBeTruthy()
    expect(r.picks[0].season).toBe(2019)
  })

  it('omits season entirely when not supplied, rather than writing null', () => {
    const noSeason = mapFleaflickerDraftBoard(BOARD)
    expect('season' in noSeason.picks[0]).toBe(false)
  })
})

describe('a cell that cannot become a pick is skipped, not coerced', () => {
  /*
   * 🛑 THE ALTERNATIVE IS WORSE THAN DROPPING IT. `source_player_id` is a required
   * string; writing `''` or `0` produces a row that counts as imported and that no
   * reader can ever resolve — the failure mode this repo records for ~42,000
   * unresolvable rows written by a SQL-side normalizer.
   */
  const withHoles = {
    rows: [
      {
        round: 1,
        cells: [
          BOARD.rows[0].cells[0],
          { team: { id: 1 }, slot: { round: 1, slot: 2, overall: 2 } }, // no player
          { player: { proPlayer: { id: 9 } }, slot: { round: 1, slot: 3, overall: 3 } }, // no team
          { team: { id: 1 }, player: { proPlayer: { id: 9 } } }, // no slot
        ],
      },
    ],
  }

  it('maps the good cell and skips the three broken ones', () => {
    const r = mapFleaflickerDraftBoard(withHoles)
    expect(r.cellCount).toBe(4)
    expect(r.picks).toHaveLength(1)
    expect(r.skippedCount).toBe(3)
  })

  it('and says so in the coverage note instead of reporting full', () => {
    const c = describeFleaflickerDraftCoverage(mapFleaflickerDraftBoard(withHoles))
    expect(c.state).toBe('partial')
    expect(c.note).toMatch(/1 of 4/)
  })

  it('a clean board reports full', () => {
    expect(describeFleaflickerDraftCoverage(mapFleaflickerDraftBoard(BOARD)).state).toBe('full')
  })
})

describe('the envelope is chosen by key presence, never by season', () => {
  it('rows wins when both are somehow present', () => {
    const r = mapFleaflickerDraftBoard({
      rows: [{ round: 1, cells: [BOARD.rows[0].cells[0]] }],
      orderedSelections: [LIST.orderedSelections[0]],
    })
    expect(r.envelope).toBe('board')
    expect(r.cellCount).toBe(1)
  })

  it('an unrecognised payload is empty rather than a throw', () => {
    expect(mapFleaflickerDraftBoard({ somethingElse: [1, 2] } as never).envelope).toBe('empty')
  })

  it('the mapper never reads a season field off the payload', () => {
    /*
     * Source assertion, comments stripped: the module must not branch on a year.
     * Its header explains the season divergence at length, so raw source would match
     * the prose that warns against the bug.
     */
    const raw = readFileSync('lib/league-import/fleaflicker/fleaflickerDraft.ts', 'utf8')
    const codeOnly = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
      .join('\n')
    expect(codeOnly).toContain('orderedSelections') // self-control: code survived
    expect(codeOnly).not.toMatch(/2019|2020|2021/)
  })
})
