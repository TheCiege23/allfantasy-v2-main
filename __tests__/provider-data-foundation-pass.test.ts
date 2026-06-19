import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  aggregateNcaafPlayerSeasonStats,
  buildNcaafFallbackProjection,
  normalizeCfbdGame,
  normalizeCfbdPlayer,
  normalizeCfbdTeam,
  syncNcaafCfbdFoundation,
} from '@/lib/provider-data-foundation/ncaafCfbdFoundation'
import {
  decideProviderImageWrite,
  isUsableProviderImageUrl,
  normalizeTeamAssetInput,
  providerImageQualityScore,
} from '@/lib/provider-data-foundation/providerMediaAssets'
import {
  assertProviderWriteAllowed,
  inspectProviderWriteSafety,
} from '@/lib/provider-data-foundation/writeSafety'

function repoFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('provider data foundation pass', () => {
  it('normalizes CFBD teams, games, rosters, and aggregated player stats into AllFantasy shapes', () => {
    expect(
      normalizeCfbdTeam({
        id: 12,
        school: 'Example State',
        abbreviation: 'EXS',
        conference: 'Test',
        logos: ['https://cdn.example.com/exs.png'],
      }),
    ).toEqual({
      sport: 'NCAAF',
      externalId: '12',
      name: 'Example State',
      shortName: 'EXS',
      conference: 'Test',
      logoUrl: 'https://cdn.example.com/exs.png',
      source: 'cfbd',
    })

    expect(
      normalizeCfbdGame(
        {
          id: 99,
          season: 2026,
          week: 1,
          homeTeam: 'Example State',
          awayTeam: 'Coastal Test',
          startDate: '2026-09-05T16:00:00.000Z',
          completed: false,
        },
        2026,
      ),
    ).toMatchObject({
      sport: 'NCAAF',
      externalId: '99',
      season: 2026,
      weekOrRound: 1,
      homeTeam: 'ES',
      awayTeam: 'CT',
      status: 'scheduled',
    })

    expect(normalizeCfbdGame({ id: 100, homeTeam: 'No Week', awayTeam: 'Skip' }, 2026)).toBeNull()

    expect(normalizeCfbdPlayer({ name: 'College Runner', position: 'RB', jersey: '22' }, 'Example State')).toMatchObject({
      sport: 'NCAAF',
      externalId: 'ES:College Runner',
      name: 'College Runner',
      position: 'RB',
      team: 'ES',
      jerseyNumber: 22,
    })

    const stats = aggregateNcaafPlayerSeasonStats(
      [
        { playerId: 'p1', player: 'College Runner', team: 'Example State', category: 'rushing', statType: 'yards', stat: 1000 },
        { playerId: 'p1', player: 'College Runner', team: 'Example State', category: 'receiving', statType: 'receptions', stat: 28 },
      ],
      2026,
    )

    expect(stats).toHaveLength(1)
    expect(stats[0]).toMatchObject({
      sport: 'NCAAF',
      playerId: 'p1',
      playerName: 'College Runner',
      team: 'ES',
      source: 'cfbd',
    })
    expect(stats[0]?.stats).toMatchObject({
      rushing_yards: 1000,
      receiving_receptions: 28,
    })
  })

  it('labels NCAAF fantasy projections as AllFantasy fallback with reduced confidence', () => {
    const projection = buildNcaafFallbackProjection({
      playerId: 'p1',
      playerName: 'College Runner',
      position: 'RB',
      season: 2026,
      week: 1,
      fantasyPointsPerGame: 14.5,
      gamesPlayed: 3,
      hasSchedule: true,
    })

    expect(projection.projectionSource).toBe('allfantasy_cfbd_fallback')
    expect(projection.providerBacked).toBe(false)
    expect(projection.fallbackGenerated).toBe(true)
    expect(projection.confidenceLevel).toBe('low')
    expect(projection.reasonCodes).toContain('cfbd_projection_unavailable')
    expect(projection.adjustmentReason).toMatch(/CFBD does not provide fantasy projections/)
  })

  it('syncs CFBD NCAAF data in dry-run without DB writes and reports unavailable provider fields', async () => {
    const provider = {
      fetch: vi.fn(async ({ dataType, query }: { dataType: string; query?: Record<string, string> }) => {
        if (dataType === 'teams') return [{ id: 1, school: 'Example State', abbreviation: 'EXS', logos: ['https://cdn.example.com/exs.png'] }]
        if (dataType === 'roster' && query?.team === 'Example State') return [{ id: 'p1', name: 'College Runner', position: 'RB', team: 'Example State' }]
        if (dataType === 'schedule') return [{ id: 'g1', season: 2026, week: 1, homeTeam: 'Example State', awayTeam: 'Coastal Test' }]
        if (dataType === 'player_stats') return [{ playerId: 'p1', player: 'College Runner', team: 'Example State', category: 'rushing', statType: 'yards', stat: 1000 }]
        if (dataType === 'team_stats') return [{ team: 'Example State', statName: 'totalYards', statValue: 5000 }]
        if (dataType === 'rankings') return [{ week: 1, polls: [] }]
        if (dataType === 'standings') return [{ team: 'Example State', total: { wins: 1, losses: 0 } }]
        return []
      }),
    }
    const writeSpies = {
      sportsTeam: { upsert: vi.fn() },
      teamAsset: { upsert: vi.fn() },
      sportsPlayer: { upsert: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      sportsGame: { upsert: vi.fn() },
      gameSchedule: { upsert: vi.fn(), count: vi.fn().mockResolvedValue(0) },
      playerSeasonStats: { upsert: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      teamSeasonStats: { upsert: vi.fn() },
      aFProjectionSnapshot: { upsert: vi.fn() },
      playerIdentityMap: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    }

    const report = await syncNcaafCfbdFoundation({
      season: 2026,
      week: 1,
      write: false,
      provider: provider as never,
      prismaClient: writeSpies as never,
    })

    expect(report.mode).toBe('dry-run')
    expect(report.datasets.teams.normalizedRows).toBe(1)
    expect(report.datasets.players.normalizedRows).toBe(1)
    expect(report.datasets.schedule.normalizedRows).toBe(1)
    expect(report.datasets.playerSeasonStats.normalizedRows).toBe(1)
    expect(report.datasets.teamSeasonStats.normalizedRows).toBe(1)
    expect(report.datasets.injuries.availability).toBe('unavailable')
    expect(report.datasets.providerProjections.availability).toBe('unavailable')
    expect(report.projections.providerBacked).toBe(0)
    expect(report.projections.weeklyGenerated).toBe(1)
    expect(report.projections.rosGenerated).toBe(1)
    expect(writeSpies.sportsTeam.upsert).not.toHaveBeenCalled()
    expect(writeSpies.aFProjectionSnapshot.upsert).not.toHaveBeenCalled()
  })

  it('scores provider media, rejects fake images, and refuses to overwrite better assets with worse ones', () => {
    expect(isUsableProviderImageUrl('team_logo', 'https://cdn.example.com/logo.png')).toBe(true)
    expect(isUsableProviderImageUrl('team_logo', 'https://cdn.example.com/placeholder.png')).toBe(false)
    expect(isUsableProviderImageUrl('player_headshot', 'https://a.espncdn.com/i/teamLogos/nfl/500/atl.png')).toBe(false)
    expect(isUsableProviderImageUrl('player_headshot', 'https://www.thesportsdb.com/images/media/player/cutout/example.png')).toBe(true)

    expect(
      providerImageQualityScore({
        kind: 'team_logo',
        url: 'https://cdn.example.com/logo.png',
        source: 'thesportsdb',
        variant: 'badge',
      }),
    ).toBeGreaterThan(
      providerImageQualityScore({
        kind: 'team_logo',
        url: 'https://cdn.example.com/logo.jpg',
        source: 'sports_team',
      }),
    )

    expect(
      decideProviderImageWrite({
        kind: 'team_logo',
        existingUrl: 'https://cdn.example.com/current.png',
        existingSource: 'thesportsdb',
        candidate: { kind: 'team_logo', url: 'https://cdn.example.com/lower.png', source: 'sports_team' },
      }),
    ).toMatchObject({ shouldWrite: false, reason: 'existing_better_or_equal' })

    expect(
      normalizeTeamAssetInput({
        sport: 'ncaaf',
        teamCode: null,
        teamName: 'Example State',
        logoUrl: 'https://cdn.example.com/exs.png',
        logoSource: 'cfbd',
      }),
    ).toMatchObject({
      sport: 'NCAAF',
      teamCode: 'ES',
      logoUrl: 'https://cdn.example.com/exs.png',
      logoSource: 'cfbd',
    })
  })

  it('guards provider writes with explicit safe env markers and refuses ambiguous local env files', () => {
    expect(
      inspectProviderWriteSafety({
        write: false,
        targetSport: 'NFL',
        providerMode: 'test',
        env: {},
        execArgv: [],
      }),
    ).toMatchObject({ allowed: true, mode: 'dry-run' })

    expect(
      inspectProviderWriteSafety({
        write: true,
        targetSport: 'NFL',
        providerMode: 'test',
        env: { DATABASE_URL: 'postgres://user:secret@example.neon.tech/neondb' },
        execArgv: ['--env-file=.env.local'],
      }).errors,
    ).toEqual(expect.arrayContaining([
      expect.stringMatching(/APP_ENV/),
      expect.stringMatching(/DATABASE_BRANCH/),
      expect.stringMatching(/refuse \.env\.local/),
    ]))

    const safe = assertProviderWriteAllowed({
      write: true,
      targetSport: 'NCAAF',
      providerMode: 'cfbd_ncaaf_foundation',
      env: {
        APP_ENV: 'redraft-v1-data-test',
        DATABASE_BRANCH: 'redraft-v1-data-test',
        DATABASE_URL: 'postgres://user:secret@ep-test-branch.neon.tech/neondb',
      },
      execArgv: ['--env-file=.env.redraft-test'],
    })

    expect(safe).toMatchObject({
      allowed: true,
      databaseHost: 'ep-test-branch.neon.tech',
      databaseName: 'neondb',
    })
  })

  it('keeps provider sync scripts read-only by default and documents safe write commands', () => {
    const ncaafSync = repoFile('scripts/sync-ncaaf-cfbd-foundation.ts')
    const mediaSync = repoFile('scripts/sync-provider-media-assets.ts')
    const nflSync = repoFile('scripts/sync-rolling-insights-nfl-foundation.ts')
    const apiSports = repoFile('lib/api-sports.ts')

    expect(ncaafSync).toContain('write: false')
    expect(ncaafSync).toContain('assertProviderWriteAllowed')
    expect(ncaafSync).toContain('--env-file=.env.redraft-test')
    expect(mediaSync).toContain('write: false')
    expect(mediaSync).toContain('assertProviderWriteAllowed')
    expect(mediaSync).toContain('--env-file=.env.redraft-test')
    expect(nflSync).toContain('assertProviderWriteAllowed')
    expect(apiSports).toContain('process.env.SPORTS_API_KEY')
  })
})
