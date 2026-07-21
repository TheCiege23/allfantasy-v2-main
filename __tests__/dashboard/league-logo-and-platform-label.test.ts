/**
 * Covers the two helpers behind the dashboard league-logo fix and the platform-suffix naming.
 * Cases are drawn from the actual defects found, not invented: a commissioner's unvalidated
 * free-text logoUrl, Sleeper's mixed full-URL/bare-hash avatar column, and a Fleaflicker import
 * that the old hand-written label map silently rendered as "AF".
 */
import { describe, expect, it } from 'vitest'
import { resolveLeagueLogoSrc, leagueInitials } from '@/lib/dashboard/league-logo-src'
import {
  importedPlatformLabel,
  isNativePlatform,
  leagueDisplayName,
} from '@/lib/dashboard/platform-label'

describe('resolveLeagueLogoSrc', () => {
  it('returns null when there is nothing to show', () => {
    expect(resolveLeagueLogoSrc(null, null)).toBeNull()
    expect(resolveLeagueLogoSrc(undefined, undefined)).toBeNull()
    expect(resolveLeagueLogoSrc('   ', '  ')).toBeNull()
  })

  it('prefers a commissioner-set logoUrl over the Sleeper avatar', () => {
    expect(resolveLeagueLogoSrc('https://cdn.example.com/a.png', 'abc123')).toBe(
      'https://cdn.example.com/a.png',
    )
  })

  it('passes absolute and root-relative logoUrls through untouched', () => {
    expect(resolveLeagueLogoSrc('https://x.test/a.png', null)).toBe('https://x.test/a.png')
    expect(resolveLeagueLogoSrc('http://x.test/a.png', null)).toBe('http://x.test/a.png')
    expect(resolveLeagueLogoSrc('/uploads/a.png', null)).toBe('/uploads/a.png')
  })

  it('normalizes a half-typed logoUrl to a root-relative path instead of a malformed src', () => {
    // The Logo URL input PATCHes on every keystroke with no validation, so these really can persist.
    // next/image THROWS on these (killing the card); a plain <img> 404s and hits onError.
    expect(resolveLeagueLogoSrc('h', null)).toBe('/h')
    expect(resolveLeagueLogoSrc('https:/example.com/a.png', null)).toBe('/https:/example.com/a.png')
    expect(resolveLeagueLogoSrc('logo.png', null)).toBe('/logo.png')
  })

  it('expands a bare Sleeper avatar hash to a CDN url', () => {
    expect(resolveLeagueLogoSrc(null, 'abc123')).toBe('https://sleepercdn.com/avatars/thumbs/abc123')
  })

  it('passes an already-full Sleeper avatar url through without double-prefixing', () => {
    expect(resolveLeagueLogoSrc(null, 'https://sleepercdn.com/avatars/thumbs/xyz')).toBe(
      'https://sleepercdn.com/avatars/thumbs/xyz',
    )
  })

  it('does not prefix a root-relative avatarUrl onto the Sleeper CDN', () => {
    // The latent bug in lib/dashboard/resolve-dashboard-avatar.ts, not repeated here.
    expect(resolveLeagueLogoSrc(null, '/uploads/a.png')).toBe('/uploads/a.png')
  })
})

describe('leagueInitials', () => {
  it('takes first and last initials', () => {
    expect(leagueInitials('Going Deep League')).toBe('GL')
    expect(leagueInitials('  the  dynasty   warriors ')).toBe('TW')
  })

  it('handles single-word and empty names', () => {
    expect(leagueInitials('Dynasty')).toBe('D')
    expect(leagueInitials('')).toBe('?')
    expect(leagueInitials(null)).toBe('?')
  })

  it('derives initials from the words, ignoring emoji tokens', () => {
    // Real Sleeper league names routinely end in emoji. The monogram must read as the words.
    expect(leagueInitials('Gridiron Goonz 🏈')).toBe('GG')
    expect(leagueInitials('La Raza 🇲🇽🏈')).toBe('LR')
    expect(leagueInitials('🏈 Sunday Funday')).toBe('SF')
    expect(leagueInitials('Dynasty 🔥')).toBe('D')
  })

  it('never emits a lone UTF-16 surrogate (the SSR hydration-mismatch cause)', () => {
    // A lone surrogate serializes as U+FFFD on the server but stays raw on the client → React
    // hydration error. `charAt(0)` on an emoji used to produce exactly this.
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    for (const name of ['Gridiron Goonz 🏈', 'La Raza 🇲🇽🏈', '🏈🔥', '🇲🇽', 'Team 💀 Skull']) {
      expect(leagueInitials(name)).not.toMatch(loneSurrogate)
    }
  })

  it('falls back to a whole emoji code point for all-emoji names', () => {
    // No alphanumeric token at all — return a complete code point (renders cleanly), not '?'.
    expect(leagueInitials('🏈🔥')).toBe('🏈')
  })
})

describe('isNativePlatform', () => {
  it('treats all four native spellings as native', () => {
    for (const p of ['allfantasy', 'af', 'manual', 'native', 'AllFantasy', ' NATIVE ']) {
      expect(isNativePlatform(p)).toBe(true)
    }
  })

  it('defaults an absent platform to native', () => {
    expect(isNativePlatform(null)).toBe(true)
    expect(isNativePlatform(undefined)).toBe(true)
  })

  it('treats external platforms as not native', () => {
    for (const p of ['sleeper', 'yahoo', 'espn', 'fantrax', 'fleaflicker']) {
      expect(isNativePlatform(p)).toBe(false)
    }
  })
})

describe('importedPlatformLabel', () => {
  it('returns null for native leagues so they get no suffix', () => {
    expect(importedPlatformLabel('allfantasy')).toBeNull()
    expect(importedPlatformLabel('native')).toBeNull()
    expect(importedPlatformLabel(null)).toBeNull()
    expect(importedPlatformLabel('')).toBeNull()
  })

  it('uses correct casing for platforms that are not simple title-case', () => {
    expect(importedPlatformLabel('espn')).toBe('ESPN')
    expect(importedPlatformLabel('mfl')).toBe('MFL')
    expect(importedPlatformLabel('cbs')).toBe('CBS')
  })

  it('title-cases known simple platforms', () => {
    expect(importedPlatformLabel('sleeper')).toBe('Sleeper')
    expect(importedPlatformLabel('yahoo')).toBe('Yahoo')
    expect(importedPlatformLabel('fantrax')).toBe('Fantrax')
  })

  it('labels a platform the old map never covered, instead of mislabelling it AF', () => {
    // ConnectPlatformsModal offers Fleaflicker imports; the previous map's catch-all returned 'AF',
    // so such a league read "Going Deep League - AF" — i.e. claimed to be a native AF league.
    expect(importedPlatformLabel('fleaflicker')).toBe('Fleaflicker')
    expect(importedPlatformLabel('somenewplatform')).toBe('Somenewplatform')
  })
})

describe('leagueDisplayName', () => {
  it('suffixes imported leagues with their platform', () => {
    expect(leagueDisplayName('Going Deep League', 'yahoo')).toBe('Going Deep League - Yahoo')
    expect(leagueDisplayName('Going Deep League', 'espn')).toBe('Going Deep League - ESPN')
  })

  it('leaves native league names bare', () => {
    expect(leagueDisplayName('My League', 'allfantasy')).toBe('My League')
    expect(leagueDisplayName('My League', null)).toBe('My League')
  })
})
