import { describe, expect, it } from 'vitest'

import { guillotineHorizon } from '@/lib/trade-intel/guillotine'
import { readFormatRules } from '@/lib/trade-intel/leagueFormatRules'
import {
  deferredSlotValue,
  idolExpiryNote,
  lineupAt,
  superflexInflectionNote,
  SUPERFLEX_WEEK,
  survivalConditionNote,
} from '@/lib/trade-intel/survivorGuillotine'

/**
 * 22 teams, two tribes of 11, one elimination a week and two during the
 * Gauntlet. No trades; $1000 FAAB for the season. The starting lineup GROWS on a
 * published schedule — eight starters at the open, twelve by week 14.
 */

describe('⚠ the lineup grows, so depth appreciates', () => {
  it('starts at eight and finishes at twelve', () => {
    /*
     * Nothing else in this repo models a growing lineup. Every other format
     * prices depth as decaying because rosters shrink or expire; here a bench
     * body you cannot start in week 1 is a starter by week 14.
     */
    expect(lineupAt(1)!.starters).toBe(8)
    expect(lineupAt(7)!.starters).toBe(9)
    expect(lineupAt(9)!.starters).toBe(10)
    expect(lineupAt(11)!.starters).toBe(11)
    expect(lineupAt(14)!.starters).toBe(12)
    expect(lineupAt(17)!.starters).toBe(12)
  })

  it('names the next expansion while one is still ahead', () => {
    const w8 = lineupAt(8)!
    expect(w8.nextAt).toBe(9)
    expect(w8.nextAdds).toBe('SUPERFLEX')
    expect(w8.basis).toContain('grows into your bench')
  })

  it('says the lineup is final once it stops growing', () => {
    expect(lineupAt(15)!.nextAt).toBeNull()
    expect(lineupAt(15)!.basis).toContain('will not grow again')
  })

  it('withholds on a nonsense week rather than guessing', () => {
    expect(lineupAt(0)).toBeNull()
  })
})

describe('deferredSlotValue: a delay, not a discount', () => {
  it('⚠ he is worth nothing now and full value later, not "less" throughout', () => {
    /*
     * A flat "bench players are worth less" rule misprices both ends — too high
     * now, too low later — and the gap is a known number of weeks rather than a
     * guess.
     */
    const d = deferredSlotValue({ currentWeek: 4, slotArrivesWeek: 9 })!
    expect(d.weeksOnBench).toBe(5)
    expect(d.weeksStarting).toBe(9)
    expect(d.basis).toContain('delay, not a discount')
  })

  it('⚠ names the catch: you have to survive to collect', () => {
    // Buying a week-9 asset in week 4 is a bet you are still alive in week 9,
    // in a format that eliminates somebody every single week.
    expect(deferredSlotValue({ currentWeek: 4, slotArrivesWeek: 9 })!.basis).toContain(
      'survive those 5 weeks to collect',
    )
  })

  it('reports a slot that already exists as immediately usable', () => {
    const d = deferredSlotValue({ currentWeek: 10, slotArrivesWeek: 10 })!
    expect(d.weeksOnBench).toBe(0)
    expect(d.basis).toContain('slot exists now')
  })

  it('withholds when the slot is already behind us', () => {
    expect(deferredSlotValue({ currentWeek: 12, slotArrivesWeek: 9 })).toBeNull()
  })
})

describe('superflexInflectionNote: everybody can read the same schedule', () => {
  it('⚠ warns that the market moves before the slot does', () => {
    /*
     * A manager who waits until week 9 to want a second QB is bidding against
     * every other manager who also just noticed. The schedule is public.
     */
    const n = superflexInflectionNote({ currentWeek: 5 })!
    expect(n).toContain(`week ${SUPERFLEX_WEEK}`)
    expect(n).toContain('bidding moves before the slot does')
  })

  it('says nothing once the superflex has arrived', () => {
    expect(superflexInflectionNote({ currentWeek: 9 })).toBeNull()
    expect(superflexInflectionNote({ currentWeek: 12 })).toBeNull()
  })
})

describe('⚠ survival means three different things depending on the week', () => {
  it('Match Play: your TRIBE’S win count decides, not your score', () => {
    /*
     * A big week on a losing tribe can still send you home; a poor week on a
     * winning tribe cannot. A model that treated every week as "don't be last"
     * would be right about a third of the time.
     */
    const n = survivalConditionNote({ style: 'match_play' })
    expect(n).toContain('tribe winning MORE matchups is entirely safe')
    expect(n).toContain('big week on a losing tribe can still send you home')
  })

  it('Tribe Champion: eleven teams live on one person’s score', () => {
    const n = survivalConditionNote({ style: 'tribe_champion' })
    expect(n).toContain('one person’s score')
    expect(n).toContain('NOT immune')
  })

  it('Gauntlet: your own floor is the only thing protecting you', () => {
    expect(survivalConditionNote({ style: 'gauntlet_double' })).toContain('two teams leave every week')
  })

  it('standard weeks are the plain guillotine rule', () => {
    expect(survivalConditionNote({ style: 'standard' })).toContain('lowest scorer in the league')
  })
})

describe('idolExpiryNote: saving it fails in two different ways', () => {
  it('⚠ an unplayed idol dies with you, as well as at its expiry', () => {
    /*
     * The "save it for when I really need it" instinct fails twice: the week you
     * need it may be after it expired, or you go out holding it.
     */
    const n = idolExpiryNote({ currentWeek: 6, kind: 'standard' })!
    expect(n).toContain('5 more weeks')
    expect(n).toContain('fails in two different ways')
  })

  it('reports an expired idol as worth nothing', () => {
    expect(idolExpiryNote({ currentWeek: 12, kind: 'standard' })).toContain('worth nothing now')
  })

  it('tracks the gauntlet idol on its own week-13 deadline', () => {
    expect(idolExpiryNote({ currentWeek: 12, kind: 'gauntlet' })).toContain('2 more weeks')
    expect(idolExpiryNote({ currentWeek: 14, kind: 'gauntlet' })).toContain('expired in week 13')
  })
})

describe('the Gauntlet reuses the guillotine horizon with a double chop', () => {
  it('⚠ two eliminations a week halves the runway', () => {
    /*
     * The existing horizon already takes teamsPerChop, so the Gauntlet needs no
     * second implementation — 12 teams chopping two a week is three weeks, not
     * eleven.
     */
    const single = guillotineHorizon({ teamsRemaining: 12, startingTeams: 22 })!
    const double = guillotineHorizon({ teamsRemaining: 12, startingTeams: 22, teamsPerChop: 2 })!
    expect(single.weeksToEnd).toBe(11)
    expect(double.weeksToEnd).toBe(6)
  })
})

describe('format detection', () => {
  it('⚠ no trades in this league, and the format says so', () => {
    // The rules are explicit: "There are no trades allowed in this league."
    // Built for the FAAB decisions, which are the only acquisitions available.
    const r = readFormatRules({ leagueType: 'guillotine' })
    expect(r.concept).toBe('guillotine')
    expect(r.futurePicksTradeable).toBe(false)
  })
})
