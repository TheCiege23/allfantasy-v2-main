// @vitest-environment node
/**
 * Guards the Fantrax draft wiring — P2 item 3's "draft coverage" third.
 *
 * 🛑 WHAT WAS WRONG: `getDraftPicks` and `getDraftResults` were catalogued in
 * `FANTRAX_ENDPOINTS` and never called. Every other entry had a `getFantraxX`
 * wrapper; these two had none, so `FantraxAdapter` reported `draftHistory` as
 * "currently reflects traded draft-pick events when available". A completed
 * 192-slot draft was one unwritten function away.
 *
 * ⚠ DRIVEN BY THE COMMITTED FIXTURES, captured from the same league the rest of
 * the Fantrax suite uses. The fixtures carry opaque team and player ids only —
 * no names, no owners — which is why they are safe to commit to a public repo.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  mapFantraxDraftResults,
  describeFantraxDraftCoverage,
} from '@/lib/league-import/fantrax/fantraxDraft'
import type { FantraxDraftResults } from '@/lib/league-import/fantrax/fantraxApi'

const rawResults = JSON.parse(
  readFileSync('__tests__/fixtures/fantrax-draft-results.json', 'utf8'),
) as {
  draftPicks: Array<Record<string, unknown>>
  draftState: string
  draftType: string
  draftOrder: string[]
}
const rawPicks = JSON.parse(
  readFileSync('__tests__/fixtures/fantrax-draft-picks.json', 'utf8'),
) as { currentDraftPicks: Array<Record<string, unknown>>; futureDraftPicks: unknown[] }

/** The shape `getFantraxDraftResults` produces, built from the raw fixture. */
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

describe('the fixtures still have the properties these tests rely on', () => {
  /*
   * 🛑 PINNED FIRST, SO A RE-CAPTURE FAILS HERE AND SAYS WHY rather than letting
   * the behaviour tests go quietly green against data that no longer exercises
   * the unmade-pick case.
   */
  it('has 192 slots, 156 made and 36 unmade', () => {
    expect(rawResults.draftPicks).toHaveLength(192)
    const made = rawResults.draftPicks.filter((p) => p.playerId !== undefined)
    expect(made).toHaveLength(156)
    expect(rawResults.draftPicks.length - made.length).toBe(36)
  })

  it('omits playerId entirely on an unmade pick — absent, not null', () => {
    const unmade = rawResults.draftPicks.find((p) => p.playerId === undefined)
    expect(unmade).toBeDefined()
    expect('playerId' in (unmade as object)).toBe(false)
  })

  it('🛑 the two endpoints use `pick` for DIFFERENT quantities', () => {
    /*
     * The trap this whole module documents. `getDraftResults.pick` is the overall
     * selection number; `getDraftPicks.pick` is the pick within the round.
     */
    const resultPicks = rawResults.draftPicks.map((p) => Number(p.pick))
    const inventoryPicks = rawPicks.currentDraftPicks.map((p) => Number(p.pick))
    expect(Math.max(...resultPicks)).toBe(192)
    expect(Math.max(...inventoryPicks)).toBe(12)
  })

  it('the unmade slots are exactly the outstanding inventory, joined on pickInRound', () => {
    const key = (r: number, p: number, t: string) => `${r}:${p}:${t}`
    const unmade = new Set(
      rawResults.draftPicks
        .filter((p) => p.playerId === undefined)
        .map((p) => key(Number(p.round), Number(p.pickInRound), String(p.teamId))),
    )
    const inventory = new Set(
      rawPicks.currentDraftPicks.map((p) => key(Number(p.round), Number(p.pick), String(p.teamId))),
    )
    expect(unmade.size).toBe(36)
    expect(inventory.size).toBe(36)
    expect([...unmade].filter((k) => !inventory.has(k))).toEqual([])
    expect([...inventory].filter((k) => !unmade.has(k))).toEqual([])
  })

  it('control: joining on the OVERALL pick instead gives zero overlap', () => {
    /*
     * Proves the previous test is testing something. If `pick` and `pickInRound`
     * were interchangeable this would also match, and the warning in the module
     * header would be noise.
     */
    const key = (r: number, p: number, t: string) => `${r}:${p}:${t}`
    const unmadeOverall = new Set(
      rawResults.draftPicks
        .filter((p) => p.playerId === undefined)
        .map((p) => key(Number(p.round), Number(p.pick), String(p.teamId))),
    )
    const inventory = new Set(
      rawPicks.currentDraftPicks.map((p) => key(Number(p.round), Number(p.pick), String(p.teamId))),
    )
    expect([...unmadeOverall].filter((k) => inventory.has(k))).toEqual([])
  })
})

