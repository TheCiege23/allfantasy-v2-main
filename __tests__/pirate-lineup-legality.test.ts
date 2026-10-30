import { describe, expect, it } from 'vitest'
import { evaluatePirateLineup, type PirateLineupPlayer } from '@/lib/pirate/lineupLegality'
import type { ResolvedRosterConfig } from '@/lib/redraft/rosterConfigResolver'

function config(slots: Record<string, number>): ResolvedRosterConfig {
  return { starterCapacities: new Map(Object.entries(slots)), benchSlots: 4, irSlots: 1, taxiSlots: 0,
    maxRosterSize: Object.values(slots).reduce((sum, n) => sum + n, 0) + 5, source: 'commissioner' }
}

function player(id: string, position: string, slotType: string, extra: Partial<PirateLineupPlayer> = {}): PirateLineupPlayer {
  return { playerId: id, playerName: id, position, slotType, addableBeforeLock: true, ...extra }
}

function check(sport: string, slots: Record<string, number>, roster: PirateLineupPlayer[], waivers: PirateLineupPlayer[] = [],
  flags: Partial<Parameters<typeof evaluatePirateLineup>[0]> = {}) {
  return evaluatePirateLineup({ sport, week: 1, rosterConfig: config(slots), roster, waivers,
    lineupAtLockCertified: true, availabilityAtLockCertified: true, waiverPoolCertified: true, ...flags })
}

describe('Pirate legal-lineup protection rule', () => {
  it.each([
    ['NFL', 'QB'], ['NBA', 'PG'], ['MLB', '1B'], ['NHL', 'C'],
  ])('%s forfeits only when an eligible active bench player could fill an empty %s slot', (sport, slot) => {
    expect(check(sport, { [slot]: 1 }, [player('bench', slot, 'BENCH')]).decision).toBe('forfeit')
    expect(check(sport, { [slot]: 1 }, []).decision).toBe('excused')
  })

  it('requires enough distinct replacements for the entire legal lineup', () => {
    expect(check('NFL', { RB: 2 }, [player('one', 'RB', 'BENCH')]).decision).toBe('excused')
    expect(check('NFL', { RB: 2 }, [player('one', 'RB', 'BENCH'), player('two', 'RB', 'BENCH')]).decision).toBe('forfeit')
  })

  it('keeps an active locked starter in place while filling another slot', () => {
    const roster = [
      player('qb', 'QB', 'QB', { lockedAtSnapshot: true, addableBeforeLock: false }),
      player('rb', 'RB', 'BENCH'),
    ]
    expect(check('NFL', { QB: 1, RB: 1 }, roster).decision).toBe('forfeit')
  })

  it('counts OUT/IR starters and excludes late or inactive replacements', () => {
    const out = player('starter', 'QB', 'QB', { injuryStatus: 'IR', addableBeforeLock: false })
    expect(check('NFL', { QB: 1 }, [out, player('bench', 'QB', 'BENCH')]).decision).toBe('forfeit')
    expect(check('NFL', { QB: 1 }, [out, player('bench', 'QB', 'BENCH', { injuryStatus: 'OUT' })]).decision).toBe('excused')
    expect(check('NFL', { QB: 1 }, [out, player('bench', 'QB', 'BENCH', { addableBeforeLock: false })]).decision).toBe('excused')
  })

  it('counts a waiver replacement only when it was actually addable before lock', () => {
    expect(check('NHL', { C: 1 }, [], [player('free', 'C', 'BENCH', { addableBeforeLock: false })]).decision).toBe('excused')
    expect(check('NHL', { C: 1 }, [], [player('free', 'C', 'BENCH')]).decision).toBe('forfeit')
    expect(check('NHL', { C: 1 }, [], [], { waiverPoolCertified: false }).decision).toBe('review')
  })

  it('never forfeits on missing historical lineup or availability evidence', () => {
    const roster = [player('bench', 'QB', 'BENCH')]
    expect(check('NFL', { QB: 1 }, roster, [], { lineupAtLockCertified: false }).decision).toBe('review')
    expect(check('NFL', { QB: 1 }, roster, [], { availabilityAtLockCertified: false }).decision).toBe('review')
    expect(check('NFL', { QB: 1 }, roster, [], { waiverPoolCertified: false }).decision).toBe('forfeit')
  })
})
