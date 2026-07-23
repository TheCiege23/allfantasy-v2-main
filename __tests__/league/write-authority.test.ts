import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import {
  buildWriteAuthorityEnvelope,
  isShadowLeague,
  resolveWriteAuthority,
  saveActionLabel,
  shadowDisclosure,
  sourcePlatformLabel,
  writeAuthorityCopy,
  WRITE_BACK_CONNECTED_PLATFORMS,
} from '@/lib/league/write-authority'

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const read = (rel: string): string => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')

/** Every provider a real user can import today, per `lib/league-import/provider-ui-config.ts`. */
const IMPORT_PROVIDERS = ['sleeper', 'espn', 'yahoo', 'mfl', 'fantrax', 'fleaflicker'] as const

/** The four interchangeable spellings of "this league lives on AllFantasy". */
const NATIVE_PLATFORMS = ['allfantasy', 'af', 'manual', 'native'] as const

describe('resolveWriteAuthority', () => {
  it('treats every native spelling as NATIVE', () => {
    for (const p of NATIVE_PLATFORMS) {
      expect(resolveWriteAuthority(p)).toBe('NATIVE')
    }
  })

  it('defaults an absent platform to NATIVE', () => {
    expect(resolveWriteAuthority(null)).toBe('NATIVE')
    expect(resolveWriteAuthority(undefined)).toBe('NATIVE')
  })

  it('treats an empty-string platform as SHADOW, not NATIVE', () => {
    // Fail-safe asymmetry vs null/undefined, documented on `resolveWriteAuthority`: a bogus
    // shadow banner is cosmetic, but calling a malformed imported row NATIVE would tell a
    // manager their change reached ESPN when it did not.
    expect(resolveWriteAuthority('')).toBe('SHADOW')
    // Copy still degrades gracefully with no platform label to interpolate.
    expect(writeAuthorityCopy('lineup', '').detail).toContain('your host platform')
  })

  it('classifies every importable provider as SHADOW', () => {
    for (const p of IMPORT_PROVIDERS) {
      expect(resolveWriteAuthority(p)).toBe('SHADOW')
      expect(isShadowLeague(p)).toBe(true)
    }
  })

  it('is case- and whitespace-insensitive (platform is untrusted free text)', () => {
    expect(resolveWriteAuthority('  ESPN  ')).toBe('SHADOW')
    expect(resolveWriteAuthority('  Manual ')).toBe('NATIVE')
  })

  it('classifies an unknown external platform as SHADOW, not NATIVE', () => {
    // Fail-safe direction: an unrecognised platform must never be assumed writable.
    expect(resolveWriteAuthority('some-new-host')).toBe('SHADOW')
  })

  it('ships with no CONNECTED providers — no write-back adapter exists yet', () => {
    expect(WRITE_BACK_CONNECTED_PLATFORMS.size).toBe(0)
    for (const p of IMPORT_PROVIDERS) {
      expect(resolveWriteAuthority(p)).not.toBe('CONNECTED')
    }
  })
})

describe('shadow copy never implies the source platform was updated', () => {
  const ACTIONS = ['lineup', 'trade', 'waiver_claim', 'waiver_add_drop', 'settings'] as const

  it('names the source platform in every shadow action', () => {
    for (const action of ACTIONS) {
      const copy = writeAuthorityCopy(action, 'espn')
      expect(copy.detail).toContain('ESPN')
      expect(copy.detail.length).toBeGreaterThan(0)
    }
  })

  it('marks lineup, trade and settings titles as shadow', () => {
    expect(writeAuthorityCopy('lineup', 'yahoo').title).toBe('Shadow lineup saved')
    expect(writeAuthorityCopy('trade', 'yahoo').title).toBe('Shadow trade created')
    expect(writeAuthorityCopy('settings', 'yahoo').title).toBe('Shadow rules updated')
  })

  it('calls a waiver claim a recommendation, not a submission', () => {
    const copy = writeAuthorityCopy('waiver_claim', 'sleeper')
    expect(copy.title).toBe('Waiver recommendation saved')
    expect(copy.title.toLowerCase()).not.toContain('submitted')
  })

  it('never says a bare "Lineup saved" for an imported league', () => {
    for (const p of IMPORT_PROVIDERS) {
      expect(writeAuthorityCopy('lineup', p).title).not.toBe('Lineup saved')
    }
  })

  it('keeps plain copy for native leagues, with nothing to disclose', () => {
    const copy = writeAuthorityCopy('lineup', 'manual')
    expect(copy.title).toBe('Lineup saved')
    expect(copy.detail).toBe('')
  })

  it('does not invent a waiver weekday it cannot know', () => {
    const copy = writeAuthorityCopy('waiver_claim', 'yahoo')
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
      expect(copy.detail).not.toContain(day)
    }
  })
})

