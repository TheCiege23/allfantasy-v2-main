// @vitest-environment node
/**
 * A league the provider has deleted gets its own state on the Sync screen.
 *
 * The collector records it as `skipped` + `league gone at provider: …` and deliberately leaves
 * `consecutiveFailures` alone, so the screen's failure alert never fired and the league read as
 * "Never synced" — with no way to act. Measured 2026-09-28: two Sleeper leagues in exactly that
 * state through a whole game day.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  states: {} as Record<string, Record<string, unknown> | null>,
  importer: 'user-1' as string | null,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueSyncState: {
      findUnique: vi.fn(async (args: { where: { runKey: string } }) => h.states[args.where.runKey] ?? null),
    },
    roster: { findFirst: vi.fn(async () => null) },
    weeklyMatchup: { findFirst: vi.fn(async () => null) },
    matchupFact: { findMany: vi.fn(async () => []) },
    syncJobRun: { findFirst: vi.fn(async () => null) },
  },
}))
vi.mock('@/lib/core-app/syncPreferences', () => ({ getPausedSyncKeys: vi.fn(async () => new Set<string>()) }))

import { getLeagueSync } from '@/lib/core-app/leagueSync'
import { LEAGUE_GONE_ERROR_PREFIX } from '@/lib/import-os/collector/leagueGone'
import type { LeagueContext } from '@/lib/core-app/leagueContext'

const NOW = new Date('2026-09-28T03:00:00Z')
const L = 'league-1'
const U = 'user-1'
const FULL = 'sleeper:SL1:2026'
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000)

function ctx(): LeagueContext {
  return {
    leagueId: L,
    userId: U,
    league: vi.fn(async () => ({
      id: L,
      name: 'Deleted League',
      platform: 'sleeper',
      platformLeagueId: 'SL1',
      season: 2026,
      userId: h.importer,
      lastSyncedAt: null,
      createdAt: new Date('2026-08-01T00:00:00Z'),
    })),
    claimedTeam: vi.fn(async () => ({ id: 'team-1' })),
    claimedTeams: vi.fn(async () => []),
  } as unknown as LeagueContext
}

async function load() {
  const result = await getLeagueSync(L, U, NOW, ctx())
  if (!result.available) throw new Error(`unavailable: ${result.reason}`)
  return result
}

const gone = (attemptMinsAgo: number) => ({
  syncStatus: 'skipped',
  lastError: `${LEAGUE_GONE_ERROR_PREFIX}Sleeper returned no league for SL1`,
  lastAttemptedSyncAt: minsAgo(attemptMinsAgo),
  lastSuccessfulSyncAt: null,
  consecutiveFailures: 0,
})

beforeEach(() => {
  h.states = {}
  h.importer = U
})

describe('Sync screen: a league the provider deleted', () => {
  it('reads as gone, with when we last asked and the provider detail', async () => {
    h.states[FULL] = gone(90)
    const r = await load()
    expect(r.status).toBe('gone')
    expect(r.providerGone).toEqual({ checkedAt: minsAgo(90), detail: 'Sleeper returned no league for SL1' })
  })

  it('is recognised when only the five-minute lane learned it', async () => {
    h.states[`${FULL}:active`] = gone(20)
    const r = await load()
    expect(r.status).toBe('gone')
    expect(r.providerGone?.checkedAt).toEqual(minsAgo(20))
  })

  it('clears as soon as a NEWER attempt on either lane is not a gone answer', async () => {
    h.states[FULL] = gone(90)
    h.states[`${FULL}:active`] = {
      syncStatus: 'success',
      lastError: null,
      lastAttemptedSyncAt: minsAgo(5),
      lastSuccessfulSyncAt: minsAgo(5),
    }
    const r = await load()
    expect(r.providerGone).toBeNull()
    expect(r.status).not.toBe('gone')
  })

  it('does not treat the credential pre-flight skip as gone — the prefix is the discriminator', async () => {
    h.states[FULL] = { ...gone(10), lastError: 'no usable credentials for espn' }
    const r = await load()
    expect(r.providerGone).toBeNull()
  })

  it('offers removal only on the viewer’s own imported row', async () => {
    h.states[FULL] = gone(90)
    expect((await load()).canRemove).toBe(true)
    h.importer = 'someone-else'
    expect((await load()).canRemove).toBe(false)
  })
})
