/**
 * NFL redraft, the whole season at the sizes the G43 simulation does not cover.
 *
 * `lib/redraft-season-simulation/canonicalNflRedraftFullSeasonSimulation.ts` (G43) plays ONE league:
 * 4 teams, a hand-set 3-week season and a 2-team bracket, through the pure runtimes. These play the
 * league a commissioner actually gets from creation — the sport's 17 weeks, the size-fitted bracket —
 * at 4, 20 and an odd 9 (league median on by default), plus 9 with the extra matchup instead of a
 * plain bye. Draft → every regular-season week (waivers, scoring, standings) → playoffs (third-place
 * game, consolation bracket) → champion → renewal, through the DB-backed engines on the in-memory
 * Prisma (`__tests__/helpers/inMemoryPrisma.ts`). Invariants: `__tests__/helpers/redraftFullSeasonInvariants.ts`.
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

describeFullSeason('NFL redraft full season — 4 teams', { sport: 'NFL', teamCount: 4 })
describeFullSeason('NFL redraft full season — 20 teams', { sport: 'NFL', teamCount: 20 })
describeFullSeason('NFL redraft full season — 9 teams (odd: bye + league median)', { sport: 'NFL', teamCount: 9 })
describeFullSeason('NFL redraft full season — 9 teams (odd: extra matchup instead of the bye)', {
  sport: 'NFL',
  teamCount: 9,
  medianGame: false,
  extraMatchup: { enabled: true, opponent: 'top_scorer', scoring: 'leftover_only' },
})
describeFullSeason('NFL redraft full season — 9 teams (median AND extra matchup counting for both, a tied week, tied playoffs)', {
  sport: 'NFL',
  teamCount: 9,
  extraMatchup: { enabled: true, opponent: 'median', scoring: 'both' },
  tieWeeks: [4],
  tiePlayoffs: true,
})
describeFullSeason('NFL redraft full season — 4 teams, every playoff game tied', { sport: 'NFL', teamCount: 4, tieWeeks: [2], tiePlayoffs: true })
