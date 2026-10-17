/**
 * Chimmy may state a trade's letter only if the one trade engine gave it (design step 7).
 */
import { describe, expect, it, vi } from 'vitest'

import {
  checkTradeLetters,
  enforceTradeLetters,
  statedTradeLetters,
  tradeGradeFallback,
  tradeLetterCorrection,
} from '@/lib/chimmy/tradeGradeCheck'

const GRADED = [{ letters: ['B', 'C-'], summary: 'AllFantasy grades giving Bijan Robinson for Puka Nacua B for you and C- for Rival.' }]

describe('statedTradeLetters — letters stated as grades, and only those', () => {
  it.each([
    ['This trade grades B for you.', ['B']],
    ['AllFantasy graded it a C+.', ['C+']],
    ['Grade: **A-**', ['A-']],
    ['That is a B- grade, and their side gets a D.', ['B-', 'D']],
    ['It comes out B for you and C- for them.', ['B', 'C-']],
    ['The grade of F says walk away.', ['F']],
    ['An A grade. Your side gets a B.', ['A', 'B']],
  ])('%s', (text, want) => {
    expect(statedTradeLetters(text)).toEqual(want)
  })

  it.each([
    'Plan B is to wait a week.',
    "He is an A-level talent, but Bijan's floor is higher.",
    'A C.J. Stroud trade would cost more.',
    'Start D. Henry over him this week.',
    'I would grade this trade on the lineup first.',
    'Ask for a B-grade prospect back? Not a letter here.',
  ])('not a grade: %s', (text) => {
    expect(statedTradeLetters(text)).toEqual([])
  })
})

describe('checkTradeLetters', () => {
  it('letters the engine gave pass; no letters at all pass', () => {
    expect(checkTradeLetters('It grades B for you and C- for them.', GRADED)).toEqual({ ok: true })
    expect(checkTradeLetters('Bijan starts over Puka for you this week.', [])).toEqual({ ok: true })
  })

  it('a letter the engine did not give fails, naming it', () => {
    expect(checkTradeLetters('Honestly this is an A grade for you.', GRADED)).toEqual({
      ok: false,
      stated: ['A'],
      allowed: ['B', 'C-'],
      reason: 'ungrounded_letter',
    })
  })

  it('any trade letter with no engine grade this turn fails — Chimmy never grades on its own', () => {
    expect(checkTradeLetters('I would call that a B- grade trade.', [])).toMatchObject({ ok: false, reason: 'no_engine_grade' })
  })
})

describe('the retry and the fallback', () => {
  it('the correction names the stray letter and the engine’s own grades', () => {
    const check = checkTradeLetters('This grades A for you.', GRADED)
    if (check.ok) throw new Error('expected a failure')
    const c = tradeLetterCorrection(check, GRADED)
    expect(c).toMatch(/\(A\) that AllFantasy's trade engine did not give/)
    expect(c).toContain(GRADED[0]!.summary)
  })

  it('the fallback is the engine’s words, or an offer to grade — never a letter of its own', () => {
    expect(tradeGradeFallback(GRADED)).toBe(GRADED[0]!.summary)
    const none = tradeGradeFallback([])
    expect(statedTradeLetters(none)).toEqual([])
    expect(none).toMatch(/trade engine/)
  })
})

describe('enforceTradeLetters — pass, retry once, or the engine’s own words', () => {
  it('a clean answer passes untouched, with no retry', async () => {
    const retry = vi.fn()
    const r = await enforceTradeLetters({ answer: 'It grades B for you.', grades: GRADED, retry })
    expect(r).toEqual({ text: 'It grades B for you.', outcome: 'clean', stated: [] })
    expect(retry).not.toHaveBeenCalled()
  })

  it('a stray letter retries once with the correction, and a clean retry is the answer', async () => {
    const retry = vi.fn(async () => 'Fair point: it grades B for you and C- for them.')
    const r = await enforceTradeLetters({ answer: 'This is an A grade for you.', grades: GRADED, retry })
    expect(retry).toHaveBeenCalledTimes(1)
    expect(retry.mock.calls[0]![0]).toMatch(/\(A\) that AllFantasy's trade engine did not give/)
    expect(r).toMatchObject({ outcome: 'retried', stated: ['A'] })
  })

  it('a retry that still strays — or fails — answers with the engine’s summary', async () => {
    const strays = await enforceTradeLetters({ answer: 'An A grade.', grades: GRADED, retry: async () => 'Still an A grade.' })
    expect(strays).toMatchObject({ text: GRADED[0]!.summary, outcome: 'fallback' })
    const fails = await enforceTradeLetters({ answer: 'An A grade.', grades: GRADED, retry: async () => { throw new Error('down') } })
    expect(fails.outcome).toBe('fallback')
  })
})
