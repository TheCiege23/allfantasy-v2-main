import { describe, it, expect } from 'vitest'

import { computeActivityScore } from '@/lib/league-health/activityScore'
import { monitorLeagueHealth } from '@/lib/league-health/league-health-engine'
import { analyzeCommissionerDashboard } from '@/lib/commissioner-assistant/commissioner-assistant-engine'

/**
 * 6.1 — the collapse. ONE activity formula, two callers.
 *
 * ── 🛑 WHAT THERE USED TO BE ────────────────────────────────────────────────────────────────
 *   league-health   base 30 + min(20, trades×6) + min(20, claims×2.5) + min(15, chat×0.3)
 *                           + 15 (lineup ≥ .95) or 8 (≥ .8)
 *   assistant       base 40 + min(25, trades×8) + min(25, claims×3)   + 10 if none inactive
 *
 * Two private `computeEngagement`s, both labelled engagement, both 0–100, disagreeing by 10 points
 * on an empty league — and neither able to report one as dead.
 *
 * ── ⚠ THE TWO THINGS THIS SUITE EXISTS TO HOLD ──────────────────────────────────────────────
 * 1. league-health's numbers must NOT MOVE. Nine dashboards read them.
 * 2. `null` is not `0`. The assistant has no chat or lineup signal, and scoring those as zero
 *    would cap it at 70 against its own `>= 60` "good engagement" threshold — a silent regression
 *    dressed as a cleanup.
 */

const full = {
  activeManagers: 12,
  numTeams: 12,
  totalTrades: 24,
  totalWaiverClaims: 96,
  chatMessageCount: 120,
  lineupSubmissionRate: 1,
}

describe('the shared formula', () => {
  it('🛑 reproduces league-health exactly — nine dashboards depend on it', () => {
    // Old formula by hand: 30 + min(20, 24/12*6=12) + min(20, 96/12*2.5=20)
    //                         + min(15, 120*0.3=36→15) + 15  =  92
    expect(computeActivityScore(full)).toBe(92)
  })

  it('a league nobody is left in scores 0, with or without the optional terms', () => {
    const dead = { ...full, activeManagers: 0, totalTrades: 0, totalWaiverClaims: 0, chatMessageCount: 0, lineupSubmissionRate: 0 }
    expect(computeActivityScore(dead)).toBe(0)
    expect(computeActivityScore({ ...dead, chatMessageCount: null, lineupSubmissionRate: null })).toBe(0)
  })

  it('🛑 ABSENT IS NOT ZERO — a caller is not punished for a field it was never given', () => {
    const measuredZero = { ...full, chatMessageCount: 0, lineupSubmissionRate: 0 }
    const notMeasured = { ...full, chatMessageCount: null, lineupSubmissionRate: null }

    // Measured-as-zero scores 0 out of those weights; unavailable drops them from the denominator.
    expect(computeActivityScore(measuredZero)).toBeLessThan(computeActivityScore(notMeasured))

    /*
     * And the reduced form still SPANS the full range — the point of normalising rather than
     * truncating. It needs the two remaining terms actually maxed: 40 trades over 12 teams caps
     * the trade weight (40/12 × 6 = 20), and 96 claims caps the claim weight (96/12 × 2.5 = 20).
     *
     * ⚠ `full` does not reach 100 here and that is not a bug: 24 trades earns only 12 of its 20.
     * An earlier version of this test asserted 100 against `full` and got 89, which is the
     * arithmetic being right and the assertion being lazy.
     */
    const maxedWithoutOptional = {
      activeManagers: 12,
      numTeams: 12,
      totalTrades: 40,
      totalWaiverClaims: 96,
      chatMessageCount: null,
      lineupSubmissionRate: null,
    }
    expect(computeActivityScore(maxedWithoutOptional)).toBe(100)
  })

  it('keeps 0–100 whatever it is handed', () => {
    for (const input of [
      { ...full, activeManagers: -5 },
      { ...full, activeManagers: 9999 },
      { ...full, numTeams: 0 },
      { ...full, totalTrades: 1e9, totalWaiverClaims: 1e9, chatMessageCount: 1e9 },
    ]) {
      const s = computeActivityScore(input)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(100)
    }
  })
})

describe('both engines now agree where it matters', () => {
  const dormant = { numTeams: 12, trades: 0, claims: 0, inactive: 12 }
  const healthy = { numTeams: 12, trades: 24, claims: 96, inactive: 0 }

  const hub = (s: typeof dormant, chat: number, lineup: number) =>
    monitorLeagueHealth({
      sport: 'NFL', leagueType: 'dynasty', leagueId: 't', numTeams: s.numTeams, currentWeek: 8, totalWeeks: 17,
      activeManagers: s.numTeams - s.inactive, inactiveManagers: s.inactive, abandonedTeams: 0,
      lineupSubmissionRate: lineup, totalTradesThisSeason: s.trades, totalWaiverClaims: s.claims,
      avgFaabSpentPct: 0, chatMessageCount: chat, voteCount: 0, disputeCount: 0,
      commissionerActionsThisSeason: 0, unresolvedDisputes: 0, playoffTeams: 6,
    } as Parameters<typeof monitorLeagueHealth>[0]).engagementScore

  const assistant = (s: typeof dormant) =>
    analyzeCommissionerDashboard({
      sport: 'NFL', leagueType: 'dynasty', numTeams: s.numTeams, scoringFormat: 'PPR', rosterSlots: 25,
      benchSlots: 10, irSlots: 2, taxiSlots: 0, playoffTeams: 6, playoffWeeks: 3, waiverType: 'FAAB',
      tradeDeadline: null, tradeReviewProcess: 'commissioner', totalTradesThisSeason: s.trades,
      totalWaiverClaims: s.claims, inactiveManagers: s.inactive, disputeCount: 0, abandonedTeams: 0,
      isConceptLeague: false,
    } as Parameters<typeof analyzeCommissionerDashboard>[0]).engagementScore

  it('🛑 a dead league reads 0 from BOTH — it used to read 30 and 40', () => {
    expect(hub(dormant, 0, 0)).toBe(0)
    expect(assistant(dormant)).toBe(0)
  })

  it('a healthy league still reads high from both, within a few points', () => {
    const h = hub(healthy, 120, 1)
    const a = assistant(healthy)
    expect(h).toBeGreaterThanOrEqual(85)
    expect(a).toBeGreaterThanOrEqual(85)
    // They read different inputs, so they are close rather than equal — and that is honest.
    expect(Math.abs(h - a)).toBeLessThanOrEqual(10)
  })

  it("⚠ the assistant's ceiling survived the collapse", () => {
    // Its own thresholds are >= 60 "good" and < 40 "low". Had the missing chat and lineup terms
    // been scored as zero rather than dropped, this would cap at 70 and "good" would get harder.
    expect(assistant(healthy)).toBeGreaterThanOrEqual(85)
  })
})
