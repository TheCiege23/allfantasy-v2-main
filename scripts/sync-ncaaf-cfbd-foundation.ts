/**
 * Sync/audit CFBD NCAAF source data into normalized AllFantasy surfaces.
 *
 * Default is read-only:
 *   node --env-file=.env.redraft-test --require ./scripts/_audit-preload.cjs --import tsx scripts/sync-ncaaf-cfbd-foundation.ts -- --season=2026 --week=1 --json
 *
 * Writes require --write plus safe APP_ENV/DATABASE_BRANCH markers:
 *   node --env-file=.env.redraft-test --require ./scripts/_audit-preload.cjs --import tsx scripts/sync-ncaaf-cfbd-foundation.ts -- --season=2026 --week=1 --write --json
 */

import { prisma } from '../lib/prisma'
import { prisma as aliasPrisma } from '@/lib/prisma'
import { syncNcaafCfbdFoundation } from '../lib/provider-data-foundation/ncaafCfbdFoundation'
import {
  assertProviderWriteAllowed,
  inspectProviderWriteSafety,
} from '../lib/provider-data-foundation/writeSafety'

type Args = {
  json: boolean
  season: number
  week: number | null
  write: boolean
  dryRun: boolean
  limit: number
}

function parseArgs(argv: string[]): Args {
  const now = new Date()
  const out: Args = {
    json: false,
    season: now.getUTCFullYear(),
    week: null,
    write: false,
    dryRun: false,
    limit: 5000,
  }
  for (const raw of argv) {
    if (raw === '--json') out.json = true
    else if (raw === '--write') out.write = true
    else if (raw === '--dry-run') out.dryRun = true
    else if (raw.startsWith('--season=')) {
      const parsed = Number(raw.slice('--season='.length))
      if (Number.isFinite(parsed) && parsed > 2000) out.season = Math.trunc(parsed)
    } else if (raw.startsWith('--week=')) {
      const parsed = Number(raw.slice('--week='.length))
      if (Number.isFinite(parsed) && parsed > 0) out.week = Math.trunc(parsed)
    } else if (raw.startsWith('--limit=')) {
      const parsed = Number(raw.slice('--limit='.length))
      if (Number.isFinite(parsed) && parsed > 0) out.limit = Math.min(Math.trunc(parsed), 10000)
    }
  }
  return out
}

function writeCommand(args: Args): string {
  return [
    'node --env-file=.env.redraft-test --require ./scripts/_audit-preload.cjs --import tsx',
    'scripts/sync-ncaaf-cfbd-foundation.ts',
    '--',
    `--season=${args.season}`,
    args.week ? `--week=${args.week}` : '--week=1',
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
        targetSport: 'NCAAF',
        providerMode: 'cfbd_ncaaf_foundation',
      })
    : inspectProviderWriteSafety({
        write,
        targetSport: 'NCAAF',
        providerMode: 'cfbd_ncaaf_foundation',
      })

  const report = await syncNcaafCfbdFoundation({
    season: args.season,
    week: args.week,
    write,
    limit: args.limit,
    prismaClient: prisma,
  })
  const result = {
    ...report,
    writeSafety,
    writeCommand: writeCommand(args),
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  console.log(`NCAAF CFBD foundation ${report.mode} for season ${args.season}${args.week ? ` week ${args.week}` : ''}`)
  console.log(
    `Write safety: allowed=${writeSafety.allowed} appEnv=${writeSafety.appEnv ?? 'unset'} databaseBranch=${writeSafety.databaseBranch ?? 'unset'} host=${writeSafety.databaseHost ?? 'unset'} database=${writeSafety.databaseName ?? 'unset'}`,
  )
  for (const dataset of Object.values(report.datasets)) {
    console.log(
      `${dataset.dataset}: availability=${dataset.availability} raw=${dataset.rawRowsFetched} normalized=${dataset.normalizedRows} written=${dataset.rowsWritten} note=${dataset.note ?? 'none'}`,
    )
  }
  console.log(
    `Fallback projections: generated=${report.projections.generated} persisted=${report.projections.persisted} confidence=${JSON.stringify(report.projections.confidence)}`,
  )
  console.log(`Identity match rate=${report.identity.identityMatchRate}% duplicateGroups=${report.identity.duplicateCandidateGroups}`)
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
