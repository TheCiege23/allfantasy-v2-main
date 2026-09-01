import { describe, it, expect } from 'vitest'

import { monitorLeagueHealth } from '@/lib/league-health/league-health-engine'

/**
 * 6.1 / §2.23 — the activity score's base is EARNED by participation, not granted.
 *
 * ── 🛑 WHAT WAS WRONG ───────────────────────────────────────────────────────────────────────
 * `computeEngagement` opened with an unconditional `let score = 30`. Every other term is
 * non-negative, so 30 was a floor no input could get below: a league where nothing had happened
 * and nobody was left scored 30/100 under a label reading "Engagement". Not approximate — false.
 *
 * ⚠ AND THE FIX NEEDED NO NEW DATA. `activeManagers` was already declared by
 * `LeagueHealthInputSchema` and read NOWHERE in the engine. `commissionerHubHealth` has always
 * passed it (`teamCount - inactiveTeams`, inactive = roster untouched for 14 days).
 *
 * ── WHY THE FIRST TEST HERE IS THE MOST IMPORTANT ONE ───────────────────────────────────────
 * Nine production dashboards read this number. The change is only defensible if a fully-staffed
 * league sees NO movement at all, so that is pinned first and with an exact expected value
 * computed from the old formula by hand — not with a snapshot, which would have happily recorded
 * whatever the new code produced.
 */

/** The shape `monitorLeagueHealth` takes, with the fields under test left to each case. */
function input(over: Partial<Parameters<typeof monitorLeagueHealth>[0]> = {}) {
  return {
    sport: 'NFL',
    leagueType: 'dynasty',
    leagueId: 'test',
    numTeams: 12,
    currentWeek: 8,
    totalWeeks: 17,
    activeManagers: 12,
    inactiveManagers: 0,
    abandonedTeams: 0,
    lineupSubmissionRate: 1,
    totalTradesThisSeason: 0,
    totalWaiverClaims: 0,
    avgFaabSpentPct: 0,
    chatMessageCount: 0,
    voteCount: 0,
    disputeCount: 0,
    commissionerActionsThisSeason: 0,
    unresolvedDisputes: 0,
    playoffTeams: 6,
    ...over,
  } as Parameters<typeof monitorLeagueHealth>[0]
}

const engagement = (over: Parameters<typeof input>[0] = {}) => monitorLeagueHealth(input(over)).engagementScore

describe('engagement base is scaled by participation', () => {
  it('🛑 a fully-staffed league is UNCHANGED — nine dashboards must not move', () => {
    // Old formula, by hand: 30 (base) + min(20, 24/12*6=12) + min(20, 96/12*2.5=20)
    //                       + min(15, 120*0.3=36 -> 15) + 15 (lineup >= 0.95)  =  92
    expect(
      engagement({
        activeManagers: 12,
        totalTradesThisSeason: 24,
        totalWaiverClaims: 96,
        chatMessageCount: 120,
        lineupSubmissionRate: 1,
      }),
    ).toBe(92)

    // And the quiet-but-fully-staffed case: 30 + 0 + 0 + 0 + 15 = 45, also unchanged.
    expect(engagement({ activeManagers: 12, lineupSubmissionRate: 1 })).toBe(45)
  })

  it('🛑 a league nobody is left in scores ZERO, where it used to score 30', () => {
    expect(
      engagement({
        activeManagers: 0,
        inactiveManagers: 12,
        lineupSubmissionRate: 0,
      }),
    ).toBe(0)
  })

  it('scales the base proportionally rather than switching it off at a threshold', () => {
    // Half the managers gone: base 15 instead of 30, everything else untouched.
    const half = engagement({ activeManagers: 6, inactiveManagers: 6, lineupSubmissionRate: 0 })
    expect(half).toBe(15)
    // A cliff would make this equal to either 0 or 30; proportionality is the claim.
    expect(half).toBeGreaterThan(0)
    expect(half).toBeLessThan(30)
  })

  it('is monotonic in participation, all else equal', () => {
    const scores = [0, 3, 6, 9, 12].map((activeManagers) =>
      engagement({ activeManagers, inactiveManagers: 12 - activeManagers, lineupSubmissionRate: 0 }),
    )
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!).toBeGreaterThan(scores[i - 1]!)
    }
  })

  it('⚠ still credits a season that HAPPENED even after the league empties', () => {
    // Deliberate: "was busy, now dead" is a different situation from "never started", and
    // computeSustainability scores both 0 anyway. This pins the choice so a later change to it is
    // visible rather than accidental.
    const abandonedButActive = engagement({
      activeManagers: 0,
      inactiveManagers: 12,
      totalTradesThisSeason: 24,
      totalWaiverClaims: 96,
      lineupSubmissionRate: 0,
    })
    expect(abandonedButActive).toBeGreaterThan(0)
    expect(abandonedButActive).toBeLessThan(45)
  })

  it('clamps bad data rather than buying a base above 30', () => {
    // activeManagers > numTeams is not a licence to exceed the old ceiling.
    expect(engagement({ activeManagers: 999, lineupSubmissionRate: 1 })).toBe(45)
  })

  it('never leaves the 0–100 range', () => {
    for (const active of [-5, 0, 6, 12, 999]) {
      const s = engagement({ activeManagers: active, totalTradesThisSeason: 9999, chatMessageCount: 9999 })
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(100)
    }
  })
})

