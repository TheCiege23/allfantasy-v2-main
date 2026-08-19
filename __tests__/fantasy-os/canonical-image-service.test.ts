import { describe, it, expect } from 'vitest'
import {
  resolveCanonicalImage,
  isValidImageUrl,
  type ImageCandidate,
} from '@/lib/sports-data-gateway/canonical/canonicalImage'

/**
 * Phase 5H-c — canonical IMAGE precedence + validation contract.
 * Locks: official > secondary > fallback > placeholder; validated stronger source never overwritten; empty/invalid/
 * broken rejected; player/team + sport isolation; missing imagery honest.
 */

const officialPlayer: ImageCandidate = { tier: 'verified_official', source: 'espn', url: 'https://a.espncdn.com/x.png', imageType: 'headshot', sport: 'NFL' }
const secondaryPlayer: ImageCandidate = { tier: 'verified_secondary', source: 'thesportsdb', url: 'https://thesportsdb.com/y.png', imageType: 'headshot', sport: 'NFL' }
const fallbackPlayer: ImageCandidate = { tier: 'approved_fallback', source: 'sleeper', url: 'https://sleepercdn.com/z.jpg', imageType: 'headshot', sport: 'NFL' }
const placeholderPlayer: ImageCandidate = { tier: 'placeholder', source: 'placeholder', url: null, imageType: 'headshot', sport: 'NFL' }

describe('5H-c image — deterministic precedence', () => {
  it('official wins over secondary and fallback', () => {
    const r = resolveCanonicalImage({ entityType: 'player', canonicalEntityId: 'p1', sport: 'NFL', imageType: 'headshot', candidates: [fallbackPlayer, secondaryPlayer, officialPlayer] })
    expect(r.source).toBe('espn')
    expect(r.fallbackRank).toBe(1)
    expect(r.url).toBe('https://a.espncdn.com/x.png')
    expect(r.isPlaceholder).toBe(false)
  })
  it('secondary wins over fallback when official absent', () => {
    const r = resolveCanonicalImage({ entityType: 'player', canonicalEntityId: 'p1', sport: 'NFL', imageType: 'headshot', candidates: [fallbackPlayer, secondaryPlayer] })
    expect(r.source).toBe('thesportsdb')
    expect(r.fallbackRank).toBe(2)
  })
  it('fallback wins over placeholder', () => {
    const r = resolveCanonicalImage({ entityType: 'player', canonicalEntityId: 'p1', sport: 'NFL', imageType: 'headshot', candidates: [placeholderPlayer, fallbackPlayer] })
    expect(r.source).toBe('sleeper')
    expect(r.fallbackRank).toBe(3)
  })
  it('a broken official URL falls through to a validated lower-ranked source', () => {
    const brokenOfficial: ImageCandidate = { ...officialPlayer, url: 'not a url' }
    const r = resolveCanonicalImage({ entityType: 'player', canonicalEntityId: 'p1', sport: 'NFL', imageType: 'headshot', candidates: [brokenOfficial, secondaryPlayer] })
    expect(r.source).toBe('thesportsdb')
    expect(r.fallbackRank).toBe(2)
  })
  it('a stronger VALID source is never overwritten by a weaker valid source', () => {
    const r = resolveCanonicalImage({ entityType: 'player', canonicalEntityId: 'p1', sport: 'NFL', imageType: 'headshot', candidates: [officialPlayer, secondaryPlayer, fallbackPlayer] })
    expect(r.source).toBe('espn')
  })
})

