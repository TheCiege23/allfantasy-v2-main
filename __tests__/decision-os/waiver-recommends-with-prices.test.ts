/**
 * 🛑 THE WAIVER ANSWER COULD NEVER BE A RECOMMENDATION. This runs the REAL deterministic scorer over
 * the input the bridge now assembles, because the bug was never in the scorer: it was fed names.
 *
 * Measured on origin/main 2026-09-17: `loadWaiverPool` sent `{id, name, position}`, `suggest.ts` read
 * `value` as 0, and `scoreWaiverCandidates` skips `value < 200` — so `suggestions` was always empty
 * and every waiver answer, Chimmy's included, was "Hold your FAAB/priority".
 *
 * ⚠ AND A PRICE ALONE WAS NOT ENOUGH, which is the reason this test exists rather than a unit test of
 * the price. With values but no roster context a 3,000-value back scores ~33 — "Monitor" — because
 * `needFit` falls to its neutral 20 and `findDropCandidate` has nothing to read. What produces an
 * answer is the whole input: prices, the asker's slotted roster, and every roster in the league.
 *
 * The scorer's own weights are pinned by its suite; nothing here asserts a score, only that a real
 * wire produces a real recommendation with a named drop, and that an unpriced wire says so instead.
 */
import { describe, expect, it } from 'vitest'

import { suggestWaiverPickups } from '@/lib/waiver-ai-engine/suggest'
import { computeTeamNeeds } from '@/lib/waiver-engine/team-needs'
import { buildWaiverDCO } from '@/lib/decision-os/waiver/dco'
import { decideWaiverClaim } from '@/lib/decision-os/waiver/decision'
import type { WaiverAIServiceInput } from '@/lib/waiver-ai-engine'
import { fakeWorld } from './waiverFakes'

/* A 12-team half-PPR league: I start a replacement-level RB and carry two cheap bench players. */
const MY_ROSTER = [
  { id: 'qb1', name: 'My QB', position: 'QB', team: 'BUF', slot: 'starter' as const, age: 28, value: 3200 },
  { id: 'rb-weak', name: 'Replacement RB', position: 'RB', team: 'NYG', slot: 'starter' as const, age: 29, value: 700 },
  { id: 'wr1', name: 'My WR', position: 'WR', team: 'MIA', slot: 'starter' as const, age: 26, value: 4100 },
  { id: 'te1', name: 'My TE', position: 'TE', team: 'KC', slot: 'starter' as const, age: 27, value: 2600 },
  { id: 'bench-cheap', name: 'Deep Bench WR', position: 'WR', team: 'CAR', slot: 'bench' as const, age: 30, value: 300 },
  { id: 'bench-mid', name: 'Bench RB', position: 'RB', team: 'LV', slot: 'bench' as const, age: 25, value: 1100 },
]

/* Eleven rivals whose starting backs are all better than mine — so RB is my weakest slot. */
const RIVAL = (n: number) => ({
  players: [
    { id: `r${n}-qb`, name: `QB ${n}`, position: 'QB', team: 'DAL', slot: 'starter' as const, age: 27, value: 3000 },
    { id: `r${n}-rb`, name: `RB ${n}`, position: 'RB', team: 'DAL', slot: 'starter' as const, age: 25, value: 3400 },
    { id: `r${n}-wr`, name: `WR ${n}`, position: 'WR', team: 'DAL', slot: 'starter' as const, age: 26, value: 3600 },
    { id: `r${n}-te`, name: `TE ${n}`, position: 'TE', team: 'DAL', slot: 'starter' as const, age: 28, value: 2400 },
  ],
})

const LEAGUE_ROSTERS = [{ players: MY_ROSTER }, ...Array.from({ length: 11 }, (_, i) => RIVAL(i + 1))]

function engineInput(over: Partial<WaiverAIServiceInput> = {}): WaiverAIServiceInput {
  return {
    sport: 'NFL',
    leagueId: 'L1',
    leagueSettings: { numTeams: 12, isSF: false, isTEP: false, isDynasty: false, faabBudget: 100, faabRemaining: 60 },
    roster: MY_ROSTER,
    rosterPositions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN', 'BN'],
    allLeagueRosters: LEAGUE_ROSTERS,
    currentWeek: 3,
    goal: 'balanced',
    maxResults: 8,
    availablePlayers: [
      { id: 'wire-rb', name: 'Waiver Back', position: 'RB', team: 'SEA', age: 24, value: 2600 },
      { id: 'wire-wr', name: 'Waiver Wideout', position: 'WR', team: 'TEN', age: 23, value: 1500 },
    ],
    ...over,
  } as WaiverAIServiceInput
}