describe('what this does to the rules threshold', () => {
  /*
   * `commissioner-health/rules.ts` fires `engagement_low` on `engagementScore < 40`. That
   * threshold was calibrated against a scale whose floor was 30, so it could only ever fire in
   * the band [30, 39]. These pin what it now covers, so a later threshold change is a decision
   * rather than a discovery.
   */
  const fires = (over: Parameters<typeof input>[0]) => engagement(over) < 40

  it('a dormant league now fires, and used to fire only by luck of the narrow band', () => {
    expect(fires({ activeManagers: 0, inactiveManagers: 12, lineupSubmissionRate: 0 })).toBe(true)
  })

  it('a healthy league still does not fire', () => {
    expect(
      fires({ activeManagers: 12, totalTradesThisSeason: 24, totalWaiverClaims: 96, chatMessageCount: 120 }),
    ).toBe(false)
  })

  it('⚠ half the managers gone with light activity NEWLY fires — the real behaviour change', () => {
    /*
     * 6 of 12 active, 12 trades, no claims or chat, lineups submitted.
     *   before  30 (unconditional base) + 6 + 0 + 0 + 15 = 51  -> silent
     *   after   15 (base x 0.5)         + 6 + 0 + 0 + 15 = 36  -> warns
     *
     * A league that has lost half its managers and is coasting on lineup auto-submission is
     * exactly the one a commissioner should hear about, and it used to say nothing. This is the
     * change worth reviewing the threshold over, so it is pinned with both numbers rather than
     * described.
     */
    const score = engagement({
      activeManagers: 6,
      inactiveManagers: 6,
      totalTradesThisSeason: 12,
      lineupSubmissionRate: 1,
    })
    expect(score).toBe(36)
    expect(score).toBeLessThan(40) // warns now
    expect(score + 15).toBeGreaterThanOrEqual(40) // the old base of 30 put it at 51 — silent
  })

  it('⚠ and a league that only LOOKS busy does not newly fire on activity alone', () => {
    // 8 of 12 active with real volume: 20 + 6 + 5 + 15 = 46. Above the line before (56) and
    // after. Pinned so the change is understood as targeting participation, not activity.
    expect(
      engagement({
        activeManagers: 8,
        inactiveManagers: 4,
        totalTradesThisSeason: 12,
        totalWaiverClaims: 24,
        lineupSubmissionRate: 1,
      }),
    ).toBe(46)
  })
})
