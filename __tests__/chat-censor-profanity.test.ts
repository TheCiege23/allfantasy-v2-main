import { describe, expect, it } from 'vitest'
import { censorProfanity, hasProfanity } from '@/lib/chat-core/censorProfanity'

describe('censorProfanity', () => {
  it('keeps the first letter and masks the rest', () => {
    const out = censorProfanity('shit')
    expect(out[0]).toBe('s')
    expect(out).toHaveLength(4)
    expect(out.slice(1)).toMatch(/^[!@#$%&]+$/)
  })

  it('censors inside a sentence and leaves the rest alone', () => {
    const out = censorProfanity('that trade was shit, honestly')
    expect(out.startsWith('that trade was ')).toBe(true)
    expect(out.endsWith(', honestly')).toBe(true)
    expect(out).not.toContain('shit')
  })

  /*
   * League chat re-fetches every four to eight seconds. A mask built from
   * anything random would draw a different run on every poll and the message
   * would shimmer while it sat on screen.
   */
  it('masks a word identically every time', () => {
    expect(censorProfanity('shit')).toBe(censorProfanity('shit'))
    expect(censorProfanity('what the fuck')).toBe(censorProfanity('what the fuck'))
  })

  it('gives different words different runs', () => {
    expect(censorProfanity('shit').slice(1)).not.toBe(censorProfanity('crap').slice(1))
  })

  it('keeps the case of the first letter', () => {
    expect(censorProfanity('Shit happens')[0]).toBe('S')
  })

  it('matches regardless of case', () => {
    expect(censorProfanity('FUCK')).not.toContain('UCK')
  })

  it('handles plurals and -ing without listing them', () => {
    expect(censorProfanity('bastards')).not.toContain('bastard')
    expect(censorProfanity('fucking useless')).not.toContain('fucking')
    expect(censorProfanity('fucking useless')).toContain('useless')
  })

  it('censors every occurrence, not just the first', () => {
    const out = censorProfanity('shit shit shit')
    expect(out).not.toContain('shit')
    expect(out.split(' ')).toHaveLength(3)
  })

  /*
   * Substring matching is how a filter mangles ordinary words — and this is a
   * fantasy app full of surnames.
   */
  it('leaves innocent words that merely contain a swear', () => {
    const innocent = [
      'class',
      'grass',
      'assist',
      'assistant',
      'bass',
      'Scunthorpe',
      'Dickerson',
      'Dickenson',
      'shiitake',
      'passage',
      'analysis',
      'cockpit',
    ]
    for (const word of innocent) {
      expect(censorProfanity(word)).toBe(word)
    }
  })

  it('leaves a clean message exactly as it was', () => {
    const text = 'Kelce or Andrews this week?'
    expect(censorProfanity(text)).toBe(text)
  })

  it('handles an empty message', () => {
    expect(censorProfanity('')).toBe('')
  })

  it('survives repeated calls, which a shared regex can break', () => {
    const text = 'shit and more shit'
    const first = censorProfanity(text)
    expect(censorProfanity(text)).toBe(first)
    expect(censorProfanity(text)).toBe(first)
  })
})

describe('hasProfanity', () => {
  it('reports what would be censored', () => {
    expect(hasProfanity('this is shit')).toBe(true)
    expect(hasProfanity('this is fine')).toBe(false)
    expect(hasProfanity('')).toBe(false)
  })

  /* A shared regex with the g flag carries lastIndex between calls. */
  it('gives the same answer on repeated calls', () => {
    expect(hasProfanity('shit')).toBe(true)
    expect(hasProfanity('shit')).toBe(true)
    expect(hasProfanity('shit')).toBe(true)
  })
})
