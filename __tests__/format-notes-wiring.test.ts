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
    for (const c of ['tournament', 'king_of_the_hill', 'pirate', 'survivor']) {
      const from = SRC.indexOf(`rules.concept === '${c}'`)
      expect(SRC.slice(from, from + 1400)).toContain('return notes')
    }
  })
})

describe('⚠ what a format CANNOT see is stated, not guessed', () => {
  it('survivor admits tribe membership is unread', () => {
    /*
     * The tribemate-vs-rival distinction is the single largest factor in a
     * pre-merge Survivor trade. We hold no tribe data, so the note says the
     * factor is missing rather than quietly grading without it.
     */
    expect(SRC).toContain('We do not read tribe membership')
  })

  it('king of the hill does not pretend to know who wears the crown', () => {
    expect(SRC).toContain('WE DO NOT KNOW WHO WEARS THE CROWN')
  })

  it('pirate omits the protection notes rather than guessing protections', () => {
    expect(SRC).toContain('Protections are not in any schema')
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
