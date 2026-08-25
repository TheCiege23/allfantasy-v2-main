import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * ⚠ THE FAILURE THIS FILE EXISTS FOR: a module built, tested, merged and never
 * called. It had happened to FIVE format models at once — survivor, survivor
 * guillotine, tournament, pirate and king of the hill were all complete, all
 * green, and all unreachable from the trade console.
 *
 * These assertions are deliberately about the CALL SITE rather than about
 * behaviour. The behaviour is covered by each format's own suite; what was
 * missing was anything invoking it.
 */
const SRC = readFileSync(resolve(process.cwd(), 'lib/trade-intel/tradeContextNotes.ts'), 'utf8')

describe('every format model is reachable from the trade console', () => {
  const CONCEPTS = [
    'tournament',
    'king_of_the_hill',
    'pirate',
    'survivor',
    'zombie',
    'guillotine',
  ] as const

  for (const c of CONCEPTS) {
    it(`branches on ${c}`, () => {
      expect(SRC).toContain(`rules.concept === '${c}'`)
    })
  }

  it('imports each format module rather than reimplementing it', () => {
    for (const mod of [
      './kingOfTheHill',
      './pirate',
      './survivor',
      './survivorGuillotine',
      './tournament',
      './guillotine',
      './zombie',
    ]) {
      expect(SRC).toContain(`from '${mod}'`)
    }
  })

  it('every branch returns, so formats cannot fall through to each other', () => {
    // Pirate falling through to keeper logic would price protections as keeper
    // costs — wrong in a way that still produces a confident number.
    // Windows are generous because the pirate and survivor branches now do real
    // state reads. What is pinned is that each branch RETURNS.
    for (const c of ['tournament', 'king_of_the_hill', 'pirate', 'survivor']) {
      const from = SRC.indexOf(`rules.concept === '${c}'`)
      expect(SRC.slice(from, from + 3200)).toContain('return notes')
    }
  })
})

describe('⚠ what a format CANNOT see is stated, not guessed', () => {
  it('⚠ survivor now READS tribe membership, and still admits a miss', () => {
    /*
     * This assertion used to pin the gap. The gap is filled — SurvivorTribe was
     * in the schema all along — but the honesty guarantee survives: when both
     * managers cannot be placed in a tribe, the note says the largest factor is
     * missing rather than grading quietly without it.
     */
    expect(SRC).toContain('resolveTribeRelation(')
    expect(SRC).toContain('could not place both managers in a tribe')
  })

  it('king of the hill does not pretend to know who wears the crown', () => {
    expect(SRC).toContain('WE DO NOT KNOW WHO WEARS THE CROWN')
  })

  it('⚠ pirate now READS protections, and distinguishes absent from empty', () => {
    /*
     * Also previously a pinned gap. Protections live on Roster.settings — no
     * migration — and a roster that has never declared them must not be told its
     * whole roster is exposed.
     */
    expect(SRC).toContain('readProtections(')
    expect(SRC).toContain('An ABSENT list is not an')
  })

  it('tournament treats trading as barred by default', () => {
    // tradesEnabled: null resolves to not-permitted, because most tournaments
    // are — assuming otherwise builds a manager around an impossible deal.
    expect(SRC).toContain('tradingPolicy({ tradesEnabled: null })')
  })

  it('the survivor-guillotine lineup note only fires when an expansion is ahead', () => {
    // A plain guillotine league must not be told its lineup is about to grow.
    expect(SRC).toContain('lineup?.nextAt != null')
  })
})
