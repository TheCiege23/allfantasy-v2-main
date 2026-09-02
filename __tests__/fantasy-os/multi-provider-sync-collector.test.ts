/**
 * The durable collector after it stopped being Sleeper-only.
 *
 * ⚠ EVERY TEST HERE PINS SOMETHING THE GENERALISATION COULD PLAUSIBLY HAVE GOT WRONG IN A WAY
 * NOTHING WOULD NOTICE. The collector was Sleeper-shaped in exactly three places — enumeration,
 * the fetch, and the names — and two of the three had a silent failure mode waiting:
 *
 *   - a credential problem misclassified as a provider outage, which drives retry backoff
 *     against a provider that is behaving perfectly;
 *   - a league that did nothing counted as refreshed, so the heartbeat reports a sweep of
 *     leagues it never touched.
 *
 * Deterministic: the loader takes its pipeline and its candidate resolver by injection, so
 * nothing here reaches prisma or a provider.
 */
import { describe, it, expect, vi } from 'vitest'

/*
 * Only the reads the credential pre-flight and the due-check make. The loader tests below take
 * their dependencies by injection and never reach any of this.
 */
const h = vi.hoisted(() => ({
  prisma: {
    league: { findMany: vi.fn(async () => []), groupBy: vi.fn(async () => []) },
    leagueAuth: { findMany: vi.fn(async () => []) },
    leagueSyncState: { findUnique: vi.fn(async () => null) },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))

import {
  fetchNormalizedForConnection,
  SyncCredentialsUnavailableError,
  SyncLeagueGoneError,
  MAX_USER_CANDIDATES,
} from '@/lib/fantasy-os/sync/collector/normalizedLoader'
import {
  providerNeedsCredential,
  SYNCABLE_PROVIDERS,
  type LeagueSyncConnection,
} from '@/lib/fantasy-os/sync/collector/types'
import type { NormalizedImportResult } from '@/lib/league-import/types'

function connection(overrides: Partial<LeagueSyncConnection> = {}): LeagueSyncConnection {
  return {
    runKey: 'espn:123:2026',
    provider: 'espn',
    externalLeagueId: '123',
    season: 2026,
    sport: 'NFL',
    ...overrides,
  }
}

/** Only the fields the loader touches — it returns the payload untouched. */
const NORMALIZED = { source: { source_league_id: '123' } } as unknown as NormalizedImportResult

const ok = () => ({ success: true as const, normalized: NORMALIZED })
const fail = (code: string, error = 'nope') => ({ success: false as const, code, error })

describe('provider credential classification', () => {
  it('treats espn, yahoo and mfl as needing a credential', () => {
    expect(providerNeedsCredential('espn')).toBe(true)
    expect(providerNeedsCredential('yahoo')).toBe(true)
    expect(providerNeedsCredential('mfl')).toBe(true)
  })

  /*
   * 🛑 FANTRAX IS THE ONE THAT LOOKS CREDENTIALED AND IS NOT. Its `fxea` API is unauthenticated;
   * the Secret ID only ever identifies WHICH TEAM is the caller's, which a refresh does not need.
   * Listing it as credentialed would make every Fantrax league skip forever, waiting on a key it
   * never required — and the skip would look perfectly reasonable in the logs.
   */
  it('does not require a credential for the keyless providers', () => {
    expect(providerNeedsCredential('fantrax')).toBe(false)
    expect(providerNeedsCredential('sleeper')).toBe(false)
    expect(providerNeedsCredential('fleaflicker')).toBe(false)
  })

  it('covers every syncable provider one way or the other', () => {
    for (const p of SYNCABLE_PROVIDERS) {
      expect(typeof providerNeedsCredential(p)).toBe('boolean')
    }
  })
})

describe('fetchNormalizedForConnection — keyless providers', () => {
  it('reads without resolving any user, and never passes a userId', async () => {
    const runPipeline = vi.fn(async () => ok())
    const resolveCandidates = vi.fn(async () => ['should-not-be-called'])

    const out = await fetchNormalizedForConnection(
      connection({ provider: 'sleeper', runKey: 'sleeper:123:2026' }),
      { runPipeline: runPipeline as never, resolveCandidates },
    )

    expect(out).toBe(NORMALIZED)
    expect(resolveCandidates).not.toHaveBeenCalled()
    expect(runPipeline).toHaveBeenCalledWith({ provider: 'sleeper', sourceId: '123' })
    expect(runPipeline.mock.calls[0][0]).not.toHaveProperty('userId')
  })

  /*
   * A keyless league whose only importing user was deleted must still refresh. Resolving
   * candidates for it would make that league skip for want of a credential it never needed.
   */
  it('still refreshes when no importing user remains', async () => {
    const runPipeline = vi.fn(async () => ok())
    await expect(
      fetchNormalizedForConnection(connection({ provider: 'fleaflicker' }), {
        runPipeline: runPipeline as never,
        resolveCandidates: async () => [],
      }),
    ).resolves.toBe(NORMALIZED)
  })

  it('reports a genuinely missing league as gone, not as a transient failure', async () => {
    await expect(
      fetchNormalizedForConnection(connection({ provider: 'sleeper' }), {
        runPipeline: (async () => fail('LEAGUE_NOT_FOUND', 'no such league')) as never,
        resolveCandidates: async () => [],
      }),
    ).rejects.toBeInstanceOf(SyncLeagueGoneError)
  })
})

describe('fetchNormalizedForConnection — credentialed providers', () => {
  it('tries importing users in order and stops at the first that works', async () => {
    const seen: (string | undefined)[] = []
    const runPipeline = vi.fn(async (args: { userId?: string }) => {
      seen.push(args.userId)
      return args.userId === 'u2' ? ok() : fail('CONNECTION_REQUIRED', 'reconnect ESPN')
    })

    const out = await fetchNormalizedForConnection(connection(), {
      runPipeline: runPipeline as never,
      resolveCandidates: async () => ['u1', 'u2', 'u3'],
    })

    expect(out).toBe(NORMALIZED)
    expect(seen).toEqual(['u1', 'u2'])
  })

  it('reports no working credential as its own condition, not a provider failure', async () => {
    const err = await fetchNormalizedForConnection(connection(), {
      runPipeline: (async () => fail('CONNECTION_REQUIRED', 'ESPN cookies expired')) as never,
      resolveCandidates: async () => ['u1', 'u2'],
    }).catch((e) => e)

    expect(err).toBeInstanceOf(SyncCredentialsUnavailableError)
    expect((err as SyncCredentialsUnavailableError).candidatesTried).toBe(2)
    // The provider's own sentence survives, so the note names something actionable.
    expect((err as Error).message).toContain('ESPN cookies expired')
  })

  it('says so plainly when no importing user remains at all', async () => {
    const err = await fetchNormalizedForConnection(connection(), {
      runPipeline: (async () => ok()) as never,
      resolveCandidates: async () => [],
    }).catch((e) => e)

    expect(err).toBeInstanceOf(SyncCredentialsUnavailableError)
    expect((err as SyncCredentialsUnavailableError).candidatesTried).toBe(0)
  })

  /*
   * 🛑 THE THROTTLE RULE. A provider that is struggling must NOT be probed again with two more
   * full league reads — that is the opposite of what a 429 asks for, and it is exactly what a
   * naive "try the next candidate on any failure" loop would do. This depends on the typed
   * PROVIDER_UNAVAILABLE code the import path added; without it a throttle arrived as
   * "League not found" and the collector would have skipped a live league instead of retrying.
   */
  it('stops probing candidates when the provider is throttling', async () => {
    const runPipeline = vi.fn(async () => fail('PROVIDER_UNAVAILABLE', 'rate limited'))

    const err = await fetchNormalizedForConnection(connection(), {
      runPipeline: runPipeline as never,
      resolveCandidates: async () => ['u1', 'u2', 'u3'],
    }).catch((e) => e)

    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(SyncCredentialsUnavailableError)
    expect(runPipeline).toHaveBeenCalledTimes(1)
  })

  /*
   * For a credentialed provider a 401 and a 404 are frequently the same HTTP answer — but the
   * pipeline has already mapped an auth refusal to CONNECTION_REQUIRED, so reaching
   * LEAGUE_NOT_FOUND means the provider distinguished them. Probing more users would be two
   * more requests for an answer already in hand.
   */
  it('stops probing candidates when the provider says the league is gone', async () => {
    const runPipeline = vi.fn(async () => fail('LEAGUE_NOT_FOUND', 'gone'))

    const err = await fetchNormalizedForConnection(connection(), {
      runPipeline: runPipeline as never,
      resolveCandidates: async () => ['u1', 'u2', 'u3'],
    }).catch((e) => e)

    expect(err).toBeInstanceOf(SyncLeagueGoneError)
    expect(runPipeline).toHaveBeenCalledTimes(1)
  })

  it('bounds how many users it probes, however many mirrors a league has', async () => {
    const runPipeline = vi.fn(async () => fail('CONNECTION_REQUIRED'))
    const many = Array.from({ length: 12 }, (_, i) => `u${i}`)

    await fetchNormalizedForConnection(connection(), {
      runPipeline: runPipeline as never,
      resolveCandidates: async () => many,
    }).catch(() => undefined)

    expect(runPipeline).toHaveBeenCalledTimes(MAX_USER_CANDIDATES)
  })

  it('honours an explicit candidate bound', async () => {
    const runPipeline = vi.fn(async () => fail('UNAUTHORIZED'))
    await fetchNormalizedForConnection(connection(), {
      runPipeline: runPipeline as never,
      resolveCandidates: async () => ['a', 'b', 'c'],
      maxCandidates: 1,
    }).catch(() => undefined)
    expect(runPipeline).toHaveBeenCalledTimes(1)
  })
})

describe('runDueLeagues accounting', () => {
  /*
   * 🛑 THE BUG THIS EXISTS TO PREVENT, AND THE GENERALISATION IS WHAT WOULD HAVE CAUSED IT.
   *
   * A credential skip returns `executed: false` with a reason that does NOT say "not due". The
   * pre-existing summary chain tested for `!due`, then "not due" in the reason, then a lock,
   * then fell through to an `else` that counted the connection as EXECUTED and COMPLETED. So a
   * heartbeat would have reported a clean refresh of every ESPN league on the platform while
   * touching none of them — a green number over work that never happened, which is the exact
   * shape this codebase keeps paying for.
   */
  it('counts a credential skip as skipped, never as executed or completed', async () => {
    const { runDueLeagues } = await import('@/lib/fantasy-os/sync/collector/runDueSleeperLeagues')

    // One importing user exists, but no leagueAuth row — so the pre-flight declines.
    h.prisma.league.findMany.mockResolvedValue([{ userId: 'u1' }] as never)
    h.prisma.leagueAuth.findMany.mockResolvedValue([] as never)

    const summary = await runDueLeagues({
      now: new Date('2026-10-01T12:00:00Z'),
      connections: [
        {
          runKey: 'espn:99:2026',
          provider: 'espn',
          externalLeagueId: '99',
          season: 2026,
          sport: 'NFL',
        },
      ],
      fetchNormalized: async () => {
        throw new Error('must never reach the provider without a credential')
      },
    })

    expect(summary.skipped).toBe(1)
    expect(summary.executed).toBe(0)
    expect(summary.completed).toBe(0)
    expect(summary.errored).toBe(0)
    expect(summary.results[0]?.reason).toContain('espn')
  })

  it('reports what it enumerated per provider', async () => {
    const { runDueLeagues } = await import('@/lib/fantasy-os/sync/collector/runDueSleeperLeagues')
    h.prisma.league.findMany.mockResolvedValue([] as never)

    const summary = await runDueLeagues({
      now: new Date('2026-10-01T12:00:00Z'),
      connections: [
        { runKey: 'espn:1:2026', provider: 'espn', externalLeagueId: '1', season: 2026, sport: 'NFL' },
        { runKey: 'mfl:2:2026', provider: 'mfl', externalLeagueId: '2', season: 2026, sport: 'NFL' },
        { runKey: 'espn:3:2026', provider: 'espn', externalLeagueId: '3', season: 2026, sport: 'NFL' },
      ],
      fetchNormalized: async () => NORMALIZED,
    })

    expect(summary.byProvider).toEqual({ espn: 2, mfl: 1 })
    expect(summary.enumerated).toBe(3)
  })
})
