import { describe, expect, it } from 'vitest'

import { deriveCohortPriors } from '@/lib/idp-projections/cohortPriors'
import { projectIdpStatLine } from '@/lib/idp-projections/projectIdpStatLine'
import type { IdpGameObservation } from '@/lib/idp-projections/types'
import { computeLeagueProjectedPoints } from '@/lib/projections/leagueScoring'

/**
 * A real IDP league's `scoring_settings`, in the BARE vocabulary a Sleeper league actually
 * configures (`tkl_solo`), not the prefixed one Sleeper projects (`idp_tkl_solo`). Using the
 * bare form on purpose: it exercises the STAT_ALIASES bridge, which is the thing that would
 * silently zero every defender if the projected line used the wrong key names.
 */
const IDP_LEAGUE_SCORING = {
  tkl_solo: 2,
  tkl_ast: 1,
  sack: 4,
  int: 6,
  ff: 4,
  fum_rec: 4,
  pass_def: 1.5,
  // Offensive rules the league also carries; a defender matches none of them.
  rec: 1,
  pass_td: 4,
}

/** One week of a starting linebacker's log, in Sleeper's weekly vocabulary. */
function lbGame(week: number, over: Partial<Record<string, number>> = {}): IdpGameObservation {
  return {
    season: 2025,
    week,
    opponent: 'IND',
    statMap: { idp_tkl_solo: 5, idp_tkl_ast: 3, ...over },
  }
}

const STARTER_LB: IdpGameObservation[] = [
  lbGame(1),
  lbGame(2, { idp_sack: 1 }),
  lbGame(3),
  lbGame(4, { idp_pass_def: 1 }),
  lbGame(5),
  lbGame(6),
]

describe('projectIdpStatLine — refusals are first-class', () => {
  it('refuses a quarterback who recorded tackles after a turnover', () => {
    const out = projectIdpStatLine({
      position: 'QB',
      history: [lbGame(1), lbGame(2), lbGame(3)],
    })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reason).toBe('not_idp_position')
  })

  it('refuses on too few games rather than projecting from one', () => {
    const out = projectIdpStatLine({ position: 'LB', history: [lbGame(1), lbGame(2)] })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reason).toBe('insufficient_sample')
    expect(out.detail).toContain('minimum is 3')
  })

  it('distinguishes "no defensive data" from "projected to do nothing"', () => {
    const empty = [1, 2, 3].map((week) => ({
      season: 2025,
      week,
      opponent: 'IND',
      statMap: { rec: 2, rec_yd: 18 },
    }))
    const out = projectIdpStatLine({ position: 'LB', history: empty })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reason).toBe('no_defensive_production')
    expect(out.detail).toContain('data-coverage gap')
  })
})

