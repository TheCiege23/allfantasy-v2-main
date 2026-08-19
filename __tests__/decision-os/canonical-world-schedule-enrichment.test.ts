import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assembleCanonicalWorld } from '@/lib/decision-os/world/assemble'
import { projectEnrichedWorld } from '@/lib/decision-os/world/enrichedWorld'
import {
  projectScheduleContext,
  projectScheduleEnrichedWorld,
  resolveScheduleEnrichedCanonicalWorld,
  type ScheduleContextResult,
} from '@/lib/decision-os/world/scheduleBye'
import type {
  CanonicalWorld,
  NormalizedPlayerMetadata,
  PlayerMetadataResult,
  RawScheduleGameRow,
} from '@/lib/decision-os/world'
import { makeImportedProviderWorld, makeNativeAfWorld } from './canonicalWorldFakes'

const NOW = new Date('2026-06-30T12:00:00.000Z')

const assemble = (input: Parameters<typeof assembleCanonicalWorld>[0]): CanonicalWorld =>
  assembleCanonicalWorld(input, { now: NOW })

function idsOf(world: CanonicalWorld): string[] {
  return Array.from(new Set(world.rosters.flatMap((r) => r.playerIds)))
}

function meta(
  ids: string[],
  opts: {
    missing?: string[]
    teamById?: Record<string, string | null>
  } = {},
): PlayerMetadataResult {
  const missing = new Set(opts.missing ?? [])
  const byId = new Map<string, NormalizedPlayerMetadata>()
  const unresolvedIds: string[] = []
  for (const id of ids) {
    if (missing.has(id)) {
      byId.set(id, {
        playerId: id,
        name: null,
        position: null,
        team: null,
        injuryStatus: null,
        byeWeek: null,
        projectedPoints: null,
        projectionConfidence: null,
        source: null,
        resolved: false,
      })
      unresolvedIds.push(id)
      continue
    }
    byId.set(id, {
      playerId: id,
      name: `Name ${id}`,
      position: 'RB',
      team: opts.teamById?.[id] ?? 'BUF',
      injuryStatus: 'Q',
      byeWeek: null,
      projectedPoints: null,
      projectionConfidence: null,
      source: 'sports_player_cache',
      resolved: true,
    })
  }
  return {
    byId,
    complete: ids.length > 0 && unresolvedIds.length === 0,
    unresolvedIds,
    warnings: unresolvedIds.length > 0 ? ['player_metadata_missing'] : [],
  }
}

function scheduleRow(overrides: Partial<RawScheduleGameRow>): RawScheduleGameRow {
  return {
    sport: 'NFL',
    season: 2025,
    week: 1,
    homeTeam: 'BUF',
    awayTeam: 'MIA',
    kickoffTime: new Date('2025-09-01T20:00:00.000Z'),
    status: 'scheduled',
    source: 'rolling_insights',
    fetchedAt: new Date('2026-06-29T00:00:00.000Z'),
    expiresAt: new Date('2026-07-07T00:00:00.000Z'),
    updatedAt: new Date('2026-06-29T00:00:00.000Z'),
    sourceModel: 'FantasyScheduleGame',
    ...overrides,
  }
}

