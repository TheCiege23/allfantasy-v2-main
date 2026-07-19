/**
 * Phase 2 — canonical identity + canonical read path.
 *
 * The properties that matter most here are the ones a wrong answer would silently corrupt:
 * that the same human always derives the same canonical id (so the backfill is idempotent),
 * and that two different humans never collide onto one id.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  player: { findUnique: vi.fn() },
  team: { findUnique: vi.fn() },
  playerImage: { findFirst: vi.fn() },
  teamImage: { findFirst: vi.fn() },
  playerSeasonStat: { findFirst: vi.fn() },
  fantasyProjection: { findMany: vi.fn() },
  aiPlayerOutlookCache: { findFirst: vi.fn() },
  playerNewsItem: { findMany: vi.fn() },
  injuryReport: { findFirst: vi.fn() },
  playerProviderIdentity: { findMany: vi.fn() },
  teamProviderIdentity: { findMany: vi.fn() },
}))

const headshotMock = vi.hoisted(() => ({ resolvePlayerHeadshot: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

// Partial mock on purpose: `canonicalIdentity` depends on the REAL `normalizePlayerName`, and
// hand-copying it into the mock silently diverged (the copied character class dropped the
// straight apostrophe, so "Ja'Marr" and "Ja’Marr" derived different ids in the test but not in
// production). Only the network-touching export is replaced.
vi.mock('@/lib/player-assets/resolvePlayerHeadshot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/player-assets/resolvePlayerHeadshot')>()),
  resolvePlayerHeadshot: headshotMock.resolvePlayerHeadshot,
}))

import {
  deriveCanonicalPlayerIdentity,
  deriveCanonicalTeamIdentity,
} from '@/lib/canonical/canonicalIdentity'
import { getCanonicalPlayer, getCanonicalTeam } from '@/lib/canonical/getCanonicalPlayer'

describe('canonical identity — matching key', () => {
  it('is deterministic: the same player always derives the same id', () => {
    const seed = { name: 'Ja’Marr Chase', sport: 'NFL', position: 'WR', sleeperId: '7564' }
    expect(deriveCanonicalPlayerIdentity(seed).id).toBe(deriveCanonicalPlayerIdentity(seed).id)
  })

  it('collapses the same player ingested from different sources (same sleeperId)', () => {
    // This is the property the backfill's dedup pass depends on.
    const viaSleeper = deriveCanonicalPlayerIdentity({
      name: 'Joe Flacco', sport: 'NFL', position: 'QB', sleeperId: '19',
    })
    const viaEspn = deriveCanonicalPlayerIdentity({
      name: 'Joe Flacco', sport: 'NFL', position: 'QB', sleeperId: '19',
    })
    expect(viaSleeper.id).toBe(viaEspn.id)
    expect(viaSleeper.strategy).toBe('sleeper_id')
  })

  it('does NOT collide the two Josh Allens', () => {
    // Real NFL case: QB (BUF) and LB (JAX). Name-only matching would merge them and corrupt
    // every downstream read, which is why position is part of the fallback key.
    const qb = deriveCanonicalPlayerIdentity({ name: 'Josh Allen', sport: 'NFL', position: 'QB' })
    const lb = deriveCanonicalPlayerIdentity({ name: 'Josh Allen', sport: 'NFL', position: 'LB' })
    expect(qb.id).not.toBe(lb.id)
  })

  it('falls back to name+sport+position when no sleeperId exists (e.g. soccer)', () => {
    const identity = deriveCanonicalPlayerIdentity({
      name: 'Erling Haaland', sport: 'SOCCER', position: 'FW',
    })
    expect(identity.strategy).toBe('name_sport_position')
    expect(identity.id).toMatch(/^soccer-erling-haaland-[0-9a-f]{8}$/)
  })

  it('treats straight and typographic apostrophes as the same player', () => {
    // Regression: `normalizePlayerName`'s character class contained U+0027 TWICE and omitted
    // U+2019 entirely — a smart-quotes-in-source typo. Providers and user input both emit the
    // typographic form, so "Ja'Marr" and "Ja’Marr" derived two different canonical ids, which
    // would have produced duplicate canonical players for one person. Explicit \u escapes now
    // make the class immune to an editor rewriting the literal.
    const straight = deriveCanonicalPlayerIdentity({ name: "Ja'Marr Chase", sport: 'NFL', position: 'WR' })
    const typographic = deriveCanonicalPlayerIdentity({ name: 'Ja’Marr Chase', sport: 'NFL', position: 'WR' })
    expect(straight.id).toBe(typographic.id)
  })

  it('normalizes suffixes and hyphens so variants agree', () => {
    const a = deriveCanonicalPlayerIdentity({ name: 'Brian Thomas Jr.', sport: 'NFL', position: 'WR' })
    const b = deriveCanonicalPlayerIdentity({ name: 'Brian Thomas', sport: 'NFL', position: 'WR' })
    expect(a.id).toBe(b.id)
  })

  it('separates same-named players across different sports', () => {
    const nfl = deriveCanonicalPlayerIdentity({ name: 'Chris Paul', sport: 'NFL', position: 'WR' })
    const nba = deriveCanonicalPlayerIdentity({ name: 'Chris Paul', sport: 'NBA', position: 'PG' })
    expect(nfl.id).not.toBe(nba.id)
  })

  it('normalizes teams onto their natural unique key', () => {
    expect(deriveCanonicalTeamIdentity({ name: '  Cincinnati   Bengals ', sport: 'nfl' })).toEqual({
      sportKey: 'NFL', leagueKey: null, normalizedName: 'cincinnati bengals',
    })
  })
})

describe('getCanonicalPlayer', () => {
  const PLAYER = {
    id: 'nfl-jamarr-chase-abc12345', name: 'Ja’Marr Chase', sport: 'NFL', position: 'WR',
    team: 'CIN', active: true, height: '72', weight: '201', injuryStatus: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.player.findUnique.mockResolvedValue(PLAYER)
    prismaMock.playerImage.findFirst.mockResolvedValue({
      url: 'https://cdn.test/x.png', provider: 'sportsdb', confidence: 0.8,
      fetchedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000),
    })
    prismaMock.playerSeasonStat.findFirst.mockResolvedValue({
      seasonKey: '2025', seasonType: 'regular', stats: { yards: 1201 },
      fantasyPoints: 241.6, gamesPlayed: 16, source: 'test',
    })
    prismaMock.fantasyProjection.findMany.mockResolvedValue([
      { season: '2025', week: 1, projectedPoints: 18.4, source: 'test' },
    ])
    prismaMock.aiPlayerOutlookCache.findFirst.mockResolvedValue({
      outlookPayload: { summary: 'WR1' }, expiresAt: new Date(Date.now() + 86_400_000),
    })
    prismaMock.playerNewsItem.findMany.mockResolvedValue([
      { headline: 'Full participant', url: 'https://n/1', publishedAt: new Date() },
    ])
    prismaMock.injuryReport.findFirst.mockResolvedValue({
      status: 'Questionable', bodyPart: 'Hamstring', description: 'Limited',
    })
    prismaMock.playerProviderIdentity.findMany.mockResolvedValue([
      { provider: 'sleeper', providerPlayerId: '7564' },
      { provider: 'espn', providerPlayerId: '4362628' },
    ])
  })

  it('assembles the whole object in one call', async () => {
    const result = await getCanonicalPlayer(PLAYER.id)

    expect(result?.name).toBe('Ja’Marr Chase')
    expect(result?.image?.url).toBe('https://cdn.test/x.png')
    expect(result?.seasonStats?.fantasyPoints).toBe(241.6)
    expect(result?.projections).toHaveLength(1)
    expect(result?.outlook?.payload).toEqual({ summary: 'WR1' })
    expect(result?.news).toHaveLength(1)
    expect(result?.injury?.status).toBe('Questionable')
    expect(result?.providerIds).toEqual({ sleeper: '7564', espn: '4362628' })
    expect(result?.meta.missing).toEqual([])
  })

  it('makes zero provider calls when the image is already cached', async () => {
    await getCanonicalPlayer(PLAYER.id)
    expect(headshotMock.resolvePlayerHeadshot).not.toHaveBeenCalled()
  })

  it('falls back to live resolution once for an unmapped player, then persists', async () => {
    prismaMock.playerImage.findFirst
      .mockResolvedValueOnce(null) // initial read: no image
      .mockResolvedValueOnce({     // re-read after the write-through persisted it
        url: 'https://cdn.test/new.png', provider: 'sportsdb', confidence: 0.8,
        fetchedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000),
      })
    headshotMock.resolvePlayerHeadshot.mockResolvedValue({
      imageUrl: 'https://cdn.test/new.png', source: 'sportsdb', confidence: 'exact',
    })

    const result = await getCanonicalPlayer(PLAYER.id)

    expect(headshotMock.resolvePlayerHeadshot).toHaveBeenCalledTimes(1)
    // Resolution must be keyed by the canonical id so the write-through lands there.
    expect(headshotMock.resolvePlayerHeadshot).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: PLAYER.id }),
    )
    expect(result?.meta.resolvedLiveImage).toBe(true)
    expect(result?.image?.url).toBe('https://cdn.test/new.png')
  })

  it('skipLiveFallback guarantees no network call even with no image', async () => {
    prismaMock.playerImage.findFirst.mockResolvedValue(null)

    const result = await getCanonicalPlayer(PLAYER.id, { skipLiveFallback: true })

    expect(headshotMock.resolvePlayerHeadshot).not.toHaveBeenCalled()
    expect(result?.meta.missing).toContain('image')
  })

  it('reports which satellites are missing rather than pretending they are empty', async () => {
    prismaMock.playerSeasonStat.findFirst.mockResolvedValue(null)
    prismaMock.playerNewsItem.findMany.mockResolvedValue([])

    const result = await getCanonicalPlayer(PLAYER.id, { skipLiveFallback: true })

    expect(result?.meta.missing).toEqual(expect.arrayContaining(['seasonStats', 'news']))
  })

  it('returns null for an unknown id', async () => {
    prismaMock.player.findUnique.mockResolvedValue(null)
    expect(await getCanonicalPlayer('nope')).toBeNull()
    expect(await getCanonicalPlayer('')).toBeNull()
  })
})

describe('getCanonicalTeam', () => {
  it('returns the team with its logo and provider ids', async () => {
    prismaMock.team.findUnique.mockResolvedValue({
      id: 'team-1', sportKey: 'NFL', leagueKey: null, canonicalName: 'Cincinnati Bengals',
      normalizedName: 'cincinnati bengals', shortName: 'CIN', abbreviation: 'CIN',
      city: null, conference: null, division: null, active: true,
    })
    prismaMock.teamImage.findFirst.mockResolvedValue({
      url: 'https://cdn.test/cin.png', provider: 'seed', confidence: 1,
      fetchedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000),
    })
    prismaMock.teamProviderIdentity.findMany.mockResolvedValue([
      { provider: 'sleeper', providerTeamId: 'CIN' },
    ])

    const team = await getCanonicalTeam('team-1')

    expect(team?.canonicalName).toBe('Cincinnati Bengals')
    expect(team?.logo?.url).toBe('https://cdn.test/cin.png')
    expect(team?.providerIds).toEqual({ sleeper: 'CIN' })
    expect(team?.meta.missing).toEqual([])
  })

  it('returns null for an unknown id', async () => {
    prismaMock.team.findUnique.mockResolvedValue(null)
    expect(await getCanonicalTeam('nope')).toBeNull()
  })
})