describe('projectIdpStatLine — the projected line', () => {
  it('emits the key vocabulary the league scoring path resolves', () => {
    const out = projectIdpStatLine({ position: 'LB', history: STARTER_LB })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(Object.keys(out.statLine).sort()).toEqual(
      ['idp_pass_def', 'idp_sack', 'idp_tkl_ast', 'idp_tkl_solo'].sort(),
    )
    // A steady 5 solo / 3 assist player projects to about that, whatever the weighting.
    expect(out.statLine.idp_tkl_solo).toBeCloseTo(5, 1)
    expect(out.statLine.idp_tkl_ast).toBeCloseTo(3, 1)
  })

  it('treats a game without a sack as zero sacks, not as a missing sample', () => {
    /*
     * THE PRODUCTION BUG THIS PINS DOWN. Averaging a component only over the games it
     * appeared in gives a per-occurrence rate that can never fall below one. Measured on
     * prod before the fix: Kam Curl projected for 1 sack, 2 interceptions and 1 defensive
     * touchdown every week, scoring 56.58 in a league that has him in the teens.
     */
    const oneBigGame = [
      lbGame(1),
      lbGame(2),
      lbGame(3),
      lbGame(4),
      lbGame(5),
      lbGame(6, { idp_sack: 1, idp_int: 2, idp_def_td: 1 }),
    ]
    const out = projectIdpStatLine({ position: 'LB', history: oneBigGame })
    expect(out.ok).toBe(true)
    if (!out.ok) return

    // One sack in six games is a fraction of a sack per game, however it is weighted.
    expect(out.statLine.idp_sack!).toBeLessThan(0.5)
    expect(out.statLine.idp_int!).toBeLessThan(1)
    expect(out.statLine.idp_def_td!).toBeLessThan(0.5)
    // Tackles, which really do happen every game, are unaffected.
    expect(out.statLine.idp_tkl_solo).toBeCloseTo(5, 1)
  })

  it('always states that defensive snap data is absent', () => {
    const out = projectIdpStatLine({ position: 'LB', history: STARTER_LB })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.notes.some((n) => n.includes('snap-count data'))).toBe(true)
  })

  it('scales tackle volume by opponent pace but leaves turnovers alone', () => {
    const base = projectIdpStatLine({ position: 'LB', history: STARTER_LB })
    const fast = projectIdpStatLine({
      position: 'LB',
      history: STARTER_LB,
      // A faster opponent offense (fewer seconds per play) means more snaps faced.
      opponentPace: { secPerPlay: 25, leagueMeanSecPerPlay: 28 },
    })
    expect(base.ok && fast.ok).toBe(true)
    if (!base.ok || !fast.ok) return

    expect(fast.statLine.idp_tkl_solo!).toBeGreaterThan(base.statLine.idp_tkl_solo!)
    // Pace must not touch a turnover rate — it is not a per-snap effect this data supports.
    expect(fast.statLine.idp_sack).toBeCloseTo(base.statLine.idp_sack!, 5)
    expect(fast.coverage.hasOpponentPace).toBe(true)
  })

  it('clamps an implausible pace row instead of doubling a projection', () => {
    const out = projectIdpStatLine({
      position: 'LB',
      history: STARTER_LB,
      opponentPace: { secPerPlay: 3, leagueMeanSecPerPlay: 28 },
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    // 28/3 would be 9.3x; the clamp holds it to 1.15x.
    expect(out.statLine.idp_tkl_solo!).toBeLessThanOrEqual(5 * 1.15 + 0.01)
  })

  it('regresses a hot sack streak toward the cohort rather than projecting it forward', () => {
    // Three sacks in the two most recent games — the exact shape that fools recency weighting.
    const streak = [
      lbGame(1),
      lbGame(2),
      lbGame(3),
      lbGame(4),
      lbGame(5, { idp_sack: 1.5 }),
      lbGame(6, { idp_sack: 1.5 }),
    ]
    const cohort = Array.from({ length: 12 }, () => ({
      position: 'LB',
      history: [lbGame(1), lbGame(2), lbGame(3), lbGame(4, { idp_sack: 1 })],
    }))
    const priors = deriveCohortPriors('LB', cohort)
    expect(priors).not.toBeNull()

    const unregressed = projectIdpStatLine({ position: 'LB', history: streak })
    const regressed = projectIdpStatLine({ position: 'LB', history: streak, priors })
    expect(unregressed.ok && regressed.ok).toBe(true)
    if (!unregressed.ok || !regressed.ok) return

    expect(regressed.statLine.idp_sack!).toBeLessThan(unregressed.statLine.idp_sack!)
    expect(regressed.coverage.regressionApplied).toBe(true)
    expect(regressed.notes.some((n) => n.includes('regressed toward the LB cohort'))).toBe(true)
  })

  it('says so when no priors were supplied instead of implying regression ran', () => {
    const out = projectIdpStatLine({ position: 'LB', history: STARTER_LB })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.coverage.regressionApplied).toBe(false)
    expect(out.notes.some((n) => n.includes('No position-cohort priors'))).toBe(true)
  })

  it('derives confidence from coverage rather than asserting it', () => {
    const thin = projectIdpStatLine({ position: 'LB', history: [lbGame(1), lbGame(2), lbGame(3)] })
    const rich = projectIdpStatLine({
      position: 'LB',
      history: [...STARTER_LB, lbGame(7), lbGame(8, { idp_ff: 1 })],
      opponentPace: { secPerPlay: 27, leagueMeanSecPerPlay: 28 },
      depthOrdinal: 1,
    })
    expect(thin.ok && rich.ok).toBe(true)
    if (!thin.ok || !rich.ok) return
    expect(rich.confidenceScore).toBeGreaterThan(thin.confidenceScore)
  })
})

