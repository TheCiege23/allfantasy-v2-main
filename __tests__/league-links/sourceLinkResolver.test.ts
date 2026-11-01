// @vitest-environment node
/**
 * Centralized source-platform link resolver — security, fallback, action labels, and the HailShiva
 * acceptance case. Pure + deterministic: no DB, no provider fetch.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  resolveSourceLink,
  isSafeProviderUrl,
  normalizeSourcePlatform,
} from '@/lib/league-links/sourceLinkResolver'

describe('isSafeProviderUrl — the single security gate', () => {
  it('accepts an exact-host https url', () => {
    expect(isSafeProviderUrl('https://sleeper.com/leagues/1/league', ['sleeper.com'])).toBe(true)
  })
  it('rejects non-https', () => {
    expect(isSafeProviderUrl('http://sleeper.com/leagues/1', ['sleeper.com'])).toBe(false)
  })
  it('rejects javascript:/data:/file: schemes', () => {
    for (const u of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd']) {
      expect(isSafeProviderUrl(u, ['sleeper.com'])).toBe(false)
    }
  })
  it('rejects subdomain look-alikes and unapproved hosts (open-redirect defense)', () => {
    expect(isSafeProviderUrl('https://sleeper.com.evil.com/x', ['sleeper.com'])).toBe(false)
    expect(isSafeProviderUrl('https://evil.com/?u=sleeper.com', ['sleeper.com'])).toBe(false)
  })
  it('rejects embedded credentials and malformed urls', () => {
    expect(isSafeProviderUrl('https://u:p@sleeper.com/x', ['sleeper.com'])).toBe(false)
    expect(isSafeProviderUrl('not a url', ['sleeper.com'])).toBe(false)
  })
})

describe('normalizeSourcePlatform', () => {
  it('maps known source providers (case-insensitive)', () => {
    expect(normalizeSourcePlatform('Sleeper')).toBe('sleeper')
    expect(normalizeSourcePlatform('ESPN')).toBe('espn')
    expect(normalizeSourcePlatform('yahoo')).toBe('yahoo')
  })
  it('returns null for native / unknown', () => {
    for (const p of ['allfantasy', 'native', 'manual', 'redraft', 'tournament', 'cbs', '', null, undefined]) {
      expect(normalizeSourcePlatform(p)).toBeNull()
    }
  })
})

describe('resolveSourceLink — direct league resolution (launch providers, verified formats)', () => {
  it('Sleeper → direct league page', () => {
    const link = resolveSourceLink({ platform: 'sleeper', sourceLeagueId: '131353', leagueName: 'HailShiva' })!
    expect(link.href).toBe('https://sleeper.com/leagues/131353/league')
    expect(link.destinationType).toBe('league')
    expect(link.isFallback).toBe(false)
    expect(link.provider).toBe('sleeper')
    expect(link.opensExternally).toBe(true)
  })
  it('ESPN → league page with leagueId (+ seasonId when present)', () => {
    expect(resolveSourceLink({ platform: 'espn', sourceLeagueId: '42654852', season: 2026 })!.href).toBe(
      'https://fantasy.espn.com/football/league?leagueId=42654852&seasonId=2026',
    )
    expect(resolveSourceLink({ platform: 'espn', sourceLeagueId: '42654852' })!.href).toBe(
      'https://fantasy.espn.com/football/league?leagueId=42654852',
    )
  })
  it('Yahoo → f1 league page', () => {
    expect(resolveSourceLink({ platform: 'yahoo', sourceLeagueId: '12798' })!.href).toBe(
      'https://football.fantasysports.yahoo.com/f1/12798',
    )
  })
  it('encodes the league id (no path/host injection)', () => {
    const link = resolveSourceLink({ platform: 'sleeper', sourceLeagueId: 'a/b?c#d' })!
    expect(link.href).toBe('https://sleeper.com/leagues/a%2Fb%3Fc%23d/league')
    expect(isSafeProviderUrl(link.href, ['sleeper.com'])).toBe(true)
  })
})

describe('resolveSourceLink — safe fallbacks', () => {
  it('MFL / Fantrax / Fleaflicker → approved homepage (isFallback)', () => {
    const cases: Array<[string, string]> = [
      ['mfl', 'https://www.myfantasyleague.com'],
      ['fantrax', 'https://www.fantrax.com'],
      ['fleaflicker', 'https://www.fleaflicker.com'],
    ]
    for (const [platform, homepage] of cases) {
      const link = resolveSourceLink({ platform, sourceLeagueId: '999', leagueName: 'X' })!
      expect(link.href).toBe(homepage)
      expect(link.destinationType).toBe('homepage')
      expect(link.isFallback).toBe(true)
    }
  })
  it('launch provider with a MISSING/blank league id → homepage fallback', () => {
    for (const id of [undefined, null, '', '   ']) {
      const link = resolveSourceLink({ platform: 'sleeper', sourceLeagueId: id })!
      expect(link.href).toBe('https://sleeper.com')
      expect(link.isFallback).toBe(true)
    }
  })
  it('native / unknown platform → null (render no button)', () => {
    expect(resolveSourceLink({ platform: 'allfantasy', sourceLeagueId: '1' })).toBeNull()
    expect(resolveSourceLink({ platform: 'cbs', sourceLeagueId: '1' })).toBeNull()
  })
})

describe('resolveSourceLink — stored-url validation', () => {
  it('uses a stored url only when it passes the provider allowlist', () => {
    expect(
      resolveSourceLink({ platform: 'sleeper', sourceLeagueId: '1', storedUrl: 'https://sleeper.com/leagues/abc/league' })!.href,
    ).toBe('https://sleeper.com/leagues/abc/league')
  })
  it('ignores an unsafe stored url and falls back to the constructed league page', () => {
    for (const bad of ['javascript:alert(1)', 'http://sleeper.com/x', 'https://evil.com/x', 'https://sleeper.com.evil.com/x']) {
      expect(
        resolveSourceLink({ platform: 'sleeper', sourceLeagueId: '131353', storedUrl: bad })!.href,
      ).toBe('https://sleeper.com/leagues/131353/league')
    }
  })
})

describe('resolveSourceLink — action-aware labels', () => {
  const base = { platform: 'sleeper' as const, sourceLeagueId: '131353', leagueName: 'HailShiva' }
  it('names both action and league', () => {
    expect(resolveSourceLink({ ...base, action: 'lineup' })!.label).toBe('Fix Lineup in HailShiva')
    expect(resolveSourceLink({ ...base, action: 'trade' })!.label).toBe('Review Trade in HailShiva')
    expect(resolveSourceLink({ ...base, action: 'waiver' })!.label).toBe('Manage Waivers in HailShiva')
    expect(resolveSourceLink({ ...base, action: 'matchup' })!.label).toBe('View Matchup in HailShiva')
    expect(resolveSourceLink({ ...base, action: 'open' })!.label).toBe('Open HailShiva in Sleeper')
    expect(resolveSourceLink({ ...base })!.label).toBe('Open HailShiva in Sleeper')
  })
  it('homepage fallback → "Go to {provider}"', () => {
    expect(resolveSourceLink({ platform: 'espn', sourceLeagueId: '', action: 'lineup' })!.label).toBe('Go to ESPN Fantasy')
    expect(resolveSourceLink({ platform: 'yahoo', sourceLeagueId: '' })!.label).toBe('Go to Yahoo Fantasy')
    expect(resolveSourceLink({ platform: 'sleeper', sourceLeagueId: '' })!.label).toBe('Go to Sleeper')
  })
})

describe('HailShiva acceptance case', () => {
  it('direct HailShiva league URL is preferred over the homepage; label names the league', () => {
    const link = resolveSourceLink({ platform: 'sleeper', sourceLeagueId: '131353', leagueName: 'HailShiva', action: 'lineup', season: 2026 })!
    expect(link.href).toBe('https://sleeper.com/leagues/131353/league')
    expect(link.destinationType).toBe('league')
    expect(link.isFallback).toBe(false)
    expect(link.label).toBe('Fix Lineup in HailShiva')
  })
  it('absent HailShiva id falls back safely to the Sleeper homepage', () => {
    const link = resolveSourceLink({ platform: 'sleeper', sourceLeagueId: null, leagueName: 'HailShiva' })!
    expect(link.href).toBe('https://sleeper.com')
    expect(link.isFallback).toBe(true)
  })
})

describe('resolveSourceLink — never fetches a provider during resolution', () => {
  it('makes zero fetch calls', () => {
    const spy = vi.spyOn(globalThis, 'fetch' as never)
    resolveSourceLink({ platform: 'sleeper', sourceLeagueId: '131353', action: 'lineup' })
    resolveSourceLink({ platform: 'espn', sourceLeagueId: '1' })
    resolveSourceLink({ platform: 'mfl', sourceLeagueId: '1' })
    expect(spy).not.toHaveBeenCalled()
  })
})

/*
 * "Open in Fantrax" used to land on fantrax.com's homepage for every league. Fantrax's league
 * page format is the one this repo already tells people to copy their id from
 * (fantrax.com/fantasy/league/<id>/home — lib/league-import/fantrax/fantraxApi.ts
 * parseFantraxLeagueId, captured from a real address bar on league v2kzedypmm8jp61b).
 */
