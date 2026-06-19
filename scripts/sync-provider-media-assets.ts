/**
 * Sync/audit provider-backed team logos and player headshots.
 *
 * Default is read-only:
 *   node --env-file=.env.redraft-test --require ./scripts/_audit-preload.cjs --import tsx scripts/sync-provider-media-assets.ts -- --sport=NFL --json
 *
 * Writes require --write plus safe APP_ENV/DATABASE_BRANCH markers:
 *   node --env-file=.env.redraft-test --require ./scripts/_audit-preload.cjs --import tsx scripts/sync-provider-media-assets.ts -- --sport=NFL --write --json
 */

import { prisma } from '../lib/prisma'
import { prisma as aliasPrisma } from '@/lib/prisma'
import { cfbdProvider } from '../lib/workers/providers/cfbd'
import { apiSportsProvider } from '../lib/workers/providers/api-sports'
import { theSportsDbProvider } from '../lib/workers/providers/thesportsdb'
import {
  createBatchPlayerHeadshotResolver,
  isValidHeadshotUrl,
} from '../lib/player-assets/resolvePlayerHeadshot'
import {
  decideProviderImageWrite,
  getProviderMediaCoverage,
  isUsableProviderImageUrl,
  normalizeTeamAssetInput,
  updateSportsPlayerHeadshotIfBetter,
  upsertTeamAssetIfBetter,
  type NormalizedTeamAssetInput,
} from '../lib/provider-data-foundation/providerMediaAssets'
import {
  assertProviderWriteAllowed,
  inspectProviderWriteSafety,
} from '../lib/provider-data-foundation/writeSafety'

type Args = {
  json: boolean
  sport: 'NFL' | 'NCAAF' | 'ALL'
  write: boolean
  dryRun: boolean
  limit: number
  teamsOnly: boolean
  playersOnly: boolean
  force: boolean
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    json: false,
    sport: 'ALL',
    write: false,
    dryRun: false,
    limit: 250,
    teamsOnly: false,
    playersOnly: false,
    force: false,
  }
  for (const raw of argv) {
    if (raw === '--json') out.json = true
    else if (raw === '--write') out.write = true
    else if (raw === '--dry-run') out.dryRun = true
    else if (raw === '--teams-only') out.teamsOnly = true
    else if (raw === '--players-only') out.playersOnly = true
    else if (raw === '--force') out.force = true
    else if (raw.startsWith('--sport=')) {
      const sport = raw.slice('--sport='.length).trim().toUpperCase()
      if (sport === 'NFL' || sport === 'NCAAF' || sport === 'ALL') out.sport = sport
    } else if (raw.startsWith('--limit=')) {
      const parsed = Number(raw.slice('--limit='.length))
      if (Number.isFinite(parsed) && parsed > 0) out.limit = Math.min(Math.trunc(parsed), 1000)
    }
  }
  return out
}

function sportsFor(args: Args): Array<'NFL' | 'NCAAF'> {
  return args.sport === 'ALL' ? ['NFL', 'NCAAF'] : [args.sport]
}

function asRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value.filter((row) => row && typeof row === 'object') as Array<Record<string, unknown>>) : []
}

function normalizeProviderTeam(row: Record<string, unknown>, sport: string): NormalizedTeamAssetInput | null {
  const teamName = String(row.name ?? row.teamName ?? row.school ?? '').trim()
  if (!teamName) return null
  const logoUrl = String(row.logo ?? row.logoUrl ?? '').trim() || null
  const source = String(row.source ?? row.logoSource ?? 'unknown').trim()
  const teamCode = String(row.shortName ?? row.teamCode ?? row.abbreviation ?? '').trim() || null
  if (!isUsableProviderImageUrl('team_logo', logoUrl)) return null
  return normalizeTeamAssetInput({
    sport,
    teamCode,
    teamName,
    logoUrl,
    logoUrlSm: String(row.logoUrlSm ?? row.logo ?? row.logoUrl ?? '').trim() || logoUrl,
    logoUrlLg: String(row.logoUrlLg ?? row.logo ?? row.logoUrl ?? '').trim() || logoUrl,
    logoSource: source,
  })
}

