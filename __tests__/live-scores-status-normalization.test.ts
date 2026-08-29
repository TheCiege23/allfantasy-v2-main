import { describe, expect, it, vi } from 'vitest'

// The module under test imports prisma at load. These helpers are pure, so a
// stub keeps the test from needing a database.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  dbRowToLiveScore,
  hasStarted,
  pickFreshestSourceRows,
  resolveGameState,
} from '@/lib/sports-live-scores-service'

const row = (status: string | null, scores: { home: number | null; away: number | null }) => ({
  externalId: 'evt-1',
  homeTeam: 'BUF',
  awayTeam: 'PIT',
  homeScore: scores.home,
  awayScore: scores.away,
  status,
  startTime: new Date('2026-08-28T03:00:00.000Z'),
  venue: null,
  week: 1,
  season: 2026,
  fetchedAt: new Date('2026-08-28T02:34:00.000Z'),
})

describe('resolveGameState', () => {
  it('reads an ESPN display string as scheduled, not as a state', () => {
    // This exact value was measured on 4 sports' worth of production rows.
    expect(resolveGameState('8/27 - 7:00 PM EDT')).toBe('scheduled')
  })

  it('treats a game between quarters as in progress', () => {
    // STATUS_END_PERIOD matches none of the shared normalizer's patterns and
    // came back null before this — which would have nulled a real score.
    expect(resolveGameState('STATUS_END_PERIOD')).toBe('in_progress')
    expect(resolveGameState('STATUS_HALFTIME')).toBe('in_progress')
  })

  it('understands the other providers, not just ESPN', () => {
    expect(resolveGameState('Match Finished')).toBe('final')
    expect(resolveGameState('scheduled')).toBe('scheduled')
    expect(resolveGameState('Q2')).toBe('in_progress')
  })

  it('reads the real in-play string production wrote during PIT @ BUF', () => {
    // Captured live 2026-08-27 23:43Z, Steelers 14 Bills 3, second quarter.
    // This is the exact value espn_live stores for a game being played, so it
    // is the one case that decides whether the live badge lights on gameday.
    expect(resolveGameState('15:00 - 2nd')).toBe('in_progress')
    expect(hasStarted('15:00 - 2nd')).toBe(true)
  })

  it('handles the short vendor codes actually present in production', () => {
    // 186 rows across these three. All were unresolvable before, and all three
    // are already known to lib/sports/gameStatus — complementary blind spots.
    expect(resolveGameState('AP')).toBe('final')
    expect(resolveGameState('CANC')).toBe('canceled')
    expect(resolveGameState('PST')).toBe('postponed')
  })

  it('returns null rather than guessing at an unknown vocabulary', () => {
    expect(resolveGameState('wat')).toBeNull()
    expect(resolveGameState(null)).toBeNull()
  })
})

describe('hasStarted — the gate that decides whether a score is real', () => {
  it('is false before kickoff, so the score is stored NULL not 0-0', () => {
    expect(hasStarted('STATUS_SCHEDULED')).toBe(false)
    expect(hasStarted('8/27 - 7:00 PM EDT')).toBe(false)
  })

  it('is true once play begins or ends', () => {
    expect(hasStarted('STATUS_IN_PROGRESS')).toBe(true)
    expect(hasStarted('STATUS_FINAL')).toBe(true)
  })

  it('is false for an unrecognised status, parking the score rather than inventing one', () => {
    expect(hasStarted('something new')).toBe(false)
  })
})

describe('the value written to SportsGame.status must satisfy EVERY reader', () => {
  // Three normalizers read this column and they do not agree. Writing ESPN's
  // own STATUS_FINAL token satisfies this module and returns 'unknown' from
  // Chimmy's — which would have reported every finished game as unreadable.
  // These assertions are the reason the writer stores lowercase canonical.
  const WRITTEN = ['scheduled', 'in_progress', 'final', 'postponed', 'canceled'] as const

  it('POSITIVE CONTROL: the ESPN token really is unreadable to Chimmy', async () => {
    // Without this the suite above could pass vacuously. This is the actual
    // trap: STATUS_FINAL is a perfectly good status to this module and means
    // nothing to the reader Chimmy uses, so storing it would have silently
    // turned every completed game into "state unknown" in Chimmy's answers.
    const { normalizeGameStatus: chimmyNormalize } = await import('@/lib/sports/gameStatus')
    expect(chimmyNormalize('STATUS_FINAL')).toBe('unknown')
    expect(chimmyNormalize('STATUS_IN_PROGRESS')).toBe('unknown')
  })

  it('is understood by Chimmy slate grounding (lib/sports/gameStatus)', async () => {
    const { normalizeGameStatus: chimmyNormalize } = await import('@/lib/sports/gameStatus')
    for (const value of WRITTEN) {
      expect(chimmyNormalize(value), `chimmy could not read "${value}"`).not.toBe('unknown')
    }
  })

  it('is understood by this module on the way back out', () => {
    for (const value of WRITTEN) {
      expect(resolveGameState(value), `round-trip lost "${value}"`).not.toBeNull()
    }
  })

  it('round-trips each state back to itself', () => {
    for (const value of WRITTEN) {
      expect(resolveGameState(value)).toBe(value)
    }
  })
})

