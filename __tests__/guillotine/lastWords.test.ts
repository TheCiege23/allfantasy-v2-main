import { describe, expect, it } from 'vitest'
import { LAST_WORDS_MAX, lastWordsByRoster, lastWordsWindow, normalizeLastWords } from '@/lib/guillotine/lastWords'

describe('what a chopped manager can write', () => {
  it('keeps a plain message as written', () => {
    expect(normalizeLastWords('I regret nothing. Except starting my kicker.')).toEqual({ ok: true, value: 'I regret nothing. Except starting my kicker.' })
  })

  it('puts it on one line: line breaks, tabs and runs of spaces become single spaces', () => {
    expect(normalizeLastWords('  so long\n\nand   thanks\tfor all the fish  ')).toEqual({ ok: true, value: 'so long and thanks for all the fish' })
  })

  it('drops invisible and control characters', () => {
    expect(normalizeLastWords('good\u0000bye\u200b friends\ufeff')).toEqual({ ok: true, value: 'good bye friends' })
  })

  it('keeps emoji and accents, and counts an emoji as one character', () => {
    expect(normalizeLastWords('Adiós, liga 🪓')).toEqual({ ok: true, value: 'Adiós, liga 🪓' })
    expect(normalizeLastWords('🪓'.repeat(LAST_WORDS_MAX))).toMatchObject({ ok: true })
    expect(normalizeLastWords('🪓'.repeat(LAST_WORDS_MAX + 1))).toMatchObject({ ok: false, error: 'too_long' })
  })

  it.each([
    ['nothing', ''],
    ['only spaces', '   \n\t '],
    ['not text at all', null],
    ['a number', 42],
  ])('refuses %s', (_name, raw) => {
    expect(normalizeLastWords(raw)).toMatchObject({ ok: false, error: 'empty' })
  })

  it('refuses a message that is too long, and says the limit', () => {
    const r = normalizeLastWords('a'.repeat(LAST_WORDS_MAX + 1))
    expect(r).toEqual({ ok: false, error: 'too_long', message: `Keep it to ${LAST_WORDS_MAX} characters.` })
    expect(normalizeLastWords('a'.repeat(LAST_WORDS_MAX))).toMatchObject({ ok: true })
  })

  it.each(['join my league at https://example.com/x', 'www.example.com is better', 'come to mysite.com', 'follow me on stream.tv'])('refuses a link: %s', (raw) => {
    expect(normalizeLastWords(raw)).toMatchObject({ ok: false, error: 'has_link' })
  })

  it('does not mistake ordinary punctuation for a link', () => {
    for (const ok of ['Lost by 0.4. Unreal.', 'Mr.Irrelevant got me', 'see you next year...maybe', 'RB1.WR1.TE1. still lost']) {
      expect(normalizeLastWords(ok)).toMatchObject({ ok: true })
    }
  })
})

const at = (iso: string, metadata: Record<string, unknown>) => ({ createdAt: iso, metadata })

describe("a league's last words, from its events", () => {
  it('one message per chopped team', () => {
    const { words } = lastWordsByRoster([
      at('2026-10-06T14:00:00Z', { rosterId: 'a', week: 5, text: 'bye' }),
      at('2026-10-13T14:00:00Z', { rosterId: 'b', week: 6, text: 'robbed' }),
    ])
    expect([...words.values()].map((w) => [w.rosterId, w.week, w.text])).toEqual([['a', 5, 'bye'], ['b', 6, 'robbed']])
    expect(words.get('a')?.at).toBe('2026-10-06T14:00:00.000Z')
  })

  it('a rewrite replaces the earlier one, whatever order the events arrive in', () => {
    const events = [
      at('2026-10-06T15:00:00Z', { rosterId: 'a', week: 5, text: 'second thoughts' }),
      at('2026-10-06T14:00:00Z', { rosterId: 'a', week: 5, text: 'frist thoughts' }),
    ]
    expect(lastWordsByRoster(events).words.get('a')?.text).toBe('second thoughts')
    expect(lastWordsByRoster([...events].reverse()).words.get('a')?.text).toBe('second thoughts')
  })

  it('a removed message is gone, and nothing written after the removal brings it back', () => {
    const { words, removed } = lastWordsByRoster([
      at('2026-10-06T14:00:00Z', { rosterId: 'a', week: 5, text: 'something rude' }),
      at('2026-10-06T15:00:00Z', { rosterId: 'a', removed: true }),
      at('2026-10-06T16:00:00Z', { rosterId: 'a', week: 5, text: 'something ruder' }),
      at('2026-10-06T14:00:00Z', { rosterId: 'b', week: 5, text: 'gg' }),
    ])
    expect(words.has('a')).toBe(false)
    expect(removed.has('a')).toBe(true)
    expect(words.get('b')?.text).toBe('gg')
  })

  it('skips malformed events rather than throwing', () => {
    const { words } = lastWordsByRoster([
      at('2026-10-06T14:00:00Z', { week: 5, text: 'no team' }),
      at('2026-10-06T14:00:00Z', { rosterId: 'a', text: 'no week' }),
      at('2026-10-06T14:00:00Z', { rosterId: 'b', week: 5 }),
      { createdAt: '2026-10-06T14:00:00Z', metadata: null },
      { createdAt: '2026-10-06T14:00:00Z', metadata: 'nonsense' },
    ])
    expect(words.size).toBe(0)
  })
})

describe('when a message can still be written', () => {
  it('open right after the chop, and while no later chop has happened', () => {
    expect(lastWordsWindow({ choppedWeek: 5, latestChopWeek: 5, removed: false })).toBe('open')
    expect(lastWordsWindow({ choppedWeek: 5, latestChopWeek: null, removed: false })).toBe('open')
  })

  it('closed once a later team has been chopped', () => {
    expect(lastWordsWindow({ choppedWeek: 5, latestChopWeek: 6, removed: false })).toBe('closed')
  })

  it('a team that is still alive has no last words', () => {
    expect(lastWordsWindow({ choppedWeek: null, latestChopWeek: 6, removed: false })).toBe('not_chopped')
  })

  it('a removed message cannot be written again, even while the week is still the latest', () => {
    expect(lastWordsWindow({ choppedWeek: 5, latestChopWeek: 5, removed: true })).toBe('removed')
  })
})
