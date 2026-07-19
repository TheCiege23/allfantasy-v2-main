/**
 * Phase 2 — canonical identity + canonical read path.
 *
 * The properties that matter most here are the ones a wrong answer would silently corrupt:
 * that the same human always derives the same canonical id (so the backfill is idempotent),
 * and that two different humans never collide onto one id.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  player: { findUnique: vi.fn(), findMany: vi.fn() },
  team: { findUnique: vi.fn() },
  playerImage: { findFirst: vi.fn(), findMany: vi.fn() },
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
const sleeperClientMock = vi.hoisted(() => ({ getAllPlayers: vi.fn(async () => ({})) }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

// The freshness guard imports this lazily for its live overlay.
vi.mock('@/lib/sleeper-client', () => sleeperClientMock)

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
  normalizePosition,
  NON_PLAYER_POSITIONS,
} from '@/lib/canonical/canonicalIdentity'
import {
  getCanonicalPlayer,
  getCanonicalPlayerMapForSport,
  getCanonicalTeam,
  DECISION_FRESHNESS_MS,
  type FreshnessStats,
} from '@/lib/canonical/getCanonicalPlayer'
import { classifySourceStatus } from '@/lib/canonical/backfillCanonical'

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

  it('falls back to name+sport+position+team when no sleeperId exists (e.g. soccer)', () => {
    const identity = deriveCanonicalPlayerIdentity({
      name: 'Erling Haaland', sport: 'SOCCER', position: 'FW', team: 'MCI',
    })
    expect(identity.strategy).toBe('name_sport_position_team')
    expect(identity.id).toMatch(/^soccer-erling-haaland-[0-9a-f]{8}$/)
  })

  it('does NOT fuse different college players who share a name AND position', () => {
    // Found against the real 95,839-row SportsPlayer table, not a sample: five different
    // NCAAB guards named "Jordan Williams" (Arizona State, Rice, St. Francis Brooklyn,
    // Texas A&M, Vanderbilt), none with a sleeperId because Sleeper covers NFL only. With
    // `(sport, name, position)` alone they collapsed into ONE canonical player; 6,439 rows
    // were at risk this way. `team` is what separates them.
    const schools = [
      'Arizona State University', 'Rice University', 'St. Francis Brooklyn',
      'Texas A&M University', 'Vanderbilt University',
    ]
    const ids = schools.map((team) =>
      deriveCanonicalPlayerIdentity({ name: 'Jordan Williams', sport: 'NCAAB', position: 'G', team }).id,
    )
    expect(new Set(ids).size).toBe(5)
  })

  it('still collapses one player across sources via sleeperId even if team differs', () => {
    // Team is only in the FALLBACK key, so a traded NFL player with a sleeperId still
    // collapses — which is why keying on team is safe for the sport that has real trades.
    const cin = deriveCanonicalPlayerIdentity({
      name: 'Joe Flacco', sport: 'NFL', position: 'QB', team: 'CIN', sleeperId: '19',
    })
    const cle = deriveCanonicalPlayerIdentity({
      name: 'Joe Flacco', sport: 'NFL', position: 'QB', team: 'CLE', sleeperId: '19',
    })
    expect(cin.id).toBe(cle.id)
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

  it('folds long-form positions so one player from two sources collapses', () => {
    // Found by the Phase 3 pilot spot-check against real data: 1,076 of 14,117 canonical NFL
    // players (7.6%) stored "Wide Receiver" rather than "WR", because NFL is the only sport
    // with multiple sources and the non-Sleeper five emit long form. Since position is part of
    // the fallback matching key, the same player derived two ids and never merged — and
    // migrated call sites rendered "Wide Receiver" where the live path gave "WR".
    const short = deriveCanonicalPlayerIdentity({ name: 'Test Player', sport: 'NFL', position: 'WR', team: 'CIN' })
    const long = deriveCanonicalPlayerIdentity({ name: 'Test Player', sport: 'NFL', position: 'Wide Receiver', team: 'CIN' })
    expect(short.id).toBe(long.id)
  })

  it('leaves unknown positions alone and does not relabel non-player roles', () => {
    expect(normalizePosition('Rover')).toBe('ROVER')
    // `Assistant Coach` / `Manager` / `Co-Driver` leak into SportsPlayer from upstream feeds.
    // They are a filtering problem at ingestion, not something to silently map to a position.
    expect(NON_PLAYER_POSITIONS.has('ASSISTANT COACH')).toBe(true)
    expect(normalizePosition('Assistant Coach')).toBe('ASSISTANT COACH')
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

describe('getCanonicalPlayerMapForSport — the enumeration shape', () => {
  /**
   * The third `getAllPlayers()` usage shape: a call site that iterates the entire player
   * universe rather than looking ids up. Batch 1 only proved the two lookup shapes.
   */
  const IDENTITIES = [
    { playerId: 'nfl-a-1111', providerPlayerId: '4034' },
    { playerId: 'nfl-b-2222', providerPlayerId: '6794' },
    { playerId: 'nfl-ghost-9', providerPlayerId: '9999' }, // identity with no Player row
  ]
  const PLAYERS = [
    { id: 'nfl-a-1111', name: 'Alvin Kamara', sport: 'NFL', position: 'RB', team: 'NO', active: true, imageUrl: 'https://cdn/a.png' },
    { id: 'nfl-b-2222', name: 'Justin Jefferson', sport: 'NFL', position: 'WR', team: 'MIN', active: true, imageUrl: null },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.playerProviderIdentity.findMany.mockResolvedValue(IDENTITIES)
    prismaMock.player.findMany.mockResolvedValue(PLAYERS)
    prismaMock.playerImage.findMany.mockResolvedValue([])
  })

  it('returns a map keyed by SLEEPER id, matching the shape call sites already index', async () => {
    const map = await getCanonicalPlayerMapForSport('NFL')

    // Callers index `players[sleeperId]`, so the key must be the Sleeper id, not Player.id.
    expect(map.get('4034')?.name).toBe('Alvin Kamara')
    expect(map.get('6794')?.position).toBe('WR')
    expect(map.get('nfl-a-1111')).toBeUndefined()
  })

  it('drops identities with no canonical player rather than emitting a partial entry', async () => {
    const map = await getCanonicalPlayerMapForSport('NFL')
    expect(map.has('9999')).toBe(false)
    expect(map.size).toBe(2)
  })

  it('stays at two queries and does NOT read images by default', async () => {
    // Joining PlayerImage across a whole sport is a third read over every row; enumeration
    // callers rarely use it, so it is opt-in.
    await getCanonicalPlayerMapForSport('NFL')
    expect(prismaMock.playerImage.findMany).not.toHaveBeenCalled()
    expect(prismaMock.player.findMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.playerProviderIdentity.findMany).toHaveBeenCalledTimes(1)
  })

  it('falls back to the denormalized Player.imageUrl when images are not joined', async () => {
    const map = await getCanonicalPlayerMapForSport('NFL')
    expect(map.get('4034')?.imageUrl).toBe('https://cdn/a.png')
    expect(map.get('6794')?.imageUrl).toBeNull()
  })

  it('prefers the primary PlayerImage when includeImages is set', async () => {
    prismaMock.playerImage.findMany.mockResolvedValue([
      { playerId: 'nfl-b-2222', url: 'https://cdn/primary.png' },
    ])

    const map = await getCanonicalPlayerMapForSport('NFL', { includeImages: true })

    expect(prismaMock.playerImage.findMany).toHaveBeenCalledTimes(1)
    expect(map.get('6794')?.imageUrl).toBe('https://cdn/primary.png')
  })

  it('scopes the identity read to the sport and normalizes case', async () => {
    await getCanonicalPlayerMapForSport('nfl')
    expect(prismaMock.playerProviderIdentity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { provider: 'sleeper', sportKey: 'NFL' } }),
    )
  })

  it('honours activeOnly', async () => {
    await getCanonicalPlayerMapForSport('NFL', { activeOnly: true })
    expect(prismaMock.player.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sport: 'NFL', active: true } }),
    )
  })

  it('returns an empty map for a blank sport without querying', async () => {
    const map = await getCanonicalPlayerMapForSport('')
    expect(map.size).toBe(0)
    expect(prismaMock.player.findMany).not.toHaveBeenCalled()
  })
})