describe('F2.2: pure projectScheduleContext derives deterministic team schedule facts honestly', () => {
  it('resolves current-week opponent/home-away/status and derives a unique bye week', () => {
    const result = projectScheduleContext(
      [
        scheduleRow({ week: 1, homeTeam: 'BUF', awayTeam: 'MIA' }),
        scheduleRow({ week: 2, homeTeam: 'BUF', awayTeam: 'KC', status: 'in_progress' }),
        scheduleRow({ week: 3, homeTeam: 'DAL', awayTeam: 'PHI' }),
        scheduleRow({ week: 4, homeTeam: 'NYJ', awayTeam: 'BUF' }),
      ],
      { teams: ['BUF'], currentWeek: 2, now: NOW },
    )

    const ctx = result.byTeam.get('BUF')!
    expect(ctx.hasGame).toBe(true)
    expect(ctx.isByeWeek).toBe(false)
    expect(ctx.opponent).toBe('KC')
    expect(ctx.homeAway).toBe('home')
    expect(ctx.gameStatus).toBe('in_progress')
    expect(ctx.gameWeek).toBe(2)
    expect(ctx.byeWeek).toBe(3)
    expect(ctx.provenance).toEqual({
      sourceModel: 'FantasyScheduleGame',
      source: 'rolling_insights',
    })
    expect(ctx.freshness.isStale).toBe(false)
    expect(result.completeness).toBe(100)
  })

  it('infers a current-week bye only when the week exists in the season cache', () => {
    const result = projectScheduleContext(
      [
        scheduleRow({ week: 1, homeTeam: 'BUF', awayTeam: 'MIA' }),
        scheduleRow({ week: 2, homeTeam: 'KC', awayTeam: 'BUF' }),
        scheduleRow({ week: 3, homeTeam: 'DAL', awayTeam: 'PHI' }),
        scheduleRow({ week: 4, homeTeam: 'NYJ', awayTeam: 'BUF' }),
      ],
      { teams: ['BUF'], currentWeek: 3, now: NOW },
    )

    const ctx = result.byTeam.get('BUF')!
    expect(ctx.hasGame).toBe(false)
    expect(ctx.isByeWeek).toBe(true)
    expect(ctx.gameWeek).toBeNull()
    expect(ctx.opponent).toBeNull()
    expect(ctx.warnings).toContain('current_week_bye_inferred')
    expect(ctx.byeWeek).toBe(3)
  })

  it('degrades honestly when multiple bye gaps exist or schedule rows are missing', () => {
    const ambiguous = projectScheduleContext(
      [
        scheduleRow({ week: 1, homeTeam: 'BUF', awayTeam: 'MIA' }),
        scheduleRow({ week: 2, homeTeam: 'DAL', awayTeam: 'PHI' }),
        scheduleRow({ week: 3, homeTeam: 'NYJ', awayTeam: 'NE' }),
        scheduleRow({ week: 4, homeTeam: 'LAR', awayTeam: 'SEA' }),
        scheduleRow({ week: 5, homeTeam: 'BUF', awayTeam: 'NYJ' }),
      ],
      { teams: ['BUF', 'CHI'], currentWeek: 3, now: NOW },
    )

    expect(ambiguous.byTeam.get('BUF')!.byeWeek).toBeNull()
    expect(ambiguous.byTeam.get('BUF')!.warnings).toContain('bye_week_ambiguous')
    expect(ambiguous.byTeam.get('CHI')!.warnings).toContain('schedule_unavailable')
    expect(ambiguous.coverageGaps).toContain('schedule_cache_missing_for_requested_team')
  })

  it('falls back to GameSchedule provenance/freshness when fantasy cache is unavailable', () => {
    const result = projectScheduleContext(
      [
        scheduleRow({
          week: 2,
          homeTeam: 'BUF',
          awayTeam: 'MIA',
          sourceModel: 'GameSchedule',
          source: null,
          fetchedAt: null,
          expiresAt: null,
          updatedAt: new Date('2026-06-01T00:00:00.000Z'),
        }),
      ],
      { teams: ['BUF'], currentWeek: 2, now: NOW },
    )

    const ctx = result.byTeam.get('BUF')!
    expect(ctx.provenance.sourceModel).toBe('GameSchedule')
    expect(ctx.provenance.source).toBeNull()
    expect(ctx.freshness.updatedAt).toBe('2026-06-01T00:00:00.000Z')
    expect(ctx.warnings).toContain('schedule_stale')
  })
})