describe('end to end — an honest linebacker number through computeLeagueProjectedPoints', () => {
  it('prices a starting LB in his own league instead of the generic 0.3', () => {
    const projected = projectIdpStatLine({
      position: 'LB',
      history: STARTER_LB,
      opponentPace: { secPerPlay: 27, leagueMeanSecPerPlay: 28 },
      depthOrdinal: 1,
    })
    expect(projected.ok).toBe(true)
    if (!projected.ok) return

    const scored = computeLeagueProjectedPoints(projected.statLine, IDP_LEAGUE_SCORING)
    expect(scored).not.toBeNull()
    if (!scored) return

    /*
     * The whole point of the build. Sleeper's standard-PPR line gives this player 0.3 because
     * PPR contains no defensive scoring at all; his own league projects him in the teens.
     */
    expect(scored.points).toBeGreaterThan(12)
    expect(scored.coverage.matchedKeys).toBeGreaterThanOrEqual(4)

    // Tackles carry the number, as they should for a linebacker.
    expect(scored.contributions.tkl_solo).toBeGreaterThan(scored.contributions.sack ?? 0)
  })

  it('leaves no projected defensive stat unconsumed by the league rulebook', () => {
    const projected = projectIdpStatLine({ position: 'LB', history: STARTER_LB })
    expect(projected.ok).toBe(true)
    if (!projected.ok) return

    const scored = computeLeagueProjectedPoints(projected.statLine, IDP_LEAGUE_SCORING)
    expect(scored).not.toBeNull()
    /*
     * `unusedProjectedStats` is the alias-gap detector. A non-empty list here means this
     * module emitted a key the scoring path cannot see — the silent-undercount failure the
     * STAT_ALIASES map exists to prevent.
     */
    expect(scored!.coverage.unusedProjectedStats).toEqual([])
  })

  it('refuses to score a defender in a league with no IDP rules at all', () => {
    const projected = projectIdpStatLine({ position: 'LB', history: STARTER_LB })
    expect(projected.ok).toBe(true)
    if (!projected.ok) return

    // A pure offensive rulebook. Nothing in the defensive line matches, so the honest answer
    // is null — "we cannot price this here" — not a confident 0.00.
    const scored = computeLeagueProjectedPoints(projected.statLine, { rec: 1, pass_td: 4 })
    expect(scored).toBeNull()
  })
})

describe('deriveCohortPriors', () => {
  it('returns null for a cohort too thin to regress toward', () => {
    const tiny = [{ position: 'LB', history: [lbGame(1), lbGame(2)] }]
    expect(deriveCohortPriors('LB', tiny)).toBeNull()
  })

  it('divides by every cohort game, not only the games the event appeared in', () => {
    // 12 players x 4 games = 48 games; one sack each => 12 sacks over 48 games = 0.25/game.
    const cohort = Array.from({ length: 12 }, () => ({
      position: 'LB',
      history: [lbGame(1), lbGame(2), lbGame(3), lbGame(4, { idp_sack: 1 })],
    }))
    const priors = deriveCohortPriors('LB', cohort)
    expect(priors).not.toBeNull()
    expect(priors!.sampleGames).toBe(48)
    expect(priors!.perGame.idp_sack).toBeCloseTo(0.25, 4)
  })

  it('ignores members of other position groups', () => {
    const mixed = [
      ...Array.from({ length: 12 }, () => ({
        position: 'LB',
        history: [lbGame(1), lbGame(2), lbGame(3), lbGame(4)],
      })),
      { position: 'CB', history: [lbGame(1, { idp_int: 5 })] },
    ]
    const priors = deriveCohortPriors('LB', mixed)
    expect(priors!.sampleGames).toBe(48)
    expect(priors!.perGame.idp_int).toBeUndefined()
  })
})
