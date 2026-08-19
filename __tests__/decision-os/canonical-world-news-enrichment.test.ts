import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assembleCanonicalWorld } from '@/lib/decision-os/world/assemble'
import { projectEnrichedWorld } from '@/lib/decision-os/world/enrichedWorld'
import {
  deriveNewsAgeTier,
  projectNewsFreshness,
  selectBestNewsRow,
  classifyNewsCategory,
  projectNewsContext,
  projectNewsEnrichedWorld,
  resolveNewsContext,
  resolveNewsEnrichedCanonicalWorld,
  type NewsContextResult,
} from '@/lib/decision-os/world/newsEnrichedWorld'
import type {
  CanonicalWorld,
  NormalizedPlayerMetadata,
  PlayerMetadataResult,
  RawNewsRow,
} from '@/lib/decision-os/world'
import { makeImportedProviderWorld, makeNativeAfWorld } from './canonicalWorldFakes'

const NOW = new Date('2026-06-30T12:00:00.000Z')
const FRESH_AT = new Date('2026-06-30T08:00:00.000Z')   // 4h before NOW — fresh
const RECENT_AT = new Date('2026-06-26T12:00:00.000Z')  // 4 days before NOW — recent
const STALE_AT = new Date('2026-06-20T12:00:00.000Z')   // 10 days before NOW — stale

const assemble = (input: Parameters<typeof assembleCanonicalWorld>[0]): CanonicalWorld =>
  assembleCanonicalWorld(input, { now: NOW })

function idsOf(world: CanonicalWorld): string[] {
  return Array.from(new Set(world.rosters.flatMap((r) => r.playerIds)))
}

function meta(ids: string[], name = 'Patrick Mahomes', team = 'KC'): PlayerMetadataResult {
  const byId = new Map<string, NormalizedPlayerMetadata>()
  for (const id of ids) {
    byId.set(id, {
      playerId: id, name, position: 'QB', team,
      injuryStatus: null, byeWeek: null, projectedPoints: null,
      projectionConfidence: null, source: 'sports_player_cache', resolved: true,
    })
  }
  return { byId, complete: true, unresolvedIds: [], warnings: [] }
}

function metaMulti(ids: string[]): PlayerMetadataResult {
  const names = ['Patrick Mahomes', 'Travis Kelce', 'Tyreek Hill', 'Justin Jefferson', 'CeeDee Lamb', 'Cooper Kupp', 'Stefon Diggs']
  const byId = new Map<string, NormalizedPlayerMetadata>()
  ids.forEach((id, i) => {
    byId.set(id, {
      playerId: id, name: names[i % names.length] ?? `Player ${i}`, position: 'WR',
      team: 'NFL', injuryStatus: null, byeWeek: null, projectedPoints: null,
      projectionConfidence: null, source: 'sports_player_cache', resolved: true,
    })
  })
  return { byId, complete: true, unresolvedIds: [], warnings: [] }
}

function newsRow(playerName: string, opts: Partial<RawNewsRow> = {}): RawNewsRow {
  return {
    id: `news-${playerName.replace(/\s/g, '-').toLowerCase()}`,
    sport: 'NFL',
    playerName,
    team: 'KC',
    headline: `${playerName} is questionable for Week 6`,
    body: `${playerName} was limited in practice Wednesday with a knee injury.`,
    impact: 'high',
    fantasyRelevant: true,
    source: 'rolling_insights',
    publishedAt: FRESH_AT,
    createdAt: FRESH_AT,
    ...opts,
  }
}

function emptyContextResult(): NewsContextResult {
  return { rowsByName: new Map(), error: null }
}

function contextResultFrom(entries: Array<{ name: string; rows: RawNewsRow[] }>): NewsContextResult {
  const rowsByName = new Map<string, RawNewsRow[]>()
  for (const { name, rows } of entries) rowsByName.set(name.toLowerCase(), rows)
  return { rowsByName, error: null }
}

// ──────────────────────────────────────────────────────────────────────────
// deriveNewsAgeTier
// ──────────────────────────────────────────────────────────────────────────