const decide = async (input: WaiverAIServiceInput, pricing?: { priced: number; total: number; basis: string | null }) => {
  const { suggestions } = suggestWaiverPickups(input)
  const dco = buildWaiverDCO({
    world: fakeWorld(),
    userId: 'u1',
    leagueId: 'L1',
    sport: 'NFL',
    rosterId: 'roster-1',
    engineInput: input,
    pricing,
  })
  const decision = await decideWaiverClaim(dco, {
    recommend: async () => ({ deterministic: { suggestions } }) as never,
    ruleDeps: { loadRosterCounts: async () => ({ claimsThisPeriod: 0, dropsThisWeek: 0 }) } as never,
    newId: () => 'dec_test',
  })
  return { suggestions, decision }
}

describe('a priced wire produces a real waiver recommendation', () => {
  it('🛑 names an add — the answer that was impossible before prices reached the scorer', async () => {
    const { suggestions, decision } = await decide(engineInput())
    expect(suggestions.length).toBeGreaterThan(0)

    const top = suggestions[0]
    expect(top.playerName).toBe('Waiver Back')
    expect(decision.four_answers.what_happened).toMatch(/top add is Waiver Back \(RB\)/)
    expect(decision.four_answers.what_to_do).not.toMatch(/Hold your FAAB/)
    expect(decision.recommended_actions[0]?.addPlayerName).toBe('Waiver Back')
    /*
     * ⚠ THE STRENGTH WORD IS THE ENGINE'S OWN, AND IT IS NOT ASSERTED HERE. Measured against the
     * scorer's thresholds with this roster: "Add" needs a ~4,000-value target on the win-now goal and
     * ~6,000 on balanced, so a realistic wire player reads "Monitor" while still being named, ranked,
     * bid for and paired with a drop. Whether that threshold is right is a calibration question for
     * whoever owns the scorer, not something this input fix should paper over.
     */
    expect(['Must Add', 'Strong Add', 'Add', 'Stash', 'Monitor']).toContain(top.recommendation)
  })

  it('🛑 names a drop, which needed the asker’s own roster', async () => {
    const { suggestions, decision } = await decide(engineInput())
    /* The same-position drop, which is better advice than the cheapest bench body. */
    expect(suggestions[0].dropCandidate?.name).toBe('Bench RB')
    expect(decision.recommended_actions[0]?.dropPlayerName).toBe('Bench RB')
  })

  it('attaches a FAAB bid inside the budget', async () => {
    const { suggestions } = await decide(engineInput())
    const bid = suggestions[0].faabBid ?? 0
    expect(bid).toBeGreaterThan(0)
    expect(bid).toBeLessThanOrEqual(60)
  })

  it('ranks the better-priced player first, so the price is doing the work', async () => {
    const { suggestions } = await decide(engineInput())
    expect(suggestions.map((s) => s.playerName)).toEqual(['Waiver Back', 'Waiver Wideout'])
  })

  /*
   * 🛑 THE BYE SLATE REACHES THE SCORER, AND IT IS THIS SEASON'S. `team-needs.ts` used to read a
   * hardcoded 2025 table, so the "covers your bye" driver named last year's weeks. The slate is now
   * passed in, and this asserts it survives the whole engine path rather than only the unit that
   * consumes it.
   */
  it('🛑 names the bye it covers, from the slate it was given', async () => {
    const withBye = engineInput({
      /* Both my starting backs are out in week 8, and the wire back is not. */
      roster: [
        ...MY_ROSTER.filter((p) => p.id !== 'bench-mid'),
        { id: 'rb2', name: 'Second RB', position: 'RB', team: 'NYG', slot: 'starter' as const, age: 27, value: 900 },
      ],
    })
    /* Precomputed the way the pool does it, with this season's slate. */
    withBye.teamNeeds = computeTeamNeeds(
      withBye.roster!,
      withBye.rosterPositions!,
      withBye.allLeagueRosters!,
      3,
      { NYG: 8, SEA: 12 },
    )
    const { suggestions } = await decide(withBye)
    const driver = suggestions[0].drivers?.find((d) => d.id === 'wa_bye_week_fill')
    expect(driver?.detail).toMatch(/Covers Wk 8 bye/)
  })

  it('🛑 and says nothing about byes when the schedule could not answer', async () => {
    const noSlate = engineInput({
      roster: [
        ...MY_ROSTER.filter((p) => p.id !== 'bench-mid'),
        { id: 'rb2', name: 'Second RB', position: 'RB', team: 'NYG', slot: 'starter' as const, age: 27, value: 900 },
      ],
    })
    noSlate.teamNeeds = computeTeamNeeds(noSlate.roster!, noSlate.rosterPositions!, noSlate.allLeagueRosters!, 3, {})
    const { suggestions } = await decide(noSlate)
    expect(suggestions[0].drivers?.some((d) => d.id === 'wa_bye_week_fill')).toBe(false)
  })

  /* The regression itself: the old input shape, name-only, through the same real scorer. */
  it('🛑 the OLD input shape still produces nothing — which is why every answer was "Hold your FAAB"', async () => {
    const nameOnly = engineInput({
      roster: undefined,
      rosterPositions: undefined,
      allLeagueRosters: undefined,
      availablePlayers: [
        { id: 'wire-rb', name: 'Waiver Back', position: 'RB' },
        { id: 'wire-wr', name: 'Waiver Wideout', position: 'WR' },
      ],
    })
    const { suggestions, decision } = await decide(nameOnly, { priced: 0, total: 2, basis: null })
    expect(suggestions).toEqual([])
    expect(decision.four_answers.what_to_do).toMatch(/re-check once this league has market values/)
  })
})

