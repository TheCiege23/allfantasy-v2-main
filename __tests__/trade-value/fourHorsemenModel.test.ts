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
  ALIAS_ONLY_FORMAT_IDS,
  CANONICAL_FORMAT_IDS,
  formatIdsWithoutValueModel,
  formatModelFor,
  formatModelForLeague,
  modelledFormatIds,
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
    /*
     * ⚠ `guillotine` WAS IN THIS LIST AND HAD TO COME OUT when it gained a model — the test went
     * red, which is the behaviour wanted. Every id here must be one with genuinely no model, or
     * this stops testing the fallback and starts testing a stale inventory.
     */
    for (const id of ['pirate', 'zombie', 'big_brother', 'redraft']) {
      expect(formatModelFor(id)).toBeNull()
    }
    expect(formatModelFor(null)).toBeNull()
    expect(formatModelFor('')).toBeNull()
  })

  it('reports its own coverage honestly', () => {
    expect(modelledFormatIds()).toEqual(['four_horsemen', 'guillotine'])
    /*
     * ⚠ THE ARITHMETIC IS DELIBERATELY EXPLICIT: guillotine IS a canonical format and now has a
     * model, so it leaves the gap list; Four Horsemen is a specific league that was never in it.
     * Two models, but only ONE of them reduces the count — writing that out is what stops the
     * next model being scored against a number nobody can reconstruct.
     */
    expect(formatIdsWithoutValueModel().length).toBe(
      CANONICAL_FORMAT_IDS.length + ALIAS_ONLY_FORMAT_IDS.length - 1,
    )
    expect(formatIdsWithoutValueModel()).not.toContain('four_horsemen')
    expect(formatIdsWithoutValueModel()).not.toContain('guillotine')
    expect(formatIdsWithoutValueModel()).toContain('tournament')
  })

  /*
   * ⚠ THE PREVIOUS VERSION OF THIS BLOCK ASSERTED `length === 16` AND `toContain('pirate')`, AND
   * BOTH WERE WRONG. The sixteen ids came from counting string occurrences across lib/ and app/,
   * which found three things that are not formats at all — `idol` and `exile` are Survivor
   * mechanics, `lottery` is `lib/draft-lottery/` — missed `c2c`, which IS a first-class format,
   * and listed `pirate` as though a league could present it as a `leagueType`. It cannot: see the
   * alias tests below. The list now comes from the `LeagueFormatId` definition site instead.
   */
  it('🛑 the canonical list matches the format-engine union, not a word count', () => {
    expect([...CANONICAL_FORMAT_IDS].sort()).toEqual([
      'best_ball', 'big_brother', 'c2c', 'devy', 'dynasty', 'guillotine',
      'keeper', 'redraft', 'salary_cap', 'survivor', 'tournament', 'zombie',
    ])
    // Not formats. Each was in the old sixteen and none belongs.
    for (const notAFormat of ['idol', 'exile', 'lottery']) {
      expect(CANONICAL_FORMAT_IDS).not.toContain(notAFormat)
      expect(ALIAS_ONLY_FORMAT_IDS).not.toContain(notAFormat)
    }
  })
})

describe('🛑 alias resolution — the four formats leagueType cannot express', () => {
  /*
   * `normalizeConcept.ts` flattens pirate_vampire and royal onto `dynasty`, and king_of_the_hill
   * and idp onto `redraft`. So for these leagues `leagueType` is actively misleading, and a
   * registry keyed on it resolves a dynasty model for a pirate league — or, today, nothing at all
   * while looking exactly like a correct null.
   *
   * There is no pirate model yet, so this cannot assert one resolves. What it CAN assert is that
   * the alias is consulted at all, using the one model that exists — which is the property that
   * makes writing a pirate model worth doing.
   */
  it('reads the alias tag in preference to the flattened leagueType', () => {
    const asPirateWould = formatModelForLeague({
      leagueType: 'dynasty',
      aliasTags: ['four_horsemen'],
    })
    expect(asPirateWould).toBe(fourHorsemenModel)
  })

  it('🛑 the narrow lookup is BLIND to it — which is why the wiring must not use it', () => {
    // The exact call the pre-fix wiring made. It finds nothing, and that null is indistinguishable
    // from an honest "this format has no model".
    expect(formatModelFor('dynasty')).toBeNull()
  })

  it('falls back to leagueType when no alias matches', () => {
    expect(formatModelForLeague({ leagueType: 'four_horsemen', aliasTags: ['royal'] }))
      .toBe(fourHorsemenModel)
    expect(formatModelForLeague({ leagueType: 'four_horsemen', aliasTags: [] }))
      .toBe(fourHorsemenModel)
  })

  it('still returns null for a league with no model by either route', () => {
    expect(formatModelForLeague({ leagueType: 'dynasty', aliasTags: ['pirate_vampire'] })).toBeNull()
    expect(formatModelForLeague({ leagueType: 'redraft', aliasTags: ['king_of_the_hill'] })).toBeNull()
    expect(formatModelForLeague(null)).toBeNull()
    expect(formatModelForLeague({})).toBeNull()
  })

  it('survives a malformed descriptor rather than throwing', () => {
    expect(() => formatModelForLeague({ aliasTags: [null as never, 42 as never] })).not.toThrow()
    expect(() => formatModelForLeague({ leagueType: null, isDynasty: true })).not.toThrow()
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