describe('classifySourceStatus — SportsPlayer.status is a MIXED column', () => {
  /**
   * Measured on the real NFL table: roster values (`Active` 10,930, `Inactive` 2,979, `ACT`
   * 1,159, `INACT` 367, `Retired` 136) share the column with injury values (`Questionable` 406,
   * `Injured Reserve` 226, `IR`, `PUP`). Copying it wholesale into `injuryStatus` gave ~10,930
   * players an "injury status" of `Active`.
   */
  it('maps roster-active values to active with NO injury status', () => {
    for (const v of ['Active', 'ACT', 'active']) {
      expect(classifySourceStatus(v)).toEqual({ active: true, injuryStatus: null })
    }
  })

  it('maps roster-inactive values to inactive with NO injury status', () => {
    for (const v of ['Inactive', 'INACT', 'Retired', 'NA', 'Free Agent']) {
      expect(classifySourceStatus(v)).toEqual({ active: false, injuryStatus: null })
    }
  })

  it('keeps injury designations as injuryStatus and leaves the player active', () => {
    // An injured player is still rostered — `active` must not be flipped by an injury.
    for (const v of ['Questionable', 'Injured Reserve', 'IR', 'PUP', 'Out', 'Doubtful']) {
      expect(classifySourceStatus(v)).toEqual({ active: true, injuryStatus: v })
    }
  })

  it('treats a missing status as active, not injured', () => {
    expect(classifySourceStatus(null)).toEqual({ active: true, injuryStatus: null })
    expect(classifySourceStatus('  ')).toEqual({ active: true, injuryStatus: null })
  })
})