describe('F2.2: schedule/bye view layers additively on top of F2.1 enriched world', () => {
  it('adds scheduleContext to players without mutating the metadata-enriched base', () => {
    const world = assemble(makeImportedProviderWorld())
    const enriched = projectEnrichedWorld(world, meta(idsOf(world)))
    const before = JSON.stringify(enriched)
    const schedule: ScheduleContextResult = projectScheduleContext(
      [
        scheduleRow({ week: 1, homeTeam: 'BUF', awayTeam: 'MIA' }),
        scheduleRow({ week: 2, homeTeam: 'BUF', awayTeam: 'KC' }),
        scheduleRow({ week: 3, homeTeam: 'DAL', awayTeam: 'PHI' }),
        scheduleRow({ week: 4, homeTeam: 'NYJ', awayTeam: 'BUF' }),
      ],
      { teams: ['BUF'], currentWeek: enriched.league.currentWeek, now: NOW },
    )

    const out = projectScheduleEnrichedWorld(enriched, schedule)
    expect(JSON.stringify(enriched)).toBe(before)
    const player = out.rosters.flatMap((r) => r.players)[0]!
    expect(player.scheduleContext.opponent).toBe('KC')
    expect(out.schedule.completeness).toBeGreaterThan(0)
    expect(out.rosters[0]!.scheduleCompleteness).toBeGreaterThan(0)
  })

  it('keeps imported/native output shape identical and hides provider details from player facts', () => {
    const importedWorld = projectEnrichedWorld(assemble(makeImportedProviderWorld()), meta(idsOf(assemble(makeImportedProviderWorld()))))
    const nativeWorld = projectEnrichedWorld(assemble(makeNativeAfWorld()), meta(idsOf(assemble(makeNativeAfWorld()))))
    const schedule = projectScheduleContext(
      [
        scheduleRow({ week: 1, homeTeam: 'BUF', awayTeam: 'MIA' }),
        scheduleRow({ week: 2, homeTeam: 'BUF', awayTeam: 'KC' }),
        scheduleRow({ week: 3, homeTeam: 'DAL', awayTeam: 'PHI' }),
        scheduleRow({ week: 4, homeTeam: 'NYJ', awayTeam: 'BUF' }),
      ],
      { teams: ['BUF'], currentWeek: 2, now: NOW },
    )

    const imported = projectScheduleEnrichedWorld(importedWorld, schedule)
    const native = projectScheduleEnrichedWorld(nativeWorld, schedule)
    const importedKeys = Object.keys(imported.rosters[0]!.players[0]!).sort()
    const nativeKeys = Object.keys(native.rosters[0]!.players[0]!).sort()
    expect(importedKeys).toEqual(nativeKeys)
    expect(JSON.stringify(imported.rosters).toLowerCase()).not.toContain('sleeper')
  })

  it('degrades honestly when metadata teams are missing, rather than guessing schedule facts', () => {
    const world = assemble(makeImportedProviderWorld())
    const ids = idsOf(world)
    const enriched = projectEnrichedWorld(world, meta(ids, { missing: [ids[0]!] }))
    const schedule = projectScheduleContext(
      [scheduleRow({ week: 2, homeTeam: 'BUF', awayTeam: 'KC' })],
      { teams: ['BUF'], currentWeek: 2, now: NOW },
    )

    const out = projectScheduleEnrichedWorld(enriched, schedule)
    const missingPlayer = out.rosters.flatMap((r) => r.players).find((p) => p.playerId === ids[0])!
    expect(missingPlayer.team).toBeNull()
    expect(missingPlayer.scheduleContext.team).toBeNull()
    expect(missingPlayer.scheduleContext.warnings).toContain('team_unavailable')
    expect(missingPlayer.scheduleContext.completeness).toBe(0)
  })
})

describe('F2.2: resolveScheduleEnrichedCanonicalWorld is read-only + never throws', () => {
  it('resolves via injected read-only deps', async () => {
    const world = assemble(makeImportedProviderWorld())
    const enriched = projectEnrichedWorld(world, meta(idsOf(world)))
    const out = await resolveScheduleEnrichedCanonicalWorld('lg', {
      resolveEnrichedWorld: async () => enriched,
      resolveSchedule: async () =>
        projectScheduleContext(
          [
            scheduleRow({ week: 1, homeTeam: 'BUF', awayTeam: 'MIA' }),
            scheduleRow({ week: 2, homeTeam: 'BUF', awayTeam: 'KC' }),
            scheduleRow({ week: 3, homeTeam: 'DAL', awayTeam: 'PHI' }),
            scheduleRow({ week: 4, homeTeam: 'NYJ', awayTeam: 'BUF' }),
          ],
          { teams: ['BUF'], currentWeek: enriched.league.currentWeek, now: NOW },
        ),
    })

    expect(out).not.toBeNull()
    expect(out!.rosters[0]!.players[0]!.scheduleContext.opponent).toBe('KC')
  })

  it('world miss => null', async () => {
    const out = await resolveScheduleEnrichedCanonicalWorld('lg', {
      resolveEnrichedWorld: async () => null,
      resolveSchedule: async () =>
        ({
          byTeam: new Map(),
          requestedTeams: 0,
          resolvedTeams: 0,
          completeness: 0,
          warnings: [],
          coverageGaps: [],
        }) satisfies ScheduleContextResult,
    })
    expect(out).toBeNull()
  })

  it('schedule resolver miss => unresolved schedule contexts, never throws', async () => {
    const world = assemble(makeImportedProviderWorld())
    const enriched = projectEnrichedWorld(world, meta(idsOf(world)))
    const out = await resolveScheduleEnrichedCanonicalWorld('lg', {
      resolveEnrichedWorld: async () => enriched,
      resolveSchedule: async () => {
        throw new Error('cache down')
      },
    })

    expect(out).not.toBeNull()
    expect(out!.schedule.warnings).toContain('schedule_source_unavailable')
    expect(out!.rosters.every((r) => r.players.every((p) => p.scheduleContext.hasGame === false))).toBe(true)
  })
})

describe('F2.2: architecture — schedule enrichment stays read-only', () => {
  it('scheduleBye.ts imports no prisma and performs no writes', () => {
    const raw = readFileSync(resolvePath(process.cwd(), 'lib/decision-os/world/scheduleBye.ts'), 'utf8')
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(src.includes('@/lib/prisma')).toBe(false)
    expect(/\bprisma\./.test(src)).toBe(false)
    expect(/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/.test(src)).toBe(false)
  })
})
