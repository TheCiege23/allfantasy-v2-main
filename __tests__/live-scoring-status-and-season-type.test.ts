import { describe, it, expect } from 'vitest'
import { normalizeLiveGameStatus } from '@/lib/live-scoring/cadence'
import { resolveSeasonType } from '@/lib/live-scoring/provider'
import { pickSlate, resolveNflSeasonType } from '@/server/services/liveScoring/liveScoreRunner'
import { normalizeSeasonType } from '@/lib/scores/gameScoreProviders'

/**
 * `import-scores` wrote API-Sports' `status.long` into sportsGame.status, a
 * dialect this map did not contain. Unknown input falls through to 'scheduled',
 * so a game that had kicked off AND a game that had ended both read as
 * not-yet-started: the cadence engine never reached live cadence and never
 * reported all-final, so it never stopped polling either.
 *
 * The writer now normalises, but rows written before that still hold the long
 * forms — which is why the READ side has to speak the dialect too.
 */
describe('normalizeLiveGameStatus — API-Sports long-form dialect', () => {
  it('reads a game in progress as in_progress, not scheduled', () => {
    for (const raw of ['First Quarter', 'Second Quarter', 'Third Quarter', 'Fourth Quarter']) {
      expect(normalizeLiveGameStatus(raw)).toBe('in_progress')
    }
  })

  it('reads a finished game as final, not scheduled', () => {
    expect(normalizeLiveGameStatus('Finished')).toBe('final')
    expect(normalizeLiveGameStatus('Match Finished')).toBe('final')
  })

  it('treats "After Over Time" as TERMINAL, not as a game still in overtime', () => {
    // AOT means the game ENDED in overtime. Filing it under 'overtime' would
    // mean it never reads as final — the exact bug being closed.
    expect(normalizeLiveGameStatus('After Over Time')).toBe('final')
    expect(normalizeLiveGameStatus('AOT')).toBe('final')
  })

  it('still reads not-yet-started games as scheduled', () => {
    expect(normalizeLiveGameStatus('Not Started')).toBe('scheduled')
    expect(normalizeLiveGameStatus('TBD')).toBe('scheduled')
  })

  it('keeps the short-code and generic vocabularies working', () => {
    expect(normalizeLiveGameStatus('NS')).toBe('scheduled')
    expect(normalizeLiveGameStatus('Q3')).toBe('in_progress')
    expect(normalizeLiveGameStatus('FT')).toBe('final')
    expect(normalizeLiveGameStatus('HT')).toBe('halftime')
  })
})

/**
 * The Sleeper calls hardcoded `season_type=regular`. During preseason that asks
 * for the not-yet-played regular-season week, and the empty payload is
 * indistinguishable from "nobody has scored yet" — preseason silently scores 0.
 */
describe('resolveSeasonType', () => {
  it('defaults to regular so existing callers and fixtures are unchanged', () => {
    expect(resolveSeasonType({})).toBe('regular')
  })

  it('honours an explicit season type', () => {
    expect(resolveSeasonType({ seasonType: 'pre' })).toBe('pre')
  })
})

describe('resolveNflSeasonType', () => {
  it('calls July and August preseason', () => {
    expect(resolveNflSeasonType(new Date('2026-07-31T23:00:00Z'))).toBe('pre')
    expect(resolveNflSeasonType(new Date('2026-08-20T23:00:00Z'))).toBe('pre')
  })

  it('calls September onward regular', () => {
    expect(resolveNflSeasonType(new Date('2026-09-10T23:00:00Z'))).toBe('regular')
    expect(resolveNflSeasonType(new Date('2026-12-25T18:00:00Z'))).toBe('regular')
  })

  it('does NOT infer postseason from January — those are regular weeks 17-18', () => {
    expect(resolveNflSeasonType(new Date('2027-01-04T18:00:00Z'))).toBe('regular')
  })
})

/**
 * `week` was digit-stripped from labels like "Pre Season - 1", so preseason
 * week 1 and regular week 1 were the same value. `seasonType` is what separates
 * them, and every feed spells it differently.
 */
describe('normalizeSeasonType', () => {
  it('reads API-Sports stage labels', () => {
    expect(normalizeSeasonType('Pre Season')).toBe('pre')
    expect(normalizeSeasonType('Regular Season')).toBe('regular')
    expect(normalizeSeasonType('Post Season')).toBe('post')
  })

  it('reads the Rolling Insights spelling', () => {
    expect(normalizeSeasonType('Preseason')).toBe('pre')
    expect(normalizeSeasonType('Postseason')).toBe('post')
  })

  it('reads ESPN numeric season types', () => {
    expect(normalizeSeasonType(1)).toBe('pre')
    expect(normalizeSeasonType(2)).toBe('regular')
    expect(normalizeSeasonType(3)).toBe('post')
  })

  it('does not let "postseason" match as regular just because it contains "season"', () => {
    // Both 'preseason' and 'postseason' contain the substring 'season'; a
    // generic check would have filed them both under regular.
    expect(normalizeSeasonType('postseason')).not.toBe('regular')
    expect(normalizeSeasonType('preseason')).not.toBe('regular')
  })

  it('returns null for unknown or empty input rather than defaulting to regular', () => {
    // A default here is a CLAIM, and it is the claim that caused the bug.
    expect(normalizeSeasonType('')).toBeNull()
    expect(normalizeSeasonType(null)).toBeNull()
    expect(normalizeSeasonType('week 4')).toBeNull()
  })
})

/**
 * The runner used RedraftSeason.currentWeek for the real-world week. That is a
 * FANTASY week — 0 before kickoff — so every preseason tick asked for week 1
 * regardless of which preseason week was actually being played.
 */
describe('pickSlate', () => {
  const now = new Date('2026-08-20T23:30:00Z')
  const hours = (n: number) => new Date(now.getTime() + n * 60 * 60 * 1000)

  it('derives the real preseason week from the schedule, not from week 1', () => {
    const slate = pickSlate(
      [
        { seasonType: 'pre', week: 3, startTime: hours(-1), status: 'in_progress' },
        { seasonType: 'regular', week: 1, startTime: hours(24 * 18), status: 'scheduled' },
      ],
      now,
    )
    expect(slate).toEqual({ seasonType: 'pre', week: 3, source: 'schedule' })
  })

  it('prefers a game being played over one that merely starts sooner', () => {
    const slate = pickSlate(
      [
        { seasonType: 'pre', week: 3, startTime: hours(-2), status: 'in_progress' },
        { seasonType: 'pre', week: 4, startTime: hours(0.25), status: 'scheduled' },
      ],
      now,
    )
    expect(slate?.week).toBe(3)
  })

  it('ignores rows with no season type rather than treating them as regular', () => {
    expect(pickSlate([{ seasonType: null, week: 3, startTime: hours(-1), status: 'in_progress' }], now)).toBeNull()
  })

  it('returns null when nothing is in the window, so the caller keeps its own week', () => {
    expect(pickSlate([{ seasonType: 'pre', week: 3, startTime: hours(24 * 90), status: 'scheduled' }], now)).toBeNull()
  })
})