describe('an unpriced wire is said, not reported as "nobody qualifies"', () => {
  it('🛑 says the wire could not be priced, and that it is not a judgement', async () => {
    const { decision } = await decide(
      engineInput({ availablePlayers: [{ id: 'wire-rb', name: 'Waiver Back', position: 'RB', value: 0 }] }),
      { priced: 0, total: 1, basis: null },
    )
    expect(decision.four_answers.what_happened).toMatch(/could not be priced for this league/)
    expect(decision.four_answers.why_it_matters).toMatch(/not a judgement that nobody is worth adding/)
    expect(decision.four_answers.what_happened).not.toMatch(/no qualifying targets/)
  })

  it('a priced wire with genuinely weak targets still says "no qualifying targets"', async () => {
    /* ⚠ The other empty answer, and it must keep its own words: we looked, and nobody was worth it. */
    const { decision } = await decide(
      engineInput({ availablePlayers: [{ id: 'junk', name: 'Waiver Junk', position: 'RB', age: 31, value: 120 }] }),
      { priced: 1, total: 1, basis: 'redraft, 1QB, 12 teams, 0.5 PPR' },
    )
    expect(decision.four_answers.what_happened).toMatch(/no qualifying targets/)
    expect(decision.four_answers.what_to_do).toMatch(/Hold your FAAB/)
  })

  it('🛑 with no pricing passed, the DCO reads the candidates themselves', async () => {
    /*
     * A caller that priced the wire says so; one that did not is read from what it supplied, because
     * a value on the candidate IS the price. Counting the candidates instead would call a name-only
     * pool fully priced — the exact reading that hid this bug.
     */
    const bare = buildWaiverDCO({
      world: fakeWorld(),
      userId: 'u1',
      leagueId: 'L1',
      sport: 'NFL',
      rosterId: 'roster-1',
      engineInput: engineInput({ availablePlayers: [{ id: 'a', name: 'A', position: 'RB' }] }),
    })
    expect(bare.pricing).toEqual({ priced: 0, total: 1, basis: null })
    expect(bare.data_completeness).toBeLessThanOrEqual(30)
    expect(bare.uncertainty.join(' ')).toMatch(/could not be priced/)

    const valued = buildWaiverDCO({
      world: fakeWorld(),
      userId: 'u1',
      leagueId: 'L1',
      sport: 'NFL',
      rosterId: 'roster-1',
      engineInput: engineInput(),
    })
    expect(valued.pricing).toEqual({ priced: 2, total: 2, basis: null })
    expect(valued.data_completeness).toBe(100)
  })

  it('an unpriced wire drops data completeness rather than passing as complete', async () => {
    const dco = buildWaiverDCO({
      world: fakeWorld(),
      userId: 'u1',
      leagueId: 'L1',
      sport: 'NFL',
      rosterId: 'roster-1',
      engineInput: engineInput({ availablePlayers: [{ id: 'a', name: 'A', position: 'RB' }] }),
      pricing: { priced: 0, total: 1, basis: null },
    })
    expect(dco.data_completeness).toBeLessThanOrEqual(30)
    expect(dco.uncertainty.join(' ')).toMatch(/could not be priced/)
  })
})
