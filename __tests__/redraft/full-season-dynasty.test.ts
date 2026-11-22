/**
 * DYNASTY, the whole season, in NBA, NHL and MLB (phase 8, 2026-10-29). The redraft suites beside this
 * one run the same season and end in a redraft renewal; a dynasty league ends differently, and that
 * end had never been run in these sports: next season's shell with every roster carried, records
 * reset, and the rookie draft order (worst to first, the champion last).
 *
 * Same harness and invariants as the redraft suites (`__tests__/helpers/redraftFullSeasonHarness.ts`,
 * `dynasty: true`): draft → every regular-season week → playoffs → champion → dynasty rollover.
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

describeFullSeason('NBA dynasty full season — 10 teams (6-team bracket, two byes)', { sport: 'NBA', teamCount: 10, dynasty: true })
describeFullSeason('NHL dynasty full season — 12 teams', { sport: 'NHL', teamCount: 12, dynasty: true }, { timeoutMs: 600_000 })
describeFullSeason('MLB dynasty full season — 12 teams', { sport: 'MLB', teamCount: 12, dynasty: true }, { timeoutMs: 600_000 })
describeFullSeason('MLB dynasty full season — 9 teams (odd: bye + league median)', { sport: 'MLB', teamCount: 9, dynasty: true })
