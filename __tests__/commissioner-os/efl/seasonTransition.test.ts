import { describe, expect, it } from 'vitest'

import { resolveEflSeasonTransitions, resolveEflTierRoles } from '@/lib/commissioner-os/efl/seasonTransitionResolver'
import { EFL_DEFAULT_TRANSITION_CONFIG } from '@/lib/commissioner-os/efl/types'
import { ALL_OUTCOMES, ALL_TIERS, teamId, tier } from './fixtures'

const resolve = (over: Partial<Parameters<typeof resolveEflSeasonTransitions>[0]> = {}) =>
  resolveEflSeasonTransitions({
    leagueId: 'efl-1',
    season: 2026,
    tiers: ALL_TIERS,
    playoffOutcomes: ALL_OUTCOMES,
    ...over,
  })

const movers = (list: { teamId: string }[]) => list.map((t) => t.teamId).sort()

describe('the ladder is four tiers and tier 1 is the highest', () => {
  it('resolves all four tiers', () => {
    const roles = resolveEflTierRoles(ALL_TIERS)
    expect([...roles.keys()]).toEqual([1, 2, 3, 4])
  })

  it('a Premier League relegation goes DOWN to the Championship', () => {
    /*
     * 🛑 THE ORIENTATION TEST. `LeagueDivision.tierLevel` ascends downward, so a relegation must
     * INCREASE the tier level. If this ever reads `toTierLevel: 0` somebody has inverted the ladder
     * and the champions are being relegated.
     */
    const t = resolve().automaticTransitions.find((x) => x.teamId === teamId(1, 8))!
    expect(t.type).toBe('relegation')
    expect(t.fromTierLevel).toBe(1)
    expect(t.toTierLevel).toBe(2)
  })

  it('a League 2 promotion goes UP to League 1', () => {
    const t = resolve().automaticTransitions.find((x) => x.teamId === teamId(4, 1))!
    expect(t.type).toBe('promotion')
    expect(t.fromTierLevel).toBe(4)
    expect(t.toTierLevel).toBe(3)
  })

  it('transitions carry real division ids, not tier numbers', () => {
    const t = resolve().automaticTransitions.find((x) => x.teamId === teamId(4, 1))!
    expect(t.fromDivisionId).toBe('div-4')
    expect(t.toDivisionId).toBe('div-3')
  })
})

describe('the two structural exemptions hold', () => {
  it('League 2 never relegates', () => {
    const plan = resolve()
    const all = [...plan.automaticTransitions, ...plan.resolvedPlayoffTransitions]
    expect(all.filter((t) => t.fromTierLevel === 4 && t.type === 'relegation')).toEqual([])
  })

  it('League 2 stays protected by the CONFIG even when a fifth tier exists below it', () => {
    /*
     * 🛑 ADDED AFTER A MUTATION TEST EXPOSED THE ASSERTION ABOVE AS PASSING FOR THE WRONG REASON.
     * Deleting the config exemption entirely — leaving only the adjacency guard — left "League 2
     * never relegates" GREEN, because in a four-tier ladder League 2 is also the bottom tier and
     * adjacency alone protects it. The two guards were indistinguishable from the outside.
     *
     * Here a fifth tier exists, so adjacency permits relegation and ONLY the config exemption can
     * refuse it. This is the case that actually pins the branch.
     */
    const tier5 = { ...tier(4), tierLevel: 5, divisionId: 'div-5', label: 'League 3' }
    const plan = resolve({
      tiers: [...ALL_TIERS, { ...tier5, teams: tier5.teams.map((t) => ({ ...t, teamId: `t5-${t.rank}` })) }],
      playoffOutcomes: [],
    })
    const down = plan.automaticTransitions.filter((t) => t.fromTierLevel === 4 && t.type === 'relegation')
    expect(down).toEqual([])
    /* And the exemption is specific: League 1 above it still drops into League 2. */
    expect(plan.automaticTransitions.some((t) => t.fromTierLevel === 3 && t.toTierLevel === 4)).toBe(true)
  })

  it('the Premier League never promotes', () => {
    const plan = resolve()
    const all = [...plan.automaticTransitions, ...plan.resolvedPlayoffTransitions]
    expect(all.filter((t) => t.fromTierLevel === 1 && t.type === 'promotion')).toEqual([])
  })

  it('League 2 has no relegation playoff to seed', () => {
    expect(resolve({ playoffOutcomes: [] }).pendingPlayoffs.filter(
      (p) => p.tierLevel === 4 && p.kind === 'relegation',
    )).toEqual([])
  })

  it('the Premier League has no promotion playoff to seed', () => {
    expect(resolve({ playoffOutcomes: [] }).pendingPlayoffs.filter(
      (p) => p.tierLevel === 1 && p.kind === 'promotion',
    )).toEqual([])
  })

  it('the config exemption is honoured even when a tier below exists', () => {
    /*
     * ⚠ THE CONFIG AND THE ADJACENCY GUARD ARE INDEPENDENT. Exempting a MIDDLE tier must work — a
     * commissioner who protects the Championship for a season expects that to hold even though
     * League 1 sits underneath it.
     */
    const plan = resolve({
      config: { ...EFL_DEFAULT_TRANSITION_CONFIG, noRelegationFromTierLevels: [2, 4] },
    })
    const all = [...plan.automaticTransitions, ...plan.resolvedPlayoffTransitions]
    expect(all.filter((t) => t.fromTierLevel === 2 && t.type === 'relegation')).toEqual([])
    /* And League 1, which is not exempt, still relegates. */
    expect(all.some((t) => t.fromTierLevel === 3 && t.type === 'relegation')).toBe(true)
  })
})