async function fetchTeamLogoCandidates(sport: 'NFL' | 'NCAAF', season: number): Promise<NormalizedTeamAssetInput[]> {
  const providerRows = await Promise.all([
    theSportsDbProvider.fetch({ sport, dataType: 'teams', query: { season: String(season) } }).catch(() => []),
    apiSportsProvider.fetch({ sport, dataType: 'teams', query: { season: String(season) } }).catch(() => []),
    sport === 'NCAAF'
      ? cfbdProvider.fetch({ sport, dataType: 'teams', query: { season: String(season) } }).catch(() => [])
      : Promise.resolve([]),
  ])
  return providerRows
    .flatMap(asRows)
    .map((row) => normalizeProviderTeam(row, sport))
    .filter((row): row is NormalizedTeamAssetInput => Boolean(row))
}

async function syncTeamLogos(args: {
  sport: 'NFL' | 'NCAAF'
  season: number
  write: boolean
  force: boolean
}): Promise<{
  providerRows: number
  normalizedRows: number
  written: number
  skippedExistingBetter: number
  skippedInvalid: number
}> {
  const candidates = await fetchTeamLogoCandidates(args.sport, args.season)
  let written = 0
  let skippedExistingBetter = 0
  let skippedInvalid = 0
  for (const candidate of candidates) {
    if (!candidate.logoUrl) {
      skippedInvalid += 1
      continue
    }
    if (args.write) {
      const result = await upsertTeamAssetIfBetter({ input: candidate, force: args.force, db: prisma })
      if (result.written) written += 1
      else skippedExistingBetter += 1
    } else {
      const existing = await prisma.teamAsset
        .findUnique({
          where: { uniq_team_assets_sport_team_code: { sport: args.sport, teamCode: candidate.teamCode ?? '' } },
          select: { logoUrl: true, logoSource: true },
        })
        .catch(() => null)
      const decision = decideProviderImageWrite({
        kind: 'team_logo',
        existingUrl: existing?.logoUrl ?? null,
        existingSource: existing?.logoSource ?? null,
        candidate: { kind: 'team_logo', url: candidate.logoUrl, source: candidate.logoSource, variant: 'badge' },
        force: args.force,
      })
      if (decision.shouldWrite) written += 1
      else skippedExistingBetter += 1
    }
  }
  return {
    providerRows: candidates.length,
    normalizedRows: candidates.length - skippedInvalid,
    written,
    skippedExistingBetter,
    skippedInvalid,
  }
}

async function syncPlayerHeadshots(args: {
  sport: 'NFL' | 'NCAAF'
  write: boolean
  force: boolean
  limit: number
}): Promise<{
  checked: number
  resolved: number
  written: number
  wouldWrite: number
  skippedExistingBetter: number
  noMatch: number
  providerErrors: number
  bySource: Record<string, number>
}> {
  const where = args.force
    ? { sport: args.sport }
    : {
        sport: args.sport,
        OR: [
          { imageUrl: null },
          { imageUrl: { startsWith: 'data:' } },
          { imageUrl: { contains: '/teamLogos/', mode: 'insensitive' as const } },
          { imageUrl: { not: { startsWith: 'http', mode: 'insensitive' as const } } },
        ],
      }
  const rows = await prisma.sportsPlayer.findMany({
    where,
    select: { id: true, name: true, position: true, team: true, imageUrl: true, source: true },
    orderBy: [{ imageUrl: { sort: 'asc', nulls: 'first' } }, { updatedAt: 'asc' }],
    take: args.limit,
  })
  const resolver = await createBatchPlayerHeadshotResolver({ sport: args.sport })
  const out = {
    checked: 0,
    resolved: 0,
    written: 0,
    wouldWrite: 0,
    skippedExistingBetter: 0,
    noMatch: 0,
    providerErrors: 0,
    bySource: {} as Record<string, number>,
  }
  for (const row of rows) {
    out.checked += 1
    if (!args.force && isValidHeadshotUrl(row.imageUrl)) {
      out.skippedExistingBetter += 1
      continue
    }
    try {
      const resolved = await resolver.resolve({
        name: row.name,
        sport: args.sport,
        team: row.team,
        position: row.position,
      })
      out.bySource[resolved.source] = (out.bySource[resolved.source] ?? 0) + 1
      if (!resolved.imageUrl || !isValidHeadshotUrl(resolved.imageUrl)) {
        out.noMatch += 1
        continue
      }
      out.resolved += 1
      const decision = decideProviderImageWrite({
        kind: 'player_headshot',
        existingUrl: row.imageUrl,
        existingSource: row.source,
        candidate: { kind: 'player_headshot', url: resolved.imageUrl, source: resolved.source, variant: 'headshot' },
        force: args.force,
      })
      if (!decision.shouldWrite) {
        out.skippedExistingBetter += 1
        continue
      }
      if (args.write) {
        const result = await updateSportsPlayerHeadshotIfBetter({
          db: prisma,
          input: {
            sport: args.sport,
            playerId: row.id,
            playerName: row.name,
            team: row.team,
            position: row.position,
            imageUrl: resolved.imageUrl,
            source: resolved.source,
          },
          force: args.force,
        })
        if (result.written) out.written += 1
      } else {
        out.wouldWrite += 1
      }
    } catch {
      out.providerErrors += 1
    }
  }
  return out
}

