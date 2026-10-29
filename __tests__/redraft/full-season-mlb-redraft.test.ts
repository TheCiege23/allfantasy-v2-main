/**
 * MLB redraft, the whole season, at 4, 10 and 20 teams and an odd 11 (league median on by default).
 *
 * The league is the one creation builds — 27 weeks, the size-fitted bracket (a 4-team field starts
 * week 25, a 6-team one week 24), the two-week championship, the third-place game on and no
 * consolation bracket — and it is a DAILY-lineup league: each Eastern day is scored on that day's
 * starters (lib/redraft/dailyLineups.ts), so every week one team changes its lineup mid-week and the
 * engine's total is checked against a day-by-day sum computed here. Stat lines go through the
 * ingest's own box-line normalizer (`normalizeMlbGameStats`), so pitchers score on converted innings,
 * quality starts and pitching strikeouts, never on batting keys.
 *
 * Draft → every regular-season week (waivers, daily scoring, standings) → playoffs → champion →
 * renewal, through the DB-backed engines on the in-memory Prisma (`__tests__/helpers/inMemoryPrisma.ts`).
 * Invariants: `__tests__/helpers/redraftFullSeasonInvariants.ts`.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', async () => {
  const { inMemoryPrisma } = await import('../helpers/inMemoryPrisma')
  return { prisma: inMemoryPrisma.client, default: inMemoryPrisma.client }
})
vi.mock('@/lib/events', () => ({
  getPlatformEvents: () => ({ emit: async () => undefined }),
  EVENT: new Proxy({}, { get: (_t, key) => String(key) }),
}))

import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { normalizeMlbGameStats } from '@/lib/scoring-runtime/mlbStatNormalization'
import { describeFullSeason } from '../helpers/redraftFullSeasonInvariants'

describe('MLB pitcher scoring, by hand', () => {
  it('scores a start on true innings, strikeouts, the win and the quality start; hits allowed are a pitcher\'s', () => {
    // The default MLB points league: IP 3 an inning (1 an out), K 1, W 5, L -5, QS 3, ER -2, H and BB allowed -1.
    const scorer = buildLeagueStatScorer({ sport: 'MLB', settings: null })!
    // 6.2 IP is 6⅔ innings — 20 outs — not 6.2.
    const start = normalizeMlbGameStats({ group: 'pitching', stats: { IP: 6.2, K: 7, W: 1, ER: 2, H: 6, BB: 1 } }).stats
    expect(start).toMatchObject({ outs: 20, qs: 1, so: 7, p_h: 6, p_bb: 1 })
    expect(scorer(start, 'SP')).toBeCloseTo(20 + 7 + 5 + 3 - 4 - 6 - 1, 6)
    // A short start: 4.1 IP is 13 outs, and no quality start.
    const short = normalizeMlbGameStats({ group: 'pitching', stats: { IP: 4.1, K: 3, L: 1, ER: 4 } }).stats
    expect(short.qs).toBe(0)
    expect(scorer(short, 'SP')).toBeCloseTo(13 + 3 - 5 - 8, 6)
    // The same field names on a batting line score as a hitter's: 1B 1, HR 4, R 1, RBI 1 each, SO -1.
    const bat = normalizeMlbGameStats({ group: 'batting', stats: { H: 2, '1B': 1, HR: 1, R: 1, RBI: 2, SO: 1 } }).stats
    expect(bat.p_h).toBeUndefined()
    expect(scorer(bat, 'OF')).toBeCloseTo(1 + 4 + 1 + 2 - 1, 6)
  })
})

describeFullSeason('MLB redraft full season — 4 teams', { sport: 'MLB', teamCount: 4 })
describeFullSeason('MLB redraft full season — 10 teams', { sport: 'MLB', teamCount: 10 })
describeFullSeason('MLB redraft full season — 20 teams', { sport: 'MLB', teamCount: 20 }, { timeoutMs: 600_000 })
describeFullSeason('MLB redraft full season — 11 teams (odd: bye + league median)', { sport: 'MLB', teamCount: 11 })
describeFullSeason('MLB redraft full season — 11 teams (median AND extra matchup, a tied week, tied playoffs)', {
  sport: 'MLB',
  teamCount: 11,
  extraMatchup: { enabled: true, opponent: 'top_scorer', scoring: 'leftover_only' },
  tieWeeks: [5],
  tiePlayoffs: true,
})
