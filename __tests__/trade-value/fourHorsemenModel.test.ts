/**
 * Four Horsemen — the first per-format value model.
 *
 * Every assertion traces to the league's actual rulebook, not to a category label. The fixture is
 * that league's real roster shape: 4 teams, 4 QB / 4 RB / 6 WR / 4 TE / 10 FLEX, 80-man rosters,
 * 10 taxi, 10 IR, trades closed after week 13.
 */

import { describe, expect, it } from 'vitest'
import { buildLeagueShape } from '@/lib/trade-value/leagueShape'
import {
  ELIMINATOR_STRIKES_TO_ELIMINATION,
  STASH_OPTIONALITY_BONUS,
  TAXI_MAX_EXPERIENCE,
  fourHorsemenModel,
} from '@/lib/trade-value/formats/fourHorsemen'
import {
  formatModelFor,
  modelledFormatIds,
  unmodelledFormatIds,
} from '@/lib/trade-value/formats/registry'

const FOUR_HORSEMEN_SLOTS = [
  ...Array(4).fill('QB'), ...Array(4).fill('RB'), ...Array(6).fill('WR'),
  ...Array(4).fill('TE'), ...Array(10).fill('FLEX'),
]

const shape = buildLeagueShape({
  teams: 4,
  starterSlots: FOUR_HORSEMEN_SLOTS,
  rosterSize: 80,
  irSlots: 10,
  taxiSlots: 10,
  deadlineWeek: 13,
})!

const base = { base: 5000, position: 'WR', shape } as const

describe('registry', () => {
  it('resolves Four Horsemen, case- and separator-insensitively', () => {
    expect(formatModelFor('four_horsemen')).toBe(fourHorsemenModel)
    expect(formatModelFor('Four-Horsemen')).toBe(fourHorsemenModel)
    expect(formatModelFor('FOUR HORSEMEN')).toBe(fourHorsemenModel)
  })

  it('🛑 returns NULL for an unmodelled format — never a generic default', () => {
    /*
     * A fallback model would apply somebody's guess about one format to another. That is exactly
     * what the census measured: all 16 formats priced identically at 6552 because no format-
     * specific opinion could travel through ScoringContext at all.
     */
    for (const id of ['pirate', 'guillotine', 'zombie', 'big_brother', 'redraft']) {
      expect(formatModelFor(id)).toBeNull()
    }
    expect(formatModelFor(null)).toBeNull()
    expect(formatModelFor('')).toBeNull()
  })

  it('reports its own coverage honestly', () => {
    expect(modelledFormatIds()).toEqual(['four_horsemen'])
    /*
     * ⚠ 1 modelled and 16 unmodelled is CORRECT, not an off-by-one. Four Horsemen is a specific
     * league, not one of the sixteen coded format types the census found — it appears in this repo
     * only as a league name. So every coded format is still unmodelled, and the registry says so
     * rather than letting one league's model imply coverage it does not have.
     */
    expect(unmodelledFormatIds().length).toBe(16)
    expect(unmodelledFormatIds()).not.toContain('four_horsemen')
    expect(unmodelledFormatIds()).toContain('pirate')
  })
})

describe('trade legality — the deadline is a rule, not a discount', () => {
  it('allows a trade before the deadline', () => {
    expect(fourHorsemenModel.canTrade!({ ...base, currentWeek: 12 }).ok).toBe(true)
    expect(fourHorsemenModel.canTrade!({ ...base, currentWeek: 13 }).ok).toBe(true)
  })

  it('refuses after it, and names the rule', () => {
    const r = fourHorsemenModel.canTrade!({ ...base, currentWeek: 14 })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/week 13/)
    expect(r.reason).toMatch(/reopen/i)
  })

  it('does not assume closed when the week is unknown', () => {
    expect(fourHorsemenModel.canTrade!({ ...base, currentWeek: null }).ok).toBe(true)
  })

  it('🛑 reads the deadline from the SHAPE, not from its own constant', () => {
    /*
     * The constant documents the rulebook; the shape carries what the league is configured with.
     * A model trusting its constant would tell a manager a trade is legal while the platform
     * refuses it.
     */
    const earlier = buildLeagueShape({
      teams: 4, starterSlots: FOUR_HORSEMEN_SLOTS, deadlineWeek: 10,
    })!
    expect(fourHorsemenModel.canTrade!({ ...base, shape: earlier, currentWeek: 11 }).ok).toBe(false)
    expect(fourHorsemenModel.canTrade!({ ...base, shape: earlier, currentWeek: 11 }).reason)
      .toMatch(/week 10/)
  })
})

