/**
 * The learning loop's last step (re-score build item 7): AllFantasy's graded record goes back beside the call
 * it grades — a trade letter, the waiver panel's #1 pickup, and Chimmy's prompt. The call itself is never
 * changed; a letter whose deals have not held up says so.
 */
import { describe, expect, it } from 'vitest'
import {
  letterRecordApplies,
  letterVerdict,
  pickupRecord,
  renderEngineRecordPromptLine,
  tradeLetterRecord,
} from '@/lib/chimmy-outcomes/engineRecord'
import { ledgerRecordFor, MIN_TRADES_PER_LETTER, type LedgerSnapshot } from '@/lib/chimmy-outcomes/ledgerRecord'
import { adviceRecordMessages } from '@/lib/core-app/messages/adviceRecord'

const ledger = (over: Partial<LedgerSnapshot> = {}): LedgerSnapshot => ({
  season: 2026,
  throughWeek: 10,
  bench: { right: 21, wrong: 9, same: 2, gain: 64, pending: 0, unscored: 0, withdrawn: 0 },
  pickups: { graded: 40, startable: 18, vsDrop: 30, beatDrop: 20, lostDrop: 10, pending: 3, noStats: 1 },
  trades: {
    byLetter: {
      A: { n: MIN_TRADES_PER_LETTER, netPerWeek: 2.14, ahead: 14, behind: 6 },
      B: { n: 25, netPerWeek: -1.3, ahead: 9, behind: 16 },
      C: { n: 30, netPerWeek: 0.4, ahead: 15, behind: 15 },
      F: { n: MIN_TRADES_PER_LETTER - 1, netPerWeek: -3, ahead: 2, behind: 17 },
    },
    pending: 0,
    unscored: 0,
    read: 120,
    gradable: 100,
  },
  users: { u1: { b: [4, 1, 0], p: [5, 3] } },
  ...over,
})

describe('letterVerdict', () => {
  it('A and B hold up when the graded side came out ahead; D and F when it came out behind; C promises no direction', () => {
    expect(letterVerdict('A', 2)).toBe('held_up')
    expect(letterVerdict('B', -1)).toBe('not_held_up')
    expect(letterVerdict('F', -3)).toBe('held_up')
    expect(letterVerdict('D', 1.5)).toBe('not_held_up')
    expect(letterVerdict('C', 5)).toBe('even')
    expect(letterVerdict('A', 0)).toBe('even')
  })
})

describe('tradeLetterRecord', () => {
  const view = ledgerRecordFor(ledger(), null)

  it('gives the letter its graded record, with whether it held up', () => {
    expect(tradeLetterRecord(view, 'A')).toEqual({ letter: 'A', n: 20, netPerWeek: 2.1, aheadPct: 70, verdict: 'held_up', confidence: null })
    expect(tradeLetterRecord(view, 'b')).toEqual({ letter: 'B', n: 25, netPerWeek: -1.3, aheadPct: 36, verdict: 'not_held_up', confidence: null })
  })

  it('says nothing for a letter below the sample, a missing letter, or no record at all', () => {
    expect(tradeLetterRecord(view, 'F')).toBeNull()
    expect(tradeLetterRecord(view, 'D')).toBeNull()
    expect(tradeLetterRecord(null, 'A')).toBeNull()
    expect(tradeLetterRecord(view, null)).toBeNull()
  })

  it('belongs only beside an NFL redraft grade — the only deals the ledger grades', () => {
    expect(letterRecordApplies({ sport: 'NFL', leagueType: 'redraft' })).toBe(true)
    expect(letterRecordApplies({ sport: 'nfl', leagueType: 'Redraft' })).toBe(true)
    expect(letterRecordApplies({ sport: 'NFL', leagueType: 'dynasty' })).toBe(false)
    expect(letterRecordApplies({ sport: 'NBA', leagueType: 'redraft' })).toBe(false)
    expect(letterRecordApplies({ sport: 'NFL', leagueType: null })).toBe(false)
  })
})

describe('pickupRecord', () => {
  it('only once the platform-wide rate is earned', () => {
    expect(pickupRecord(ledgerRecordFor(ledger(), null))).toEqual({ ratePct: 45, graded: 40 })
    const thin = ledger({ pickups: { graded: 12, startable: 6, vsDrop: 0, beatDrop: 0, lostDrop: 0, pending: 0, noStats: 0 } })
    expect(pickupRecord(ledgerRecordFor(thin, null))).toBeNull()
    expect(pickupRecord(null)).toBeNull()
  })
})

describe('renderEngineRecordPromptLine', () => {
  it('states the graded numbers, flags a letter that has not held up, and forbids any other record', () => {
    const line = renderEngineRecordPromptLine(ledgerRecordFor(ledger(), 'u1'))
    expect(line).toContain("My Team's bench check")
    expect(line).toContain('with this user 4 right, 1 wrong')
    expect(line).toContain('across everyone 70% right over 30 decided calls')
    expect(line).toContain('across everyone 45% averaged 10+ PPR a week over the next three weeks (40 graded)')
    expect(line).toContain('with this user 3 of 5 did')
    expect(line).toContain('A +2.1 PPR a week (20 deals, ahead in 70%) — has held up')
    expect(line).toContain('B -1.3 PPR a week (25 deals, ahead in 36%) — has NOT held up')
    expect(line).toContain('C +0.4 PPR a week (30 deals, ahead in 50%)')
    expect(line).not.toMatch(/C \+0\.4[^;\n]*held up/)
    expect(line).not.toContain('F ')
    expect(line).toMatch(/Never state or imply any other record/)
  })

  it('with nothing graded it says so, so no rate can be invented', () => {
    const line = renderEngineRecordPromptLine(null)
    expect(line).toContain('bench check: no graded calls yet')
    expect(line).toContain('#1 pickup: no graded pickups yet')
    expect(line).toContain('Trade grades: no letter has enough graded deals yet')
  })
})

describe('the copy beside the call', () => {
  it('English and Spanish say how the letter has done, and warn when it has not held up', () => {
    expect(adviceRecordMessages.en.tradeRecord('B', 25, -1.3, 36, 'not_held_up')).toBe(
      'How B grades have held up: across 25 graded redraft trades, the team we graded B scored 1.3 PPR a week less than the players it gave up (ahead in 36%). This letter has not held up so far, so weigh it with care.',
    )
    expect(adviceRecordMessages.en.tradeRecord('A', 20, 2.1, null, 'held_up')).toBe(
      'How A grades have held up: across 20 graded redraft trades, the team we graded A scored 2.1 PPR a week more than the players it gave up. This letter has held up.',
    )
    const es = adviceRecordMessages.es!.tradeRecord!('B', 25, -1.3, 36, 'not_held_up')
    expect(es).toContain('1.3 puntos PPR por semana menos')
    expect(es).toContain('no se ha sostenido')
  })

  it('the Spanish pickup line never says «waiver»', () => {
    const es = adviceRecordMessages.es!.pickupRecord!(45, 40)
    expect(es).toContain('el 45%')
    expect(es.toLowerCase()).not.toContain('waiver')
  })
})
