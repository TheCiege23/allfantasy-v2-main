/**
 * Covers the capability resolver — the layer that decides whether a control
 * that performs a write may render at all.
 *
 * These cases are the real failure modes, not invented ones:
 *  - A caller passing `native_execute` for an imported league (a bug that would
 *    otherwise render a live "Edit lineup" button AllFantasy cannot honour,
 *    because it has no write access to Sleeper/ESPN/Yahoo).
 *  - MyFantasyLeague, whose league URLs live on numbered shard hosts
 *    (`www43.myfantasyleague.com`) that are not stored anywhere — so no correct
 *    deep link can be built and the honest result is guidance, not a 404.
 *  - A `copy_action` with nothing to copy.
 */
import { describe, expect, it } from 'vitest'
import {
  buildProviderLeagueUrl,
  providerLabel,
  resolveActionCapability,
  resolveSeasonLabel,
  resolveTrustStatus,
} from '@/lib/league-command-center/capability'

const NFL = { sport: 'NFL', platformLeagueId: '123456789' }

describe('resolveActionCapability', () => {
  it('allows a real write only on a native league', () => {
    const native = resolveActionCapability({
      execution: 'native_execute',
      provider: 'allfantasy',
      ...NFL,
    })
    expect(native.kind).toBe('native_write')
    expect(native.canExecute).toBe(true)
  })

  it('never lets an imported league execute, even when the caller claims native_execute', () => {
    for (const provider of ['sleeper', 'espn', 'yahoo', 'mfl', 'fantrax']) {
      const result = resolveActionCapability({
        execution: 'native_execute',
        provider,
        ...NFL,
      })
      expect(result.canExecute, `${provider} must not execute`).toBe(false)
      expect(result.kind, `${provider} must not render a write control`).not.toBe('native_write')
    }
  })

  it('turns open_provider into a real deep link when one can be built', () => {
    const result = resolveActionCapability({ execution: 'open_provider', provider: 'sleeper', ...NFL })
    expect(result.kind).toBe('external_deep_link')
    expect(result.href).toBe('https://sleeper.com/leagues/123456789')
    expect(result.canExecute).toBe(false)
  })

  it('degrades to guidance for MFL, whose shard host is unknown', () => {
    const result = resolveActionCapability({ execution: 'open_provider', provider: 'mfl', ...NFL })
    expect(result.kind).toBe('read_only_guidance')
    expect(result.href).toBeNull()
    expect(result.label).toContain('MyFantasyLeague')
  })

  it('degrades to guidance when the platform league id is missing', () => {
    const result = resolveActionCapability({
      execution: 'open_provider',
      provider: 'sleeper',
      sport: 'NFL',
      platformLeagueId: null,
    })
    expect(result.kind).toBe('read_only_guidance')
    expect(result.href).toBeNull()
  })

  it('degrades a copy action with no text to informational', () => {
    const empty = resolveActionCapability({
      execution: 'copy_action',
      provider: 'sleeper',
      copyText: '   ',
      ...NFL,
    })
    expect(empty.kind).toBe('informational')
    expect(empty.copyText).toBeNull()

    const real = resolveActionCapability({
      execution: 'copy_action',
      provider: 'sleeper',
      copyText: 'Reminder: trade review ends tonight.',
      ...NFL,
    })
    expect(real.kind).toBe('copyable_message')
    expect(real.copyText).toBe('Reminder: trade review ends tonight.')
  })

  it('only honours an absolute http(s) href override', () => {
    const good = resolveActionCapability({
      execution: 'open_provider',
      provider: 'sleeper',
      hrefOverride: 'https://sleeper.com/leagues/1/transactions',
      ...NFL,
    })
    expect(good.href).toBe('https://sleeper.com/leagues/1/transactions')

    // A relative or javascript: value must never become a link target.
    for (const bad of ['/local/path', 'javascript:alert(1)', 'notaurl']) {
      const result = resolveActionCapability({
        execution: 'open_provider',
        provider: 'sleeper',
        hrefOverride: bad,
        ...NFL,
      })
      expect(result.href, `${bad} must not be used`).toBe('https://sleeper.com/leagues/123456789')
    }
  })

  it('never attaches copyText or href to a capability that should not carry one', () => {
    const info = resolveActionCapability({
      execution: 'recommendation_only',
      provider: 'sleeper',
      ...NFL,
    })
    expect(info.kind).toBe('informational')
    expect(info.href).toBeNull()
    expect(info.copyText).toBeNull()
    expect(info.canExecute).toBe(false)
  })
})

describe('buildProviderLeagueUrl', () => {
  it('returns null for sports whose URL patterns are not verified', () => {
    expect(buildProviderLeagueUrl({ provider: 'sleeper', platformLeagueId: '1', sport: 'NBA' })).toBeNull()
    expect(buildProviderLeagueUrl({ provider: 'espn', platformLeagueId: '1', sport: 'SOCCER' })).toBeNull()
  })

  it('returns null for native leagues — there is nothing external to open', () => {
    expect(
      buildProviderLeagueUrl({ provider: 'allfantasy', platformLeagueId: '1', sport: 'NFL' }),
    ).toBeNull()
  })

  it('url-encodes the league id', () => {
    const url = buildProviderLeagueUrl({ provider: 'yahoo', platformLeagueId: 'a b/c', sport: 'NFL' })
    expect(url).toBe('https://football.fantasysports.yahoo.com/f1/a%20b%2Fc')
  })
})

describe('resolveTrustStatus', () => {
  it('reports native leagues as live rather than stale', () => {
    const result = resolveTrustStatus({ state: 'not_applicable', lastSyncedAt: null })
    expect(result.status).toBe('live')
  })

  it('never presents a never-synced league as current', () => {
    const result = resolveTrustStatus({ state: 'never_synced', lastSyncedAt: null })
    expect(result.status).toBe('unknown')
  })

  it('grades an imported league by the age of its last real sync', () => {
    const now = new Date('2026-07-19T12:00:00Z')
    const at = (minutesAgo: number) =>
      resolveTrustStatus(
        {
          state: 'fresh',
          lastSyncedAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
        },
        now,
      ).status

    expect(at(4)).toBe('current')
    expect(at(45)).toBe('delayed')
    expect(at(18 * 60)).toBe('stale')
  })
})

describe('resolveSeasonLabel', () => {
  /**
   * `League.season` is an Int but `SleeperLeague.season` is a String. A
   * number-only guard here has previously nulled every Sleeper league on a
   * user's board, which is most of a real board.
   */
  it('accepts both the Int and String season column shapes', () => {
    expect(resolveSeasonLabel(2026)).toBe('2026')
    expect(resolveSeasonLabel('2026')).toBe('2026')
    expect(resolveSeasonLabel(' 2026 ')).toBe('2026')
  })

  it('returns null only when the value is genuinely unusable', () => {
    expect(resolveSeasonLabel(null)).toBeNull()
    expect(resolveSeasonLabel(undefined)).toBeNull()
    expect(resolveSeasonLabel('   ')).toBeNull()
    expect(resolveSeasonLabel(Number.NaN)).toBeNull()
  })
})

describe('providerLabel', () => {
  it('never invents a brand name for an unrecognised platform', () => {
    expect(providerLabel('cbs')).toBe('External platform')
    expect(providerLabel('')).toBe('External platform')
  })
})