describe('deriveNewsAgeTier', () => {
  it('returns fresh when within 24h', () => {
    expect(deriveNewsAgeTier(FRESH_AT, NOW)).toBe('fresh')
  })

  it('returns recent when between 24h and 7d', () => {
    expect(deriveNewsAgeTier(RECENT_AT, NOW)).toBe('recent')
  })

  it('returns stale when older than 7d', () => {
    expect(deriveNewsAgeTier(STALE_AT, NOW)).toBe('stale')
  })

  it('returns fresh at exactly 24h boundary (same millisecond)', () => {
    const exactly24h = new Date(NOW.getTime() - 24 * 60 * 60 * 1000)
    expect(deriveNewsAgeTier(exactly24h, NOW)).toBe('fresh')
  })

  it('returns recent at exactly 7d boundary (stale is strictly >7d)', () => {
    const exactly7d = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000)
    expect(deriveNewsAgeTier(exactly7d, NOW)).toBe('recent')
  })

  it('returns stale just past 7d boundary', () => {
    const justPast7d = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000 - 1)
    expect(deriveNewsAgeTier(justPast7d, NOW)).toBe('stale')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// projectNewsFreshness
// ──────────────────────────────────────────────────────────────────────────

describe('projectNewsFreshness', () => {
  it('returns fresh freshness for recent news', () => {
    const row = newsRow('Mahomes', { publishedAt: FRESH_AT })
    const f = projectNewsFreshness(row, NOW)
    expect(f.ageTier).toBe('fresh')
    expect(f.isStale).toBe(false)
    expect(f.staleReason).toBeNull()
    expect(f.publishedAt).toEqual(FRESH_AT)
  })

  it('returns recent freshness for 4-day-old news', () => {
    const row = newsRow('Mahomes', { publishedAt: RECENT_AT })
    const f = projectNewsFreshness(row, NOW)
    expect(f.ageTier).toBe('recent')
    expect(f.isStale).toBe(false)
    expect(f.staleReason).toBeNull()
  })

  it('returns stale freshness for 10-day-old news', () => {
    const row = newsRow('Mahomes', { publishedAt: STALE_AT })
    const f = projectNewsFreshness(row, NOW)
    expect(f.ageTier).toBe('stale')
    expect(f.isStale).toBe(true)
    expect(f.staleReason).toBe('news_stale_7d')
  })

  it('returns null freshness when no row', () => {
    const f = projectNewsFreshness(null, NOW)
    expect(f.ageTier).toBeNull()
    expect(f.isStale).toBeNull()
    expect(f.publishedAt).toBeNull()
    expect(f.staleReason).toBe('news_freshness_unavailable')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// selectBestNewsRow
// ──────────────────────────────────────────────────────────────────────────

describe('selectBestNewsRow', () => {
  it('returns null for empty array', () => {
    expect(selectBestNewsRow([])).toBeNull()
  })

  it('returns the only row', () => {
    const row = newsRow('Mahomes')
    expect(selectBestNewsRow([row])).toBe(row)
  })

  it('prefers fantasyRelevant rows over non-relevant', () => {
    const nonRelevant = newsRow('Mahomes', { fantasyRelevant: false, publishedAt: FRESH_AT, headline: 'old but recent' })
    const relevant = newsRow('Mahomes', { fantasyRelevant: true, publishedAt: RECENT_AT, headline: 'fantasy relevant' })
    // port orders by publishedAt desc, so nonRelevant comes first
    const result = selectBestNewsRow([nonRelevant, relevant])
    expect(result?.fantasyRelevant).toBe(true)
    expect(result?.headline).toBe('fantasy relevant')
  })

  it('when all are fantasy-relevant takes first (freshest from port ordering)', () => {
    const row1 = newsRow('Mahomes', { fantasyRelevant: true, publishedAt: FRESH_AT })
    const row2 = newsRow('Mahomes', { fantasyRelevant: true, publishedAt: RECENT_AT })
    expect(selectBestNewsRow([row1, row2])).toBe(row1)
  })

  it('falls back to first row when none are fantasy-relevant', () => {
    const row1 = newsRow('Mahomes', { fantasyRelevant: false, publishedAt: FRESH_AT })
    const row2 = newsRow('Mahomes', { fantasyRelevant: false, publishedAt: RECENT_AT })
    expect(selectBestNewsRow([row1, row2])).toBe(row1)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// classifyNewsCategory
// ──────────────────────────────────────────────────────────────────────────

describe('classifyNewsCategory', () => {
  it('classifies injury news', () => {
    const row = newsRow('Mahomes', { headline: 'Mahomes is questionable with knee injury', body: '' })
    expect(classifyNewsCategory(row)).toBe('injury')
  })

  it('classifies suspension news', () => {
    const row = newsRow('Player', { headline: 'Player suspended 6 games', body: 'suspension for conduct' })
    expect(classifyNewsCategory(row)).toBe('suspension')
  })

  it('classifies trade news', () => {
    const row = newsRow('Player', { headline: 'Star receiver traded to AFC team', body: '' })
    expect(classifyNewsCategory(row)).toBe('trade')
  })

  it('defaults to player_news when no keyword matches', () => {
    const row = newsRow('Player', { headline: 'Player attends charity event', body: 'Had a great time at the event.' })
    expect(classifyNewsCategory(row)).toBe('player_news')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// projectNewsContext
// ──────────────────────────────────────────────────────────────────────────

describe('projectNewsContext', () => {
  it('returns news_unavailable when no rows', () => {
    const ctx = projectNewsContext([], NOW)
    expect(ctx.headline).toBeNull()
    expect(ctx.uncertainty).toContain('news_unavailable')
  })

  it('returns full context on fresh news row', () => {
    const row = newsRow('Patrick Mahomes', { publishedAt: FRESH_AT })
    const ctx = projectNewsContext([row], NOW)
    expect(ctx.headline).toBe(row.headline)
    expect(ctx.body).toBe(row.body)
    expect(ctx.impact).toBe('high')
    expect(ctx.fantasyRelevant).toBe(true)
    expect(ctx.source).toBe('rolling_insights')
    expect(ctx.freshness.isStale).toBe(false)
    expect(ctx.freshness.ageTier).toBe('fresh')
    expect(ctx.uncertainty).toHaveLength(0)
  })

  it('adds news_stale on stale row', () => {
    const row = newsRow('Mahomes', { publishedAt: STALE_AT })
    const ctx = projectNewsContext([row], NOW)
    expect(ctx.freshness.isStale).toBe(true)
    expect(ctx.uncertainty).toContain('news_stale')
  })

  it('classifies category correctly', () => {
    const row = newsRow('Mahomes', { headline: 'Mahomes ruled out — knee surgery', body: '' })
    const ctx = projectNewsContext([row], NOW)
    expect(ctx.category).toBe('injury')
  })

  it('carries non-fantasy-relevant rows when that is all available', () => {
    const row = newsRow('Player', { fantasyRelevant: false, publishedAt: FRESH_AT, headline: 'Player wins ESPY' })
    const ctx = projectNewsContext([row], NOW)
    expect(ctx.headline).toBe('Player wins ESPY')
    expect(ctx.fantasyRelevant).toBe(false)
  })

  it('prefers fantasy-relevant row even if it is older', () => {
    const general = newsRow('Player', { fantasyRelevant: false, publishedAt: FRESH_AT, headline: 'General news' })
    const fantasy = newsRow('Player', { fantasyRelevant: true, publishedAt: RECENT_AT, headline: 'Fantasy news' })
    // port returns general first (fresher), fantasy second
    const ctx = projectNewsContext([general, fantasy], NOW)
    expect(ctx.headline).toBe('Fantasy news')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// projectNewsEnrichedWorld — no mutation
// ──────────────────────────────────────────────────────────────────────────

describe('projectNewsEnrichedWorld — no mutation', () => {
  it('does not mutate the base enriched world', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids))
    const frozen = JSON.stringify(enriched)

    projectNewsEnrichedWorld(enriched, emptyContextResult(), NOW)

    expect(JSON.stringify(enriched)).toBe(frozen)
  })

  it('news layer does not appear on base rosters', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids))
    expect((enriched.rosters[0]?.players[0] as Record<string, unknown>)['newsContext']).toBeUndefined()
  })

  it('base world fields are preserved on projected world', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids))
    const projected = projectNewsEnrichedWorld(enriched, emptyContextResult(), NOW)
    expect(projected.league).toEqual(enriched.league)
    expect(projected.teams).toEqual(enriched.teams)
    expect(projected.provenance).toEqual(enriched.provenance)
    expect(projected.completeness).toEqual(enriched.completeness)
    expect(projected.metadata).toEqual(enriched.metadata)
    expect(projected.leagueFacts).toEqual(enriched.leagueFacts)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// projectNewsEnrichedWorld — summary counts
// ──────────────────────────────────────────────────────────────────────────

describe('projectNewsEnrichedWorld — summary', () => {
  it('counts totalPlayers correctly', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids))
    const projected = projectNewsEnrichedWorld(enriched, emptyContextResult(), NOW)
    expect(projected.newsSummary.totalPlayers).toBe(ids.length)
  })

  it('counts missingCount when no news data', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids, 'Patrick Mahomes'))
    const projected = projectNewsEnrichedWorld(enriched, emptyContextResult(), NOW)
    expect(projected.newsSummary.missingCount).toBe(ids.length)
  })

  it('counts withNews when news row present for player name', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids, 'Patrick Mahomes'))
    const result = contextResultFrom([{
      name: 'Patrick Mahomes',
      rows: [newsRow('Patrick Mahomes', { publishedAt: FRESH_AT })],
    }])
    const projected = projectNewsEnrichedWorld(enriched, result, NOW)
    expect(projected.newsSummary.withNews).toBe(ids.length)
    expect(projected.newsSummary.missingCount).toBe(0)
  })

  it('counts fantasyRelevantCount', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids, 'Patrick Mahomes'))
    const result = contextResultFrom([{
      name: 'Patrick Mahomes',
      rows: [newsRow('Patrick Mahomes', { fantasyRelevant: true, publishedAt: FRESH_AT })],
    }])
    const projected = projectNewsEnrichedWorld(enriched, result, NOW)
    expect(projected.newsSummary.fantasyRelevantCount).toBe(ids.length)
  })

  it('counts staleCount for stale rows', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids, 'Patrick Mahomes'))
    const result = contextResultFrom([{
      name: 'Patrick Mahomes',
      rows: [newsRow('Patrick Mahomes', { publishedAt: STALE_AT })],
    }])
    const projected = projectNewsEnrichedWorld(enriched, result, NOW)
    expect(projected.newsSummary.staleCount).toBe(ids.length)
  })

  it('players with no resolved name get news_name_unmatched and count as missing', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    // Simulate unresolved player: name = null
    const byId = new Map<string, NormalizedPlayerMetadata>()
    for (const id of ids) {
      byId.set(id, {
        playerId: id, name: null, position: null, team: null, injuryStatus: null,
        byeWeek: null, projectedPoints: null, projectionConfidence: null,
        source: null, resolved: false,
      })
    }
    const metaResult: PlayerMetadataResult = { byId, complete: false, unresolvedIds: ids, warnings: [] }
    const enriched = projectEnrichedWorld(world, metaResult)
    const projected = projectNewsEnrichedWorld(enriched, emptyContextResult(), NOW)
    for (const roster of projected.rosters) {
      for (const player of roster.players) {
        expect(player.newsContext.uncertainty).toContain('news_name_unmatched')
      }
    }
    expect(projected.newsSummary.missingCount).toBe(ids.length)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Origin-blind shape
// ──────────────────────────────────────────────────────────────────────────

describe('origin-blind shape', () => {
  it('imported and native worlds produce the same NewsEnrichedPlayer shape', () => {
    const importedWorld = assemble(makeImportedProviderWorld())
    const nativeWorld = assemble(makeNativeAfWorld())

    const importedIds = idsOf(importedWorld)
    const nativeIds = idsOf(nativeWorld)

    const importedEnriched = projectEnrichedWorld(importedWorld, meta(importedIds))
    const nativeEnriched = projectEnrichedWorld(nativeWorld, meta(nativeIds))

    const importedProjected = projectNewsEnrichedWorld(importedEnriched, emptyContextResult(), NOW)
    const nativeProjected = projectNewsEnrichedWorld(nativeEnriched, emptyContextResult(), NOW)

    const importedKeys = Object.keys(importedProjected.rosters[0]?.players[0] ?? {}).sort()
    const nativeKeys = Object.keys(nativeProjected.rosters[0]?.players[0] ?? {}).sort()
    expect(importedKeys).toEqual(nativeKeys)
  })

  it('provenance does not leak into newsContext fields', () => {
    const raw = makeImportedProviderWorld()
    const world = assemble(raw)
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids, 'Patrick Mahomes'))
    const result = contextResultFrom([{
      name: 'Patrick Mahomes',
      rows: [newsRow('Patrick Mahomes', { publishedAt: FRESH_AT })],
    }])
    const projected = projectNewsEnrichedWorld(enriched, result, NOW)
    const ctx = projected.rosters[0]!.players[0]!.newsContext
    const ctxStr = JSON.stringify(ctx)
    expect(ctxStr).not.toContain('sleeper')
    expect(ctxStr).not.toContain('platformLeagueId')
    expect(ctxStr).not.toContain('"provider"')
  })
})