describe('stash optionality — 20 free slots on an 80-man roster', () => {
  it('rewards a taxi-eligible young player', () => {
    const a = fourHorsemenModel.adjust({ ...base, experience: 1 })!
    expect(a.multiplier).toBe(STASH_OPTIONALITY_BONUS)
    expect(a.reason).toMatch(/taxi/i)
    expect(a.reason).toMatch(/costs this roster nothing/i)
  })

  it('applies at the eligibility boundary and not past it', () => {
    expect(fourHorsemenModel.adjust({ ...base, experience: TAXI_MAX_EXPERIENCE })?.multiplier)
      .toBe(STASH_OPTIONALITY_BONUS)
    // A 4-year player is not taxi-eligible under rules §4.
    expect(fourHorsemenModel.adjust({ ...base, experience: TAXI_MAX_EXPERIENCE + 1 })).toBeNull()
  })

  it('says nothing when experience is unknown — no guessing at eligibility', () => {
    expect(fourHorsemenModel.adjust({ ...base })).toBeNull()
    expect(fourHorsemenModel.adjust({ ...base, experience: null })).toBeNull()
  })

  it('does not fire in a league without meaningful stash capacity', () => {
    const shallow = buildLeagueShape({
      teams: 12, starterSlots: ['QB', 'RB', 'WR', 'TE', 'FLEX'], rosterSize: 15,
      irSlots: 1, taxiSlots: 0,
    })!
    expect(fourHorsemenModel.adjust({ ...base, shape: shallow, experience: 1 })).toBeNull()
  })
})

describe('the Eliminator — a second axis, reported not priced', () => {
  const withState = (s: Record<string, unknown>) =>
    fourHorsemenModel.adjust({ ...base, experience: 8, teamState: s })

  it('says nothing without strike data — it does not guess at state', () => {
    expect(fourHorsemenModel.adjust({ ...base, experience: 8 })).toBeNull()
    expect(withState({})).toBeNull()
    expect(withState({ eliminatorStrikes: 0 })).toBeNull()
  })

  it('warns hardest at one strike from elimination', () => {
    const a = withState({ eliminatorStrikes: ELIMINATOR_STRIKES_TO_ELIMINATION - 1 })!
    expect(a.reason).toMatch(/one more low week/i)
    expect(a.reason).toMatch(/floor/i)
  })

  it('mentions the count and the distance at earlier strikes', () => {
    const a = withState({ eliminatorStrikes: 1 })!
    expect(a.reason).toMatch(/1 Eliminator strike\b/)
    expect(a.reason).toMatch(/3 from elimination/)
  })

  it('flips the advice once the team is out of the pot', () => {
    const a = withState({ eliminatorEliminated: true })!
    expect(a.reason).toMatch(/no longer count/i)
    expect(a.reason).toMatch(/championship/i)
  })

  it('🛑 NEVER MOVES THE PRICE — strikes say which KIND of player to want', () => {
    /*
     * A strike count changes preference (floor over ceiling), not what an asset is worth in
     * absolute terms. Returning a multiplier here would let a side pot silently reprice the whole
     * board, so the payload is the reason and the multiplier stays exactly 1.0.
     */
    for (const s of [1, 2, 3]) {
      expect(withState({ eliminatorStrikes: s })!.multiplier).toBe(1.0)
    }
    expect(withState({ eliminatorEliminated: true })!.multiplier).toBe(1.0)
  })

  it('ignores a malformed teamState rather than throwing', () => {
    for (const s of ['strikes', 42, [], null]) {
      expect(() => fourHorsemenModel.adjust({ ...base, experience: 8, teamState: s })).not.toThrow()
    }
  })
})

describe('does not double-count what the shared engine already prices', () => {
  it('🛑 makes no adjustment for team count, slots or roster depth', () => {
    /*
     * `LeagueShape` already prices 4 teams, 4 QB starters, 10 flex and an 80-man roster through
     * demandMultiplier, and the pick curve already handles the 10-round rookie draft. A model that
     * re-applied any of them would price the same fact twice — the error that made `shape`
     * SUPERSEDE isSuperflex rather than multiply with it.
     *
     * So a veteran with no stash eligibility and no Eliminator state gets NO opinion at all, even
     * though every one of those structural facts is present in the shape.
     */
    expect(fourHorsemenModel.adjust({ ...base, position: 'QB', experience: 9 })).toBeNull()
    expect(fourHorsemenModel.adjust({ ...base, position: 'TE', experience: 6 })).toBeNull()
  })
})
