import { describe, expect, it } from 'vitest'

import { normalizeGameStatus } from '@/lib/scores/gameScoreProviders'

/**
 * sports_games.status held every provider's dialect at once. Measured in
 * production: "scheduled", "Finished", "NS", "FT", "completed", "After Over
 * Time", "AOT", "Final", "TBD" — and one NCAAF row whose status was the literal
 * string "9/6 - 7:30 PM EDT".
 *
 * Any downstream "is this game over?" check was therefore guesswork, and the
 * comfortable default (unknown means not-final) mislabels finished games as
 * still to come.
 */

describe('every provider dialect collapses to one vocabulary', () => {
  const finals = ['Finished', 'FT', 'completed', 'Final', 'After Over Time', 'AOT', 'final/OT', 'post']
  for (const raw of finals) {
    it(`treats "${raw}" as final`, () => {
      expect(normalizeGameStatus(raw)).toBe('final')
    })
  }

  const scheduled = ['NS', 'TBD', 'scheduled', 'pre', 'not started', 'upcoming']
  for (const raw of scheduled) {
    it(`treats "${raw}" as scheduled`, () => {
      expect(normalizeGameStatus(raw)).toBe('scheduled')
    })
  }

  it('reads a live quarter as in progress', () => {
    expect(normalizeGameStatus('Q3')).toBe('in_progress')
    expect(normalizeGameStatus('halftime')).toBe('in_progress')
    expect(normalizeGameStatus('in progress')).toBe('in_progress')
  })

  it('is idempotent, so a second pass cannot corrupt a canonical value', () => {
    // Normalisation runs centrally over every provider, including ones that
    // already emit canonical values.
    for (const v of ['scheduled', 'in_progress', 'final', 'postponed', 'canceled']) {
      expect(normalizeGameStatus(v)).toBe(v)
    }
  })
})

describe('it refuses rather than guesses', () => {
  it('returns null for an unrecognised status', () => {
    // Null reads as "we do not know". Defaulting to "scheduled" would be a
    // claim about a game we have no state for.
    expect(normalizeGameStatus('garbage')).toBeNull()
    expect(normalizeGameStatus('')).toBeNull()
    expect(normalizeGameStatus(null)).toBeNull()
    expect(normalizeGameStatus(undefined)).toBeNull()
  })

  it('treats a kickoff time in the status column as scheduled', () => {
    // A real NCAAF row stored "9/6 - 7:30 PM EDT" as its status. That is a
    // scheduling artefact, not a game state.
    expect(normalizeGameStatus('9/6 - 7:30 PM EDT')).toBe('scheduled')
    expect(normalizeGameStatus('7:30 PM')).toBe('scheduled')
  })

  it('keeps postponed and canceled distinct from scheduled', () => {
    // A postponed game is not upcoming, and collapsing it would put a game on
    // the slate that nobody is playing.
    expect(normalizeGameStatus('Postponed')).toBe('postponed')
    expect(normalizeGameStatus('game suspended')).toBe('postponed')
    expect(normalizeGameStatus('Canceled')).toBe('canceled')
    expect(normalizeGameStatus('abandoned')).toBe('canceled')
  })
})