describe('dbRowToLiveScore — cached rows must speak the UI vocabulary', () => {
  it('surfaces an in-play game as live instead of upcoming', () => {
    // Before: status was the raw clock string, which equals no STATUS_* token,
    // so ScoresTab fell through to its default branch and rendered a game in
    // progress as UPCOMING with an em-dash where the score should be.
    const mapped = dbRowToLiveScore(row('Q2 5:43', { home: 14, away: 7 }))
    expect(mapped.status).toBe('STATUS_IN_PROGRESS')
    expect(mapped.completed).toBe(false)
    expect(mapped.statusDetail).toBe('Q2 5:43')
  })

  it('marks a TheSportsDB finished game as final', () => {
    const mapped = dbRowToLiveScore(row('Match Finished', { home: 24, away: 20 }))
    expect(mapped.status).toBe('STATUS_FINAL')
    expect(mapped.completed).toBe(true)
  })

  it('keeps an unstarted game scheduled and uncompleted', () => {
    const mapped = dbRowToLiveScore(row('8/27 - 7:00 PM EDT', { home: null, away: null }))
    expect(mapped.status).toBe('STATUS_SCHEDULED')
    expect(mapped.completed).toBe(false)
  })

  it('does not echo a machine token back as the caption', () => {
    // Assertion updated 2026-08-29: this used to pin the fallback label
    // 'Scheduled'. A scheduled row now captions itself with the kickoff it
    // already holds, which serves this test's stated intent — no machine token
    // on screen — better than the label did. The intent is what is asserted
    // here; the token check is the part that must never regress.
    const mapped = dbRowToLiveScore(row('STATUS_SCHEDULED', { home: null, away: null }))
    expect(mapped.statusDetail).not.toBe('STATUS_SCHEDULED')
    expect(mapped.statusDetail).not.toBe('scheduled')
    expect(mapped.statusDetail).toBe('8/27 - 11:00 PM EDT')
  })

  it('defaults an unknown status to scheduled rather than claiming a result', () => {
    const mapped = dbRowToLiveScore(row('wat', { home: null, away: null }))
    expect(mapped.status).toBe('STATUS_SCHEDULED')
    expect(mapped.completed).toBe(false)
  })
})

describe('pickFreshestSourceRows — a stale favourite must not beat a live feed', () => {
  // Reproduces production at 2026-08-27 23:43Z, mid PIT @ BUF.
  //
  // rolling_insights outranks espn_live in LIVE_SOURCE_PREFERENCE, and rank was
  // applied BEFORE freshness — so a feed three hours cold won the slate while
  // ESPN held the actual 14-3. Both sit inside the 6h "dead feed" window, so
  // that guard never fires. This is the scoreboard showing kickoff times during
  // a game that is on television.
  const NOW = new Date('2026-08-28T03:43:31Z').getTime()

  const rollingInsights = {
    source: 'rolling_insights',
    fetchedAt: new Date('2026-08-28T00:30:03Z'), // 3h13m stale
    label: 'RI scheduled, no score',
  }
  const espnLive = {
    source: 'espn_live',
    fetchedAt: new Date('2026-08-28T03:43:29Z'), // 2 seconds old
    label: 'ESPN 15:00 - 2nd, 14-3',
  }

  it('picks the feed that actually has the live game', () => {
    const picked = pickFreshestSourceRows([rollingInsights, espnLive], NOW)
    expect(picked.map((r) => r.source)).toEqual(['espn_live'])
  })

  it('still honours preference between feeds of comparable freshness', () => {
    // Same minute: rank is the right tiebreak, and rolling_insights wins it.
    const riFresh = { ...rollingInsights, fetchedAt: new Date('2026-08-28T03:43:20Z') }
    const picked = pickFreshestSourceRows([espnLive, riFresh], NOW)
    expect(picked.map((r) => r.source)).toEqual(['rolling_insights'])
  })

  it('ignores a long-dead feed even when it outranks everything', () => {
    const ancient = { ...rollingInsights, fetchedAt: new Date('2026-04-26T00:00:00Z') }
    const picked = pickFreshestSourceRows([ancient, espnLive], NOW)
    expect(picked.map((r) => r.source)).toEqual(['espn_live'])
  })
})

