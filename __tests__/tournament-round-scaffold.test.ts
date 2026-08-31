// @vitest-environment node
/**
 * Guards the round calendar an imported tournament is created with.
 *
 * 🛑 THE IMPORTER CREATED ONE ROUND AND STOPPED, and everything downstream
 * assumes more exist: `executeAdvancement` marks a shell COMPLETE when it finds
 * no next play round, `applyRoundRosterRules` reads the round for the roster
 * cap, and the redraft plan has nothing to point at. A tournament imported from
 * existing leagues would reach the end of its regular season and declare itself
 * finished.
 */
import { describe, it, expect } from 'vitest'
import { buildRoundScaffold } from '@/lib/tournament/roundScaffold'

/** The calendar this tournament actually runs. */
const KBI = {
  openingWeekStart: 1,
  openingWeekEnd: 9,
  bubbleWeek: 9,
  redraftWeek: 10,
  eliteRedraftWeek: 15,
  championshipWeek: 17,
}

describe('the full calendar', () => {
  it('lays out the tournament’s real shape', () => {
    const out = buildRoundScaffold(KBI)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.rounds.map((r) => [r.roundType, r.weekStart, r.weekEnd])).toEqual([
      ['opening', 1, 9],
      ['bubble', 9, 9],
      /* The bracket starts the week AFTER the redraft — week 10 is spent
         drafting, not playing. */
      ['tournament', 11, 14],
      ['elite', 15, 16],
      ['final', 17, 17],
    ])
  })

  it('numbers the rounds in order without gaps', () => {
    const out = buildRoundScaffold(KBI)
    if (!out.ok) return
    expect(out.rounds.map((r) => r.roundNumber)).toEqual([1, 2, 3, 4, 5])
  })

  /**
   * ⚠ EACH STAGE ENDS WHERE THE NEXT BEGINS. Two rounds claiming the same weeks
   * is the kind of thing nobody notices until both are "current".
   */
  it('shortens the bracket when an elite stage is configured', () => {
    const withElite = buildRoundScaffold(KBI)
    const withoutElite = buildRoundScaffold({ ...KBI, eliteRedraftWeek: null })
    if (!withElite.ok || !withoutElite.ok) return
    expect(withElite.rounds.find((r) => r.roundType === 'tournament')?.weekEnd).toBe(14)
    expect(withoutElite.rounds.find((r) => r.roundType === 'tournament')?.weekEnd).toBe(16)
  })

  it('never overlaps two rounds', () => {
    const out = buildRoundScaffold(KBI)
    if (!out.ok) return
    /* The bubble sits inside the regular season by design, so it is excluded —
       it is not a play round and `resolveNextPlayRound` filters it out. */
    const play = out.rounds.filter((r) => r.roundType !== 'bubble')
    for (let i = 1; i < play.length; i++) {
      expect(play[i]!.weekStart).toBeGreaterThan(play[i - 1]!.weekEnd)
    }
  })
})

describe('a partly-decided calendar', () => {
  it('makes just the regular season when nothing later is set', () => {
    const out = buildRoundScaffold({ openingWeekStart: 1, openingWeekEnd: 14 })
    if (!out.ok) return
    expect(out.rounds).toHaveLength(1)
    expect(out.rounds[0]).toMatchObject({ roundType: 'opening', weekStart: 1, weekEnd: 14 })
  })

  it('runs the bracket to the season end when no later stage is set', () => {
    const out = buildRoundScaffold({ openingWeekStart: 1, openingWeekEnd: 9, redraftWeek: 10 })
    if (!out.ok) return
    expect(out.rounds.find((r) => r.roundType === 'tournament')).toMatchObject({
      weekStart: 11,
      weekEnd: 17,
    })
  })
})

/**
 * 🛑 CHECKED AS A SEQUENCE, NOT FIELD BY FIELD. Each week can be individually
 * plausible and collectively impossible, and the resulting rounds would look
 * fine in a list while the engine walked them in an order nobody intended.
 */
describe('what it refuses', () => {
  it('rejects an elite stage before the redraft', () => {
    const out = buildRoundScaffold({ ...KBI, eliteRedraftWeek: 5 })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.error).toMatch(/cannot come before/i)
  })

  it('rejects a championship before the elite stage', () => {
    const out = buildRoundScaffold({ ...KBI, championshipWeek: 12 })
    expect(out.ok).toBe(false)
  })

  /** The bubble is a second chance INSIDE the regular season, not after it. */
  it('rejects a bubble week outside the regular season', () => {
    expect(buildRoundScaffold({ ...KBI, bubbleWeek: 12 }).ok).toBe(false)
    expect(buildRoundScaffold({ ...KBI, bubbleWeek: 0 }).ok).toBe(false)
  })

  it('rejects a season that ends before it starts', () => {
    expect(buildRoundScaffold({ openingWeekStart: 9, openingWeekEnd: 1 }).ok).toBe(false)
  })

  it('rejects a season starting before week 1', () => {
    expect(buildRoundScaffold({ openingWeekStart: 0, openingWeekEnd: 9 }).ok).toBe(false)
  })
})