function writeCommand(args: Args): string {
  return [
    'node --env-file=.env.redraft-test --require ./scripts/_audit-preload.cjs --import tsx',
    'scripts/sync-provider-media-assets.ts',
    '--',
    `--sport=${args.sport}`,
    `--limit=${args.limit}`,
    '--write',
    '--json',
  ].join(' ')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const write = args.write && !args.dryRun
  const writeSafety = write
    ? assertProviderWriteAllowed({
        write,
        targetSport: args.sport,
        providerMode: 'provider_media_assets',
      })
    : inspectProviderWriteSafety({
        write,
        targetSport: args.sport,
        providerMode: 'provider_media_assets',
      })
  const season = new Date().getUTCFullYear()
  const beforeCoverage: Record<string, Awaited<ReturnType<typeof getProviderMediaCoverage>>> = {}
  const afterCoverage: Record<string, Awaited<ReturnType<typeof getProviderMediaCoverage>>> = {}
  const teamLogos: Record<string, Awaited<ReturnType<typeof syncTeamLogos>>> = {}
  const playerHeadshots: Record<string, Awaited<ReturnType<typeof syncPlayerHeadshots>>> = {}

  for (const sport of sportsFor(args)) {
    beforeCoverage[sport] = await getProviderMediaCoverage({ sport, db: prisma })
    if (!args.playersOnly) {
      teamLogos[sport] = await syncTeamLogos({ sport, season, write, force: args.force })
    }
    if (!args.teamsOnly) {
      playerHeadshots[sport] = await syncPlayerHeadshots({
        sport,
        write,
        force: args.force,
        limit: args.limit,
      })
    }
    afterCoverage[sport] = await getProviderMediaCoverage({ sport, db: prisma })
  }

  const result = {
    ok: true,
    generatedAt: new Date().toISOString(),
    mode: write ? 'write' : 'dry-run',
    writeModeWasRun: write,
    writeSafety,
    beforeCoverage,
    teamLogos,
    playerHeadshots,
    afterCoverage,
    writeCommand: writeCommand(args),
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  console.log(`Provider media asset sync ${result.mode} for sport=${args.sport}`)
  console.log(
    `Write safety: allowed=${writeSafety.allowed} appEnv=${writeSafety.appEnv ?? 'unset'} databaseBranch=${writeSafety.databaseBranch ?? 'unset'} host=${writeSafety.databaseHost ?? 'unset'} database=${writeSafety.databaseName ?? 'unset'}`,
  )
  for (const sport of sportsFor(args)) {
    console.log(`${sport} team logos: ${JSON.stringify(teamLogos[sport] ?? {})}`)
    console.log(`${sport} player headshots: ${JSON.stringify(playerHeadshots[sport] ?? {})}`)
    console.log(`${sport} coverage after: ${JSON.stringify(afterCoverage[sport])}`)
  }
  console.log(`Write mode command=${writeCommand(args)}`)
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
    if (aliasPrisma !== prisma) await aliasPrisma.$disconnect().catch(() => undefined)
    process.exit(process.exitCode ?? 0)
  })
