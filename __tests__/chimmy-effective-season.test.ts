/**
 * Which season a Chimmy answer is about.
 *
 * 🛑 THIS IS NOT A LABEL TEST. The resolved season keys the sports reads inside
 * `buildLeagueSportsGroundingPacket` — `loadPlayerPoolSummary`,
 * `loadFantasyData`, `loadScheduleSummary` and provider health — so getting it
 * wrong does not mislabel an answer, it changes the evidence underneath one. The
 * bug this replaces let a client form field outrank the league's own season, so
 * a 2019 player pool could sit behind an answer about a 2026 league under a
 * grounding line that read `season=2026`.
 */
import { describe, expect, it } from 'vitest'

import { resolveEffectiveSeason } from '@/lib/chimmy/effectiveSeason'

const NOW = new Date('2026-09-16T00:00:00.000Z')

function resolve(over: Partial<Parameters<typeof resolveEffectiveSeason>[0]> = {}) {
  return resolveEffectiveSeason({
    leagueSeason: 2026,
    requestedSeason: null,
    message: 'who should I start at flex?',
    now: NOW,
    ...over,
  })
}

describe('the league outranks the client', () => {
  it('ignores a season the client asked for when a league is in scope', () => {
    expect(resolve({ requestedSeason: 2019 })).toEqual({ season: 2026, source: 'league' })
  })

  it('uses the league season when the client sends nothing', () => {
    expect(resolve()).toEqual({ season: 2026, source: 'league' })
  })

  /*
   * With no league there is nothing to outrank the form field, so it decides.
   * This is the ONLY path on which it wins, and it is unchanged behaviour for
   * every global question.
   */
  it('falls back to the client field only when there is no league', () => {
    expect(resolve({ leagueSeason: null, requestedSeason: 2024 })).toEqual({
      season: 2024,
      source: 'request',
    })
  })

  it('reports nothing rather than guessing when it has no signal at all', () => {
    expect(resolve({ leagueSeason: null, requestedSeason: null })).toEqual({
      season: null,
      source: 'none',
    })
  })
})

describe('an explicit year in the question reopens the past', () => {
  /*
   * The reason the league does not simply always win. Answering "how did I do in
   * 2025?" with this season's data is a wrong answer with no tell, which is
   * worse than the bug being fixed.
   */
  it.each([
    ['how did I do in 2025?', 2025],
    ['what was my record in 2024', 2024],
    ['compare my 2023 draft to this one', 2023],
  ])('%s → %d', (message, expected) => {
    expect(resolve({ message })).toEqual({ season: expected, source: 'question' })
  })

  /*
   * ⚠ TWO YEARS IS NOT ONE ANSWER. Picking either would be a guess presented as
   * a fact; the league season is stated in the grounding line, so falling back
   * is legible rather than silent.
   */
  it('refuses to choose when the question names two seasons', () => {
    expect(resolve({ message: 'compare 2024 and 2025' })).toEqual({
      season: 2026,
      source: 'league',
    })
  })

  it('treats the same year twice as one year', () => {
    expect(resolve({ message: 'in 2024, was my 2024 draft any good?' })).toEqual({
      season: 2024,
      source: 'question',
    })
  })
})

describe('what is not a season', () => {
  /*
   * 🛑 THE POSITIVE CONTROL FOR A BUG THAT ALREADY HAPPENED. The word boundaries
   * in this pattern were eaten TWICE by a shell escaping layer while the
   * function was being written, arriving as a literal backspace (0x08) in the
   * source. The file parsed, the regex compiled, and the degraded form still
   * matched years — just also inside longer digit runs. Sleeper player ids are
   * exactly that shape, and they are all over these messages.
   */
  it.each([
    'is 120255 a good player id',
    'my FAAB is 12025 after that claim',
    'roster slot 2026x',
  ])('does not read a season out of: %s', (message) => {
    expect(resolve({ message }).source).toBe('league')
  })

  /* The numeric bound: a four-digit number that cannot be a season. */
  it.each([
    'he wore 1987 in college',
    'what about 2099',
    'back in 1999',
  ])('ignores an out-of-range year: %s', (message) => {
    expect(resolve({ message }).source).toBe('league')
  })

  /*
   * `year + 1` is the furthest ahead anyone can sensibly ask about, and it must
   * be INSIDE the range — an off-by-one here silently drops every question about
   * next season.
   */
  it('accepts next season, being the edge of the range', () => {
    expect(resolve({ message: 'who should I keep for 2027?' })).toEqual({
      season: 2027,
      source: 'question',
    })
  })

  it('rejects the year after that', () => {
    expect(resolve({ message: 'who should I keep for 2028?' }).source).toBe('league')
  })
})