describe('automatic movement comes from the regular season alone', () => {
  it('the bottom team of each eligible tier auto-relegates', () => {
    const auto = resolve().automaticTransitions.filter((t) => t.type === 'relegation')
    expect(movers(auto)).toEqual([teamId(1, 8), teamId(2, 8), teamId(3, 8)].sort())
  })

  it('the winner of each eligible tier auto-promotes', () => {
    const auto = resolve().automaticTransitions.filter((t) => t.type === 'promotion')
    expect(movers(auto)).toEqual([teamId(2, 1), teamId(3, 1), teamId(4, 1)].sort())
  })

  it('automatic movement is known even with no playoff results at all', () => {
    expect(resolve({ playoffOutcomes: [] }).automaticTransitions).toHaveLength(6)
  })
})

describe('playoff participants are 2nd/3rd up and the two above the drop', () => {
  const pending = resolve({ playoffOutcomes: [] }).pendingPlayoffs

  it('the promotion playoff is 2nd and 3rd', () => {
    const p = pending.find((x) => x.kind === 'promotion' && x.tierLevel === 4)!
    expect(p.participants.map((t) => t.rank)).toEqual([2, 3])
  })

  it('the relegation playoff is the next two above the bottom team', () => {
    const p = pending.find((x) => x.kind === 'relegation' && x.tierLevel === 3)!
    expect(p.participants.map((t) => t.rank)).toEqual([6, 7])
  })

  it('every open playoff is listed with a reason', () => {
    /* Three promotion playoffs (tiers 4,3,2) and three relegation playoffs (tiers 3,2,1). */
    expect(pending).toHaveLength(6)
    expect(pending.every((p) => p.reason.length > 0)).toBe(true)
  })
})

describe('an unresolved playoff is pending, never guessed', () => {
  const plan = resolve({ playoffOutcomes: [] })

  it('suppresses the final plan entirely', () => {
    /*
     * 🛑 NULL, NOT A SHORTER LIST. A partial ladder applied is worse than none — some teams move
     * and others are stranded in a tier that no longer has room for them.
     */
    expect(plan.finalTransitions).toBeNull()
  })

  it('names what is missing', () => {
    expect(plan.unresolvedReasons).toHaveLength(6)
    expect(plan.unresolvedReasons.join(' ')).toMatch(/no recorded result/i)
  })

  it('invents no playoff-decided transition', () => {
    expect(plan.resolvedPlayoffTransitions).toEqual([])
  })

  it('a partially played season reports only the playoffs still open', () => {
    const partial = resolve({ playoffOutcomes: ALL_OUTCOMES.slice(0, 2) })
    expect(partial.resolvedPlayoffTransitions).toHaveLength(2)
    expect(partial.pendingPlayoffs).toHaveLength(4)
    expect(partial.finalTransitions).toBeNull()
  })
})