describe('resolveSourceLink — Fantrax league page', () => {
  /* The league page: https, Fantrax's own host, /fantasy/league/<id>/home. */
  const expectLeaguePage = (href: string) => {
    const u = new URL(href)
    expect(u.protocol).toBe('https:')
    expect(u.hostname).toBe('www.fantrax.com')
    expect(u.pathname).toBe('/fantasy/league/v2kzedypmm8jp61b/home')
  }

  it('builds the league page from a real Fantrax league id', () => {
    const link = resolveSourceLink({ platform: 'fantrax', sourceLeagueId: 'v2kzedypmm8jp61b', leagueName: 'Cream Bowl' })!
    expectLeaguePage(link.href)
    expect(link.destinationType).toBe('league')
    expect(link.isFallback).toBe(false)
    expect(isSafeProviderUrl(link.href, ['www.fantrax.com', 'fantrax.com'])).toBe(true)
  })
  it('reads the id out of the live-import source input and a pasted URL', () => {
    expectLeaguePage(resolveSourceLink({ platform: 'fantrax', sourceLeagueId: 'fantrax-league:v2kzedypmm8jp61b|My Team' })!.href)
    /* As pasted from the address bar, minus the scheme — the same form parseFantraxLeagueId's test uses. */
    expectLeaguePage(resolveSourceLink({ platform: 'fantrax', sourceLeagueId: 'fantrax.com/fantasy/league/v2kzedypmm8jp61b/standings' })!.href)
  })
  it('never builds a league URL out of AllFantasy\'s own snapshot uuid — homepage instead', () => {
    const link = resolveSourceLink({ platform: 'fantrax', sourceLeagueId: '3f0c2a1e-9b7d-4c55-8a1e-2b4f6d8e0c11' })!
    expect(link.destinationType).toBe('homepage')
    expect(link.isFallback).toBe(true)
    expect(new URL(link.href).pathname).toBe('/')
  })
  it('falls back to the homepage only when there is no id', () => {
    for (const id of [undefined, null, '', '  ']) {
      const link = resolveSourceLink({ platform: 'fantrax', sourceLeagueId: id })!
      expect(link.destinationType).toBe('homepage')
      expect(new URL(link.href).hostname).toBe('www.fantrax.com')
    }
  })
})