describe('5H-c image — URL validation', () => {
  it('rejects empty, invalid, and data: URIs', () => {
    expect(isValidImageUrl('')).toBe(false)
    expect(isValidImageUrl('   ')).toBe(false)
    expect(isValidImageUrl(null)).toBe(false)
    expect(isValidImageUrl('data:image/svg+xml;base64,AAA')).toBe(false)
    expect(isValidImageUrl('ftp://x/y.png')).toBe(false)
    expect(isValidImageUrl('javascript:alert(1)')).toBe(false)
    expect(isValidImageUrl('https://a.espncdn.com/x.png')).toBe(true)
  })
  it('rejects known-broken URLs', () => {
    const broken = new Set(['https://broken.example/x.png'])
    expect(isValidImageUrl('https://broken.example/x.png', broken)).toBe(false)
    const r = resolveCanonicalImage({ entityType: 'player', canonicalEntityId: 'p1', sport: 'NFL', imageType: 'headshot', candidates: [{ ...officialPlayer, url: 'https://broken.example/x.png' }, secondaryPlayer], knownBroken: broken })
    expect(r.source).toBe('thesportsdb')
  })
  it('empty official URL is rejected, not rendered', () => {
    const r = resolveCanonicalImage({ entityType: 'player', canonicalEntityId: 'p1', sport: 'NFL', imageType: 'headshot', candidates: [{ ...officialPlayer, url: '' }, fallbackPlayer] })
    expect(r.source).toBe('sleeper')
  })
})

describe('5H-c image — entity + sport isolation', () => {
  it('a team-logo candidate is not used for a player headshot request', () => {
    const teamLogo: ImageCandidate = { tier: 'verified_official', source: 'espn', url: 'https://espn/logo.png', imageType: 'logo', sport: 'NFL' }
    const r = resolveCanonicalImage({ entityType: 'player', canonicalEntityId: 'p1', sport: 'NFL', imageType: 'headshot', candidates: [teamLogo, fallbackPlayer] })
    expect(r.source).toBe('sleeper') // headshot fallback, not the team logo
    expect(r.imageType).toBe('headshot')
  })
  it('an NCAAF entity never uses an NFL image candidate (no cross-sport fallback)', () => {
    const nflImg: ImageCandidate = { ...officialPlayer, sport: 'NFL' }
    const r = resolveCanonicalImage({ entityType: 'player', canonicalEntityId: 'p1', sport: 'NCAAF', imageType: 'headshot', candidates: [nflImg] })
    expect(r.isPlaceholder).toBe(true)
    expect(r.url).toBeNull()
    expect(r.unsupportedReason).toBe('no_candidate_for_entity_sport')
  })
  it('an NBA player and NHL player do not share NFL imagery', () => {
    const r = resolveCanonicalImage({ entityType: 'player', canonicalEntityId: 'p1', sport: 'NBA', imageType: 'headshot', candidates: [officialPlayer] })
    expect(r.isPlaceholder).toBe(true)
  })
})

describe('5H-c image — honest missing imagery + provenance', () => {
  it('returns an honest placeholder (url null) when nothing valid exists', () => {
    const r = resolveCanonicalImage({ entityType: 'player', canonicalEntityId: 'p1', sport: 'NFL', imageType: 'headshot', candidates: [placeholderPlayer] })
    expect(r.isPlaceholder).toBe(true)
    expect(r.url).toBeNull()
    expect(r.fallbackRank).toBe(4)
    expect(r.provenance).toBeTruthy()
  })
  it('records the rejection reason when a candidate existed but was invalid', () => {
    const r = resolveCanonicalImage({ entityType: 'player', canonicalEntityId: 'p1', sport: 'NFL', imageType: 'headshot', candidates: [{ ...officialPlayer, url: '' }] })
    expect(r.isPlaceholder).toBe(true)
    expect(r.validationStatus).toBe('rejected_empty')
    expect(r.unsupportedReason).toBe('no_valid_image_source')
  })
  it('retains provenance + fallback rank on a resolved image', () => {
    const r = resolveCanonicalImage({ entityType: 'player', canonicalEntityId: 'p1', sport: 'NFL', imageType: 'headshot', candidates: [officialPlayer], provenance: 'proving' })
    expect(r.provenance).toBe('proving')
    expect(r.fallbackRank).toBe(1)
  })
})