describe('a known playoff result produces the right movement', () => {
  const plan = resolve()

  it('the promotion playoff WINNER goes up', () => {
    const t = plan.resolvedPlayoffTransitions.find((x) => x.teamId === teamId(4, 2))!
    expect(t.type).toBe('promotion')
    expect(t.toTierLevel).toBe(3)
    /* And the loser stays put. */
    expect(plan.resolvedPlayoffTransitions.some((x) => x.teamId === teamId(4, 3))).toBe(false)
  })

  it('the relegation playoff LOSER goes down', () => {
    const t = plan.resolvedPlayoffTransitions.find((x) => x.teamId === teamId(3, 7))!
    expect(t.type).toBe('relegation')
    expect(t.toTierLevel).toBe(4)
    /* And the winner stays up. */
    expect(plan.resolvedPlayoffTransitions.some((x) => x.teamId === teamId(3, 6))).toBe(false)
  })

  it('settles into exactly twelve moves — two up and two down between each adjacent pair', () => {
    expect(plan.finalTransitions).not.toBeNull()
    expect(plan.finalTransitions!).toHaveLength(12)
    expect(plan.unresolvedReasons).toEqual([])
    expect(plan.conflicts).toEqual([])
  })

  it('is deterministic and stable regardless of the order tiers are supplied in', () => {
    const shuffled = resolve({ tiers: [tier(3), tier(1), tier(4), tier(2)] })
    expect(JSON.stringify(shuffled.finalTransitions)).toBe(JSON.stringify(plan.finalTransitions))
  })
})

describe('contradictions are refused, not resolved', () => {
  it('no team receives two transitions in a clean season', () => {
    const plan = resolve()
    const ids = plan.finalTransitions!.map((t) => t.teamId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('an outcome naming a team that never qualified is a conflict', () => {
    /*
     * 🛑 THE TEAM THAT FINISHED FIRST DID NOT PLAY IN THE PROMOTION PLAYOFF — it went up
     * automatically. Accepting this outcome would promote it twice and move a team that never
     * qualified, with nothing downstream to catch it.
     */
    const plan = resolve({
      playoffOutcomes: [
        { kind: 'promotion', tierLevel: 4, winnerTeamId: teamId(4, 1), loserTeamId: teamId(4, 3) },
      ],
    })
    expect(plan.conflicts.join(' ')).toMatch(/did not qualify/i)
    expect(plan.finalTransitions).toBeNull()
  })

  it('an outcome naming the same team twice is a conflict', () => {
    const plan = resolve({
      playoffOutcomes: [
        { kind: 'promotion', tierLevel: 4, winnerTeamId: teamId(4, 2), loserTeamId: teamId(4, 2) },
      ],
    })
    expect(plan.conflicts.join(' ')).toMatch(/same team/i)
    expect(plan.finalTransitions).toBeNull()
  })
})

describe('the rules are configurable, not hardcoded', () => {
  it('two automatic relegations per tier is a config change, not a code change', () => {
    const plan = resolve({
      config: { ...EFL_DEFAULT_TRANSITION_CONFIG, autoRelegateCount: 2 },
      playoffOutcomes: [],
    })
    const down = plan.automaticTransitions.filter((t) => t.type === 'relegation' && t.fromTierLevel === 3)
    expect(movers(down)).toEqual([teamId(3, 7), teamId(3, 8)].sort())
  })

  it('turning the promotion playoff off removes it from the pending list', () => {
    const plan = resolve({
      config: { ...EFL_DEFAULT_TRANSITION_CONFIG, promotionPlayoffCount: 0 },
      playoffOutcomes: [],
    })
    expect(plan.pendingPlayoffs.filter((p) => p.kind === 'promotion')).toEqual([])
    expect(plan.pendingPlayoffs.filter((p) => p.kind === 'relegation')).toHaveLength(3)
  })
})