// ──────────────────────────────────────────────────────────────────────────
// resolveNewsContext — never throws
// ──────────────────────────────────────────────────────────────────────────

describe('resolveNewsContext — never throws', () => {
  it('returns empty map with null error when playerNames is empty', async () => {
    const result = await resolveNewsContext('NFL', [], 14, {
      loadNewsRows: async () => { throw new Error('should not be called') },
    })
    expect(result.rowsByName.size).toBe(0)
    expect(result.error).toBeNull()
  })

  it('surfaces port error as result.error without throwing', async () => {
    const result = await resolveNewsContext('NFL', ['Patrick Mahomes'], 14, {
      loadNewsRows: async () => { throw new Error('db connection failed') },
    })
    expect(result.error).toBe('db connection failed')
    expect(result.rowsByName.size).toBe(0)
  })

  it('groups rows by lowercased playerName', async () => {
    const rows = [
      newsRow('Patrick Mahomes', { publishedAt: FRESH_AT }),
      newsRow('Travis Kelce', { publishedAt: FRESH_AT }),
      newsRow('Patrick Mahomes', { publishedAt: RECENT_AT }),
    ]
    const result = await resolveNewsContext('NFL', ['Patrick Mahomes', 'Travis Kelce'], 14, {
      loadNewsRows: async () => rows,
    })
    expect(result.rowsByName.get('patrick mahomes')).toHaveLength(2)
    expect(result.rowsByName.get('travis kelce')).toHaveLength(1)
    expect(result.error).toBeNull()
  })

  it('uses case-insensitive key (lowercase)', async () => {
    const row = newsRow('Patrick Mahomes')
    const result = await resolveNewsContext('NFL', ['Patrick Mahomes'], 14, {
      loadNewsRows: async () => [row],
    })
    expect(result.rowsByName.has('patrick mahomes')).toBe(true)
    expect(result.rowsByName.has('Patrick Mahomes')).toBe(false)
  })

  it('passes lookback window as since date to port', async () => {
    let capturedSince: Date | null = null
    await resolveNewsContext('NFL', ['Player'], 7, {
      loadNewsRows: async (_sport, _names, since) => { capturedSince = since; return [] },
    })
    const expectedSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    // Within 5 seconds tolerance
    expect(Math.abs(capturedSince!.getTime() - expectedSince.getTime())).toBeLessThan(5000)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// resolveNewsEnrichedCanonicalWorld — never throws
// ──────────────────────────────────────────────────────────────────────────

describe('resolveNewsEnrichedCanonicalWorld — never throws', () => {
  it('returns null for unknown leagueId without throwing', async () => {
    const result = await resolveNewsEnrichedCanonicalWorld('nonexistent-league-id-xyz')
    expect(result).toBeNull()
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Architecture guard
// ──────────────────────────────────────────────────────────────────────────

describe('architecture guard', () => {
  it('newsEnrichedWorld.ts contains no direct prisma import', () => {
    const src = readFileSync(resolvePath('lib/decision-os/world/newsEnrichedWorld.ts'), 'utf-8')
    expect(src).not.toContain("from '@/lib/prisma'")
    expect(src).not.toContain('from "../prisma"')
  })

  it('newsEnrichedWorld.ts contains no mutation keywords', () => {
    const src = readFileSync(resolvePath('lib/decision-os/world/newsEnrichedWorld.ts'), 'utf-8')
    expect(src).not.toContain('.create(')
    expect(src).not.toContain('.update(')
    expect(src).not.toContain('.upsert(')
    expect(src).not.toContain('.delete(')
  })

  it('newsEnrichedWorld.ts does not call live news APIs or AI summarizers', () => {
    const src = readFileSync(resolvePath('lib/decision-os/world/newsEnrichedWorld.ts'), 'utf-8')
    expect(src).not.toContain('fetchNewsContext')
    expect(src).not.toContain('runNewsImporter')
    expect(src).not.toContain('resolvePlayerInjuryNewsBatch')
    expect(src).not.toContain('openai')
    expect(src).not.toContain('anthropic')
  })

  it('newsEnrichedWorld.ts does not use fuzzy matching', () => {
    const src = readFileSync(resolvePath('lib/decision-os/world/newsEnrichedWorld.ts'), 'utf-8')
    expect(src).not.toContain('levenshtein')
    expect(src).not.toContain('similarity')
    expect(src).not.toContain('soundex')
    expect(src).not.toContain('fuzzy')
  })
})
