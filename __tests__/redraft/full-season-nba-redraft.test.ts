/**
 * NBA redraft, the whole season, at 4, 10 and 12 teams and odd 9 and 11 (league median on by default).
 *
 * The league is the one creation builds: 25 weeks from the 2026 opener (20 October), a 4-team field
 * from week 24 up to 9 teams and a 6-team field with two first-round byes from week 23 from 10, the
 * championship in week 25. It is a DAILY-lineup league (lib/redraft/dailyLineups.ts): each Eastern day
 * is scored on that day's starters, one team moves a bench guard into UTIL mid-week every week, and the
 * season crosses the November daylight-saving change. Stat lines go through the ingest's own
 * normalizer (`normalizeNbaGameStats`), so double-doubles are derived per game, as in production.
 *
 * Draft → every regular-season week (waivers, daily scoring, standings) → playoffs → champion →
 * renewal, through the DB-backed engines on the in-memory Prisma (`__tests__/helpers/inMemoryPrisma.ts`).
 * Invariants: `__tests__/helpers/redraftFullSeasonInvariants.ts`.
 */
import { vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', async () => {
  const { inMemoryPrisma } = await import('../helpers/inMemoryPrisma')
  return { prisma: inMemoryPrisma.client, default: inMemoryPrisma.client }
})
vi.mock('@/lib/events', () => ({
  getPlatformEvents: () => ({ emit: async () => undefined }),
  EVENT: new Proxy({}, { get: (_t, key) => String(key) }),
}))

import { describeFullSeason } from '../helpers/redraftFullSeasonInvariants'

describeFullSeason('NBA redraft full season — 4 teams', { sport: 'NBA', teamCount: 4 })
describeFullSeason('NBA redraft full season — 10 teams (6-team bracket, two byes)', { sport: 'NBA', teamCount: 10 })
describeFullSeason('NBA redraft full season — 12 teams', { sport: 'NBA', teamCount: 12 }, { timeoutMs: 600_000 })
describeFullSeason('NBA redraft full season — 9 teams (odd: bye + league median)', { sport: 'NBA', teamCount: 9 })
describeFullSeason('NBA redraft full season — 11 teams (median AND extra matchup, a tied week, tied playoffs)', {
  sport: 'NBA',
  teamCount: 11,
  extraMatchup: { enabled: true, opponent: 'top_scorer', scoring: 'leftover_only' },
  tieWeeks: [5],
  tiePlayoffs: true,
})