describe('freshness guard', () => {
  const IDENTITIES = [{ playerId: 'p-fresh', providerPlayerId: '111' }, { playerId: 'p-stale', providerPlayerId: '222' }]
  const base = { sport: 'NFL', position: 'RB', active: true, injuryStatus: null, imageUrl: null }

  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.playerProviderIdentity.findMany.mockResolvedValue(IDENTITIES)
    prismaMock.playerImage.findMany.mockResolvedValue([])
    prismaMock.player.findMany.mockResolvedValue([
      // observed an hour ago, source TTL still in the future
      { id: 'p-fresh', name: 'Fresh Guy', team: 'KC', ...base,
        fetchedAt: new Date(Date.now() - 60 * 60 * 1000),
        expiresAt: new Date(Date.now() + 86_400_000) },
      // observed 30 days ago — canonical still says NE, live says cut
      { id: 'p-stale', name: 'Stale Guy', team: 'NE', ...base,
        fetchedAt: new Date(Date.now() - 30 * 86_400_000),
        expiresAt: new Date(Date.now() - 86_400_000) },
    ])
    sleeperClientMock.getAllPlayers.mockResolvedValue({
      '111': { full_name: 'Fresh Guy', position: 'RB', team: 'KC' },
      '222': { full_name: 'Stale Guy', position: 'RB', team: null },
    })
  })

  it('does not contact the provider at all when no threshold is given', async () => {
    const stats: FreshnessStats = { checked: 0, stale: 0, refreshed: 0, liveFetched: false }
    const map = await getCanonicalPlayerMapForSport('NFL', { stats })

    expect(sleeperClientMock.getAllPlayers).not.toHaveBeenCalled()
    expect(stats).toMatchObject({ checked: 0, stale: 0, refreshed: 0, liveFetched: false })
    expect(map.get('222')?.team).toBe('NE') // cache-only keeps the stale value
  })

  it('refreshes ONLY the stale row and leaves the current one untouched', async () => {
    const stats: FreshnessStats = { checked: 0, stale: 0, refreshed: 0, liveFetched: false }
    const map = await getCanonicalPlayerMapForSport('NFL', {
      maxAgeMs: DECISION_FRESHNESS_MS, stats,
    })

    expect(stats.checked).toBe(2)
    expect(stats.stale).toBe(1)
    expect(stats.refreshed).toBe(1)
    // One live call total, regardless of how many rows were stale.
    expect(sleeperClientMock.getAllPlayers).toHaveBeenCalledTimes(1)
    expect(map.get('222')?.team).toBeNull()  // corrected from the stale "NE"
    expect(map.get('111')?.team).toBe('KC')  // untouched
  })

  it('treats a past source TTL as stale even inside the age threshold', async () => {
    prismaMock.player.findMany.mockResolvedValue([
      { id: 'p-stale', name: 'Stale Guy', team: 'NE', ...base,
        fetchedAt: new Date(Date.now() - 60 * 1000),        // a minute old
        expiresAt: new Date(Date.now() - 60 * 1000) },      // but already expired
    ])
    prismaMock.playerProviderIdentity.findMany.mockResolvedValue([
      { playerId: 'p-stale', providerPlayerId: '222' },
    ])
    const stats: FreshnessStats = { checked: 0, stale: 0, refreshed: 0, liveFetched: false }

    await getCanonicalPlayerMapForSport('NFL', { maxAgeMs: DECISION_FRESHNESS_MS, stats })

    expect(stats.stale).toBe(1)
  })

  it('treats a row with no observation time as stale rather than assuming fresh', async () => {
    prismaMock.player.findMany.mockResolvedValue([
      { id: 'p-stale', name: 'Stale Guy', team: 'NE', ...base, fetchedAt: null, expiresAt: null },
    ])
    prismaMock.playerProviderIdentity.findMany.mockResolvedValue([
      { playerId: 'p-stale', providerPlayerId: '222' },
    ])
    const stats: FreshnessStats = { checked: 0, stale: 0, refreshed: 0, liveFetched: false }

    await getCanonicalPlayerMapForSport('NFL', { maxAgeMs: DECISION_FRESHNESS_MS, stats })

    expect(stats.stale).toBe(1)
  })

  it('keeps the cached row when a stale player is absent from live data', async () => {
    // Present in canonical, gone from Sleeper's universe: do not invent a value.
    sleeperClientMock.getAllPlayers.mockResolvedValue({})
    const stats: FreshnessStats = { checked: 0, stale: 0, refreshed: 0, liveFetched: false }

    const map = await getCanonicalPlayerMapForSport('NFL', {
      maxAgeMs: DECISION_FRESHNESS_MS, stats,
    })

    expect(stats.stale).toBe(1)
    expect(stats.refreshed).toBe(0)
    expect(map.get('222')?.team).toBe('NE')
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
