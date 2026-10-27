/**
 * NHL redraft, the whole season, at 4, 10 and 12 teams and odd 9 and 11 (league median on by default).
 *
 * The league is the one creation builds: from the 2026 opener (29 September), playoffs from week 25 —
 * a 4-team field over three weeks up to 9 teams, and from 10 a 6-team field with two first-round byes
 * over four weeks, i.e. a TWO-WEEK championship ending in week 28. It is a DAILY-lineup league
 * (lib/redraft/dailyLineups.ts) that crosses both daylight-saving changes; one team moves a bench centre
 * into UTIL mid-week every week. Skater and goalie lines go through the ingest's own normalizer
 * (`normalizeNhlGameStats`), so a goalie's win and shutout are derived from the game context, as in production.
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

describeFullSeason('NHL redraft full season — 4 teams', { sport: 'NHL', teamCount: 4 })
describeFullSeason('NHL redraft full season — 10 teams (6-team bracket, two byes)', { sport: 'NHL', teamCount: 10 })
describeFullSeason('NHL redraft full season — 12 teams', { sport: 'NHL', teamCount: 12 }, { timeoutMs: 600_000 })
describeFullSeason('NHL redraft full season — 9 teams (odd: bye + league median)', { sport: 'NHL', teamCount: 9 })
describeFullSeason('NHL redraft full season — 11 teams (median AND extra matchup, a tied week, tied playoffs)', {
  sport: 'NHL',
  teamCount: 11,
  extraMatchup: { enabled: true, opponent: 'top_scorer', scoring: 'leftover_only' },
  tieWeeks: [5],
  tiePlayoffs: true,
})
