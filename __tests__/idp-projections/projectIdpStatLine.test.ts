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

  it('does not let a two-game spike become a rate, however long the history', () => {
    /*
     * THE PASS-RUSHER OVERSHOOT. Sharing the four-game volume half-life with rate stats meant
     * the last handful of games WERE the projection. Measured on DeMarcus Lawrence: 0.213
     * fumble recoveries per game against a 0.061 career rate, and 0.281 forced fumbles against
     * 0.139 — enough to put him 2-3 points high in every tackle-heavy league.
     */
    const quiet = Array.from({ length: 40 }, (_, i) => lbGame(i + 1))
    const spike = [lbGame(41, { idp_sack: 2 }), lbGame(42, { idp_sack: 2 })]
    const out = projectIdpStatLine({ position: 'LB', history: [...quiet, ...spike] })
    expect(out.ok).toBe(true)
    if (!out.ok) return

    // True rate is 4 sacks in 42 games ≈ 0.095. A four-game window would read ten times that.
    expect(out.statLine.idp_sack!).toBeLessThan(0.4)
    // Tackle volume still tracks the recent window, which is the point of keeping them apart.
    expect(out.statLine.idp_tkl_solo).toBeCloseTo(5, 1)
  })

  it('regresses on the effective sample, not the raw game count', () => {
    /*
     * With a rate half-life of 17 a 200-game history still carries only a few dozen games of
     * real weight. Shrinking on 200 hands the player's own form ~96% and makes the cohort
     * decorative; Kish's effective N keeps the arithmetic honest.
     */
    const long = Array.from({ length: 200 }, (_, i) => lbGame(i + 1, i % 2 === 0 ? { idp_sack: 1 } : {}))
    const priors = {
      position: 'LB',
      perGame: { idp_sack: 0.05 },
      sampleGames: 5000,
    }
    const out = projectIdpStatLine({ position: 'LB', history: long, priors })
    expect(out.ok).toBe(true)
    if (!out.ok) return

    // Own rate is 0.5, cohort is 0.05. Regressing on 200 games would barely move off 0.5.
    expect(out.statLine.idp_sack!).toBeLessThan(0.45)
    expect(out.coverage.regressionApplied).toBe(true)

    const note = out.notes.find((n) => n.includes('regressed toward'))
    expect(note).toBeDefined()
    // The note must report the EFFECTIVE weight, never "200 games".
    expect(note).toContain('carry the weight of about')
    expect(note).not.toMatch(/weight of about 200/)
  })

  it('says volume was projected per GAME when no snap counts exist', () => {
    const out = projectIdpStatLine({ position: 'LB', history: STARTER_LB })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.notes.some((n) => n.includes('projected per GAME'))).toBe(true)
    expect(out.coverage.gamesWithSnaps).toBe(0)
    expect(out.coverage.projectedSnaps).toBeNull()
  })

  it('projects per SNAP when snap counts exist, and says so', () => {
    const withSnaps = STARTER_LB.map((g, i) => ({
      ...g,
      statMap: { ...g.statMap, def_snp: 60, tm_def_snp: 68, week: i + 1 },
    }))
    const out = projectIdpStatLine({ position: 'LB', history: withSnaps })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.coverage.gamesWithSnaps).toBe(6)
    expect(out.coverage.projectedSnaps).toBeCloseTo(60, 0)
    expect(out.coverage.projectedSnapShare).toBeCloseTo(60 / 68, 2)
    expect(out.notes.some((n) => n.includes('per defensive snap'))).toBe(true)
    expect(out.notes.some((n) => n.includes("88% of his defense's"))).toBe(true)
  })

  it('follows a role change instead of averaging it away', () => {
    /*
     * THE CASE PER-GAME AVERAGING CANNOT SEE. A rotational defender takes over an every-down
     * job: his snaps double and his tackle counts double with them. A per-game mean drags him
     * back toward the rotational weeks; a per-snap rate times expected snaps does not.
     */
    const rotational = [1, 2, 3, 4].map((w) => ({
      season: 2025,
      week: w,
      opponent: 'IND',
      statMap: { idp_tkl_solo: 2, idp_tkl_ast: 1, def_snp: 20, tm_def_snp: 65 },
    }))
    const everyDown = [5, 6, 7, 8].map((w) => ({
      season: 2025,
      week: w,
      opponent: 'IND',
      statMap: { idp_tkl_solo: 6, idp_tkl_ast: 3, def_snp: 62, tm_def_snp: 65 },
    }))
    const history = [...rotational, ...everyDown]

    const withSnaps = projectIdpStatLine({ position: 'LB', history })
    // The identical production with the snap columns stripped out — the old basis.
    const withoutSnaps = projectIdpStatLine({
      position: 'LB',
      history: history.map((g) => ({
        ...g,
        statMap: { idp_tkl_solo: g.statMap.idp_tkl_solo, idp_tkl_ast: g.statMap.idp_tkl_ast },
      })),
    })
    expect(withSnaps.ok && withoutSnaps.ok).toBe(true)
    if (!withSnaps.ok || !withoutSnaps.ok) return

    /*
     * The invariant that matters: knowing he now plays nearly every snap moves him UP relative
     * to a per-game average that still carries his rotational weeks. The exact size of the
     * move is a modelling choice; that it happens at all is what the snap data buys.
     */
    expect(withSnaps.statLine.idp_tkl_solo!).toBeGreaterThan(withoutSnaps.statLine.idp_tkl_solo!)
    expect(withSnaps.coverage.projectedSnapShare!).toBeGreaterThan(0.7)
    expect(withoutSnaps.coverage.projectedSnapShare).toBeNull()
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

describe('projectIdpStatLine — matchup context is off unless asked for', () => {
  const CONTEXT = {
    opponentPassRate: 0.62,
    leagueMeanPassRate: 0.538,
    ownBlitzRate: 0.297,
    leagueMeanBlitzRate: 0.178,
  }

  it('is completely inert at strength 0, which is the default', () => {
    /*
     * Measured on 5,291 out-of-sample player-weeks, this layer made accuracy WORSE — MAE
     * 4.681 at half strength and 4.696 at full against a 4.673 control. It stays wired and
     * documented rather than deleted so the next person does not rebuild it from the same
     * plausible reasoning, but it must cost nothing while switched off.
     */
    const plain = projectIdpStatLine({ position: 'LB', history: STARTER_LB })
    const withCtx = projectIdpStatLine({ position: 'LB', history: STARTER_LB, context: CONTEXT })
    const explicitZero = projectIdpStatLine({
      position: 'LB',
      history: STARTER_LB,
      context: { ...CONTEXT, strength: 0 },
    })
    expect(plain.ok && withCtx.ok && explicitZero.ok).toBe(true)
    if (!plain.ok || !withCtx.ok || !explicitZero.ok) return

    expect(withCtx.statLine).toEqual(plain.statLine)
    expect(explicitZero.statLine).toEqual(plain.statLine)
    expect(withCtx.notes.some((n) => n.includes('Matchup context'))).toBe(false)
  })

  it('moves coverage up and run tackles down against a pass-heavy opponent', () => {
    const out = projectIdpStatLine({
      position: 'LB',
      history: STARTER_LB,
      context: { ...CONTEXT, strength: 1 },
    })
    const plain = projectIdpStatLine({ position: 'LB', history: STARTER_LB })
    expect(out.ok && plain.ok).toBe(true)
    if (!out.ok || !plain.ok) return

    // An opponent throwing 62% against a 53.8% mean runs less, so tackle volume falls...
    expect(out.statLine.idp_tkl_solo!).toBeLessThan(plain.statLine.idp_tkl_solo!)
    // ...while pressure work rises on both the extra dropbacks and a blitz-heavy defense.
    expect(out.statLine.idp_sack!).toBeGreaterThan(plain.statLine.idp_sack!)
    expect(out.notes.some((n) => n.includes('Matchup context applied'))).toBe(true)
  })

  it('clamps context so a matchup nudges a projection rather than rewriting it', () => {
    const extreme = projectIdpStatLine({
      position: 'LB',
      history: STARTER_LB,
      context: {
        opponentPassRate: 0.95,
        leagueMeanPassRate: 0.3,
        ownBlitzRate: 0.9,
        leagueMeanBlitzRate: 0.05,
        strength: 1,
      },
    })
    const plain = projectIdpStatLine({ position: 'LB', history: STARTER_LB })
    expect(extreme.ok && plain.ok).toBe(true)
    if (!extreme.ok || !plain.ok) return
    // Sacks take both the pass and blitz multipliers, so 1.25 x 1.25 is the ceiling. The
    // epsilon is the output's own 3-decimal rounding, not slack in the clamp.
    expect(extreme.statLine.idp_sack!).toBeLessThanOrEqual(plain.statLine.idp_sack! * 1.25 * 1.25 + 1e-3)
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