describe('labels and disclosure', () => {
  it('labels shadow save controls without implying transmission', () => {
    expect(saveActionLabel('lineup', 'espn')).toBe('Save shadow lineup')
    expect(saveActionLabel('trade', 'espn')).toBe('Create shadow trade')
    expect(saveActionLabel('lineup', 'manual')).toBe('Save lineup')
  })

  it('returns a disclosure for imported leagues and none for native', () => {
    expect(shadowDisclosure('espn')).toContain('ESPN')
    expect(shadowDisclosure('espn')).toContain('AllFantasy')
    expect(shadowDisclosure('manual')).toBeNull()
    expect(shadowDisclosure(null)).toBeNull()
  })

  it('resolves display labels with correct casing', () => {
    expect(sourcePlatformLabel('espn')).toBe('ESPN')
    expect(sourcePlatformLabel('mfl')).toBe('MFL')
    expect(sourcePlatformLabel('yahoo')).toBe('Yahoo')
    expect(sourcePlatformLabel('manual')).toBeNull()
  })
})

describe('buildWriteAuthorityEnvelope', () => {
  it('marks imported leagues shadow and carries the source label', () => {
    const env = buildWriteAuthorityEnvelope('lineup', 'espn')
    expect(env.authority).toBe('SHADOW')
    expect(env.shadow).toBe(true)
    expect(env.sourceLabel).toBe('ESPN')
    expect(env.platform).toBe('espn')
    expect(env.copy.title).toBe('Shadow lineup saved')
  })

  it('marks native leagues non-shadow with no source', () => {
    const env = buildWriteAuthorityEnvelope('lineup', 'manual')
    expect(env.authority).toBe('NATIVE')
    expect(env.shadow).toBe(false)
    expect(env.sourceLabel).toBeNull()
  })
})

/**
 * Regression guard for the gap this work closed: mutation routes reachable from an imported
 * league used to return a bare success the client rendered as though it had reached ESPN/Yahoo.
 * Each route must emit the Write Authority envelope.
 */
describe('mutation routes disclose write authority', () => {
  const MUTATION_ROUTES = [
    'app/api/leagues/roster/save/route.ts',
    'app/api/leagues/[leagueId]/trades/route.ts',
    'app/api/waiver-wire/leagues/[leagueId]/claims/route.ts',
    'app/api/waiver-wire/leagues/[leagueId]/add-drop/route.ts',
    'lib/league/execute-league-settings-patch.ts',
  ]

  it.each(MUTATION_ROUTES)('%s returns writeAuthority', (rel) => {
    const src = read(rel)
    expect(src).toMatch(/writeAuthority/)
    expect(src).toMatch(/write-authority(-server)?['"]/)
  })
})

/**
 * The old "IMP" badge could never render: `/api/league/list` does not select `importedAt`, and
 * `lifecycleState` is non-nullable with a default of `in_season`, so `!league.lifecycleState`
 * was always false. Guard against reintroducing a marker gated on either.
 */
describe('league card shadow badge', () => {
  const CARD = 'components/league/LeagueSidebarCard.tsx'

  it('does not gate the marker on importedAt or an absent lifecycleState', () => {
    const src = read(CARD)
    expect(src).not.toMatch(/league\.importedAt\s*&&\s*!league\.lifecycleState/)
  })

  it('derives the badge from platform, which the list payload always sets', () => {
    const src = read(CARD)
    expect(src).toMatch(/isShadowLeague\(league\.platform\)/)
    expect(src).toMatch(/SHADOW/)
  })
})