/**
 * A cached row's caption used to read `scheduled` — the literal stored token,
 * printed at the user. It differs from `STATUS_SCHEDULED`, so it took the
 * pass-through branch meant for human-readable strings like "Q2 5:43".
 *
 * On 2026-08-29 that put seven restored NCAAF fixtures on the live page reading
 * "scheduled" beside a live row reading "8/29 - 3:00 PM EDT", while the kickoff
 * time sat unused in the same object.
 */
describe('scheduled captions', () => {
  const at = (iso: string) => ({
    externalId: 'evt-1',
    homeTeam: 'TCU',
    awayTeam: 'UNC',
    homeScore: null,
    awayScore: null,
    status: 'scheduled',
    startTime: new Date(iso),
    venue: null,
    week: 1,
    season: 2026,
    fetchedAt: new Date('2026-08-29T12:15:00.000Z'),
  })

  it('prints the kickoff instead of the stored token', () => {
    // 16:00Z is noon Eastern.
    expect(dbRowToLiveScore(at('2026-08-29T16:00:00.000Z')).statusDetail).toBe(
      '8/29 - 12:00 PM EDT',
    )
  })

  it('says Scheduled rather than midnight when the kickoff is unannounced', () => {
    // The placeholder repair fills these upstream, but a fixture no schedule
    // feed knows still reaches here. "12:00 AM EDT" would be an invented time.
    const row = dbRowToLiveScore(at('2026-08-29T04:00:00.000Z'))
    expect(row.statusDetail).not.toContain('12:00 AM')
    expect(row.statusDetail).toBe('Scheduled')
  })

  it('says Scheduled when there is no start time at all', () => {
    expect(dbRowToLiveScore({ ...at('2026-08-29T16:00:00.000Z'), startTime: null }).statusDetail).toBe(
      'Scheduled',
    )
  })

  it('leaves an in-play caption alone', () => {
    // POSITIVE CONTROL: a guard that captioned every row by start time would
    // replace a live clock with a kickoff time.
    const live = { ...at('2026-08-29T16:00:00.000Z'), status: 'Q2 5:43' }
    expect(dbRowToLiveScore(live).statusDetail).toBe('Q2 5:43')
  })
})

/**
 * The last unguarded fake zero on this path.
 *
 * `LiveScoreRow.homeScore` was typed `number` while the column behind it is
 * nullable, so `dbRowToLiveScore` wrote `?? 0` to satisfy the type — and every
 * consumer received a 0-0 result for a game whose score we simply do not have.
 * Measured 2026-08-29: 47 NFL rows carry status `final` with both scores NULL,
 * 14 of them inside the live window.
 *
 * The type was the outlier, not the data. THREE consumers were already written
 * for the null this type forbade: estimateWinProbability returns null on it,
 * SportsScheduleContextProvider writes `?? null` for Chimmy, and
 * playoffSeriesSyncService declares `number | null` and guards on it.
 */
describe('a score we do not have', () => {
  const finished = (home: number | null, away: number | null) => ({
    externalId: 'evt-9',
    homeTeam: 'BUF',
    awayTeam: 'PIT',
    homeScore: home,
    awayScore: away,
    status: 'final',
    startTime: new Date('2026-08-28T03:00:00.000Z'),
    venue: null,
    week: 1,
    season: 2026,
    fetchedAt: new Date('2026-08-29T12:15:00.000Z'),
  })

  it('carries a missing score through as null, not zero', () => {
    const mapped = dbRowToLiveScore(finished(null, null))
    expect(mapped.homeScore).toBeNull()
    expect(mapped.awayScore).toBeNull()
    // Still a final — we know it ended, we just cannot say how.
    expect(mapped.completed).toBe(true)
  })

  it('keeps a real 0-0 as the result it is', () => {
    // POSITIVE CONTROL. Zero and absent are different facts, and the whole
    // point of the change is that the type can now tell them apart.
    const mapped = dbRowToLiveScore(finished(0, 0))
    expect(mapped.homeScore).toBe(0)
    expect(mapped.awayScore).toBe(0)
  })

  it('does not invent the other half of a one-sided score', () => {
    const mapped = dbRowToLiveScore(finished(52, null))
    expect(mapped.homeScore).toBe(52)
    expect(mapped.awayScore).toBeNull()
  })
})