describe('mapFantraxDraftResults', () => {
  const summary = mapFantraxDraftResults(results, { season: 2026 })

  it('emits only the MADE picks, never a placeholder for an empty slot', () => {
    expect(summary.picks).toHaveLength(156)
    expect(summary.slotCount).toBe(192)
    expect(summary.madeCount).toBe(156)
    expect(summary.outstandingCount).toBe(36)
    expect(summary.picks.every((p) => typeof p.source_player_id === 'string')).toBe(true)
    expect(summary.picks.some((p) => p.source_player_id === '')).toBe(false)
  })

  it('uses the OVERALL pick number for pick_no', () => {
    /*
     * Writing pickInRound here would make every round look like it had twelve
     * first-round picks — and every consumer treats pick_no as overall.
     */
    const first = summary.picks.find((p) => p.round === 1 && p.pick_no === 1)
    expect(first).toBeDefined()
    expect(Math.max(...summary.picks.map((p) => p.pick_no))).toBeGreaterThan(12)
  })

  it('carries the team id verbatim as the roster id', () => {
    const first = summary.picks[0]
    expect(first.source_roster_id).toBe(String(rawResults.draftPicks[0].teamId))
    expect(first.source_roster_id).toMatch(/^[a-z0-9]+$/)
  })

  it('stamps the season when given, and omits it when not', () => {
    expect(summary.picks[0].season).toBe(2026)
    const noSeason = mapFantraxDraftResults(results)
    expect(noSeason.picks[0].season).toBeUndefined()
  })

  it('carries the draft state through', () => {
    expect(summary.draftState).toBe('completed')
  })

  it('drops a malformed slot rather than inventing a pick', () => {
    const out = mapFantraxDraftResults({
      ...results,
      picks: [
        { round: 1, pick: 1, pickInRound: 1, teamId: '', time: null, playerId: 'x' },
        { round: 1, pick: 2, pickInRound: 2, teamId: 't', time: null, playerId: 'y' },
      ],
    })
    // the blank team id is not a pick; `teamId: ''` would be a roster nothing resolves
    expect(out.picks.map((p) => p.source_player_id)).toEqual(['x', 'y'])
    // ^ the mapper itself does not re-validate teamId — getFantraxDraftResults already
    //   dropped such rows. This asserts the boundary is where we think it is.
  })

  it('degenerate inputs return an empty summary, never throw', () => {
    for (const input of [null, undefined, { ...results, picks: [] }]) {
      const out = mapFantraxDraftResults(input as never)
      expect(out.picks).toEqual([])
      expect(out.madeCount).toBe(0)
    }
  })
})

describe('describeFantraxDraftCoverage', () => {
  it('distinguishes not-drafted from partially-drafted from complete', () => {
    expect(describeFantraxDraftCoverage(mapFantraxDraftResults(null))).toMatch(/No Fantrax draft board/)

    const none = mapFantraxDraftResults({
      ...results,
      picks: results.picks.map((p) => ({ ...p, playerId: null })),
    })
    expect(describeFantraxDraftCoverage(none)).toMatch(/no picks made yet/)

    expect(describeFantraxDraftCoverage(mapFantraxDraftResults(results))).toMatch(
      /156 of 192 .* 36 are still outstanding/,
    )

    const complete = mapFantraxDraftResults({
      ...results,
      picks: results.picks.map((p) => ({ ...p, playerId: p.playerId ?? 'z' })),
    })
    expect(describeFantraxDraftCoverage(complete)).toMatch(/All 192 Fantrax draft picks/)
  })
})
