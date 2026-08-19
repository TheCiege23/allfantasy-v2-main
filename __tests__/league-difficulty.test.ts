import { describe, it, expect } from 'vitest'
import { scoreSeason, FORMAT_DIFFICULTY } from '@/lib/career/leagueDifficulty'

/**
 * The rules these encode, from the owner and from the league documents:
 *
 *   "difficulty definitely rewards winning those leagues. Competing in them has
 *    a slight reward because you are taking the risk... Anytime that there is
 *    money on the line, that should be a little bit of extra reward."
 *
 * And from the docs: the King Buffalo tournament is ~240 teams across 20 shell
 * leagues; the Zombie Universe is a three-rung ladder where surviving one level
 * earns entry to the next.
 */

const redraft = { leagueType: 'redraft', teamCount: 12 }
const guillotine = { leagueType: 'guillotine', teamCount: 18 }
const zombie = { leagueType: 'zombie', teamCount: 20 }

describe('winning a hard league beats winning an easy one', () => {
  it('ranks a guillotine title above a redraft title', () => {
    expect(scoreSeason('champion', guillotine).points)
      .toBeGreaterThan(scoreSeason('champion', redraft).points)
  })

  it('ranks surviving a zombie league above winning a standard redraft', () => {
    // The owner named zombie, survivor and guillotine as the hard formats.
    expect(scoreSeason('survived', zombie).points)
      .toBeGreaterThan(scoreSeason('champion', redraft).points)
  })

  it('orders the formats the way the owner described them', () => {
    expect(FORMAT_DIFFICULTY.redraft).toBeLessThan(FORMAT_DIFFICULTY.dynasty)
    expect(FORMAT_DIFFICULTY.dynasty).toBeLessThan(FORMAT_DIFFICULTY.guillotine)
    expect(FORMAT_DIFFICULTY.guillotine).toBeLessThan(FORMAT_DIFFICULTY.zombie)
  })
})

describe('competing is a slight reward, not a large one', () => {
  it('pays far less for showing up than for winning', () => {
    const competed = scoreSeason('competed', guillotine).points
    const won = scoreSeason('champion', guillotine).points
    expect(competed).toBeGreaterThan(0)
    expect(won).toBeGreaterThan(competed * 5)
  })

  it('still values competing in a hard league over an easy one', () => {
    expect(scoreSeason('competed', zombie).points)
      .toBeGreaterThan(scoreSeason('competed', redraft).points)
  })
})

describe('money on the line', () => {
  it('adds a small bump, and adds it for competing too', () => {
    // Risk is the justification, so exposure counts even without a trophy.
    const free = scoreSeason('competed', { ...zombie, isPaid: false }).points
    const paid = scoreSeason('competed', { ...zombie, isPaid: true }).points
    expect(paid).toBeGreaterThan(free)
    expect(paid - free).toBe(1)
  })

  it('does not let a paid redraft outrank a free zombie survival', () => {
    // A flat bump must never overturn the difficulty ordering.
    expect(scoreSeason('survived', { ...zombie, isPaid: false }).points)
      .toBeGreaterThan(scoreSeason('champion', { ...redraft, isPaid: true }).points)
  })
})

describe('field size is an input, not the answer', () => {
  it('lets a 20-team zombie league outrank a 150-team tournament ENTRY', () => {
    // The owner's exact worry. Surviving the zombie ladder must be able to beat
    // merely competing in a huge tournament.
    const zombieSurvival = scoreSeason('survived', zombie).points
    const bigFieldCompeted = scoreSeason('competed', {
      leagueType: 'tournament', teamCount: 12, fieldSize: 150,
    }).points
    expect(zombieSurvival).toBeGreaterThan(bigFieldCompeted)
  })

  it('still credits a genuinely larger field', () => {
    const small = scoreSeason('champion', { leagueType: 'tournament', teamCount: 12, fieldSize: 12 }).points
    const huge = scoreSeason('champion', { leagueType: 'tournament', teamCount: 12, fieldSize: 240 }).points
    expect(huge).toBeGreaterThan(small)
  })

  it('caps the size term so headcount can never dominate', () => {
    // A linear term would make a 240-team field worth 20x a 12-team one, which
    // is the error the owner warned against.
    const huge = scoreSeason('champion', { leagueType: 'redraft', teamCount: 12, fieldSize: 5000 })
    expect(huge.breakdown.fieldFactor).toBeLessThanOrEqual(1.5)
  })
})

describe('the zombie ladder', () => {
  it('prices Alpha survival above Beta above Gamma', () => {
    const g = scoreSeason('survived', { ...zombie, tier: 'gamma' }).points
    const b = scoreSeason('survived', { ...zombie, tier: 'beta' }).points
    const a = scoreSeason('survived', { ...zombie, tier: 'alpha' }).points
    // Each rung is earned by surviving the one below it, over separate seasons.
    expect(b).toBeGreaterThan(g)
    expect(a).toBeGreaterThan(b)
  })
})

describe('the score is interrogable', () => {
  it('returns every term that produced it', () => {
    const s = scoreSeason('champion', { ...zombie, tier: 'alpha', isPaid: true })
    // A rank a user cannot interrogate is a rank they will not trust.
    expect(Object.keys(s.breakdown).sort()).toEqual(
      ['achievementBase', 'fieldFactor', 'formatDifficulty', 'paidBonus', 'tierMultiplier'],
    )
    expect(s.difficulty).toBeGreaterThan(1)
  })

  it('treats an unknown format as a plain redraft rather than guessing', () => {
    expect(scoreSeason('champion', { leagueType: 'best_ball_xyz', teamCount: 12 }).points)
      .toBe(scoreSeason('champion', redraft).points)
  })
})
