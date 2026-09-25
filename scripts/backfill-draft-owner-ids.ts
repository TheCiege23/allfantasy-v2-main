/**
 * Backfill `dw_draft_facts.metadata.ownerSleeperId` — who owned the drafting team, per pick, per
 * season — for Sleeper leagues imported before the draft sync recorded it.
 * The logic, and why it only ever ADDS, lives in lib/league-import/sleeper/draftOwnerBackfill.ts.
 *
 * 🛑 RUN ONLY AFTER THE SYNC CHANGE IS DEPLOYED. The in-progress season is re-synced daily, and the
 * old sync re-creates those rows WITHOUT an owner, which would quietly undo this for 2026.
 *
 * DRY RUN BY DEFAULT: reads Sleeper and the database, prints what it WOULD write, writes nothing.
 * Pass --apply to write. It prints the database host first; read it before you let it continue.
 *
 *   node --env-file=.env --require ./scripts/_audit-preload.cjs --import tsx scripts/backfill-draft-owner-ids.ts
 *   … --apply                    write
 *   … --league=<League.id>       one league
 *   … --limit=<n>                the first n leagues
 */
import { prisma } from '@/lib/prisma'
import { getDraftPicks, getLeagueDrafts, getLeagueRosters } from '@/lib/sleeper-client'
import { getSleeperHistoricalLeagueChain } from '@/lib/league-import/sleeper/SleeperHistoricalLeagueChain'
import { withSleeperHistoricalRequestLimit } from '@/lib/league-import/sleeper/SleeperFetchConcurrency'
import {
  backfillLeagueDraftOwners,
  type DraftOwnerBackfillDeps,
  type DraftOwnerUpdate,
} from '@/lib/league-import/sleeper/draftOwnerBackfill'

/** The same depth the import walks. */
const MAX_PREVIOUS_SEASONS = 12

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return null
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : 'true'
}

function dbHost(): string {
  const raw = process.env.DATABASE_URL ?? ''
  const noScheme = raw.replace(/^[a-z]+:\/\//i, '')
  const afterAt = noScheme.includes('@') ? noScheme.slice(noScheme.lastIndexOf('@') + 1) : noScheme
  return afterAt.split(/[/?]/)[0] || '(DATABASE_URL unset)'
}

const deps: DraftOwnerBackfillDeps = {
  chain: (id) => getSleeperHistoricalLeagueChain(id, MAX_PREVIOUS_SEASONS),
  rosters: (id) => withSleeperHistoricalRequestLimit(() => getLeagueRosters(id)).catch(() => null) as Promise<unknown[] | null>,
  drafts: (id) => withSleeperHistoricalRequestLimit(() => getLeagueDrafts(id)).catch(() => null),
  picks: (id) => withSleeperHistoricalRequestLimit(() => getDraftPicks(id)).catch(() => null),
  existing: (leagueId) =>
    prisma.draftFact.findMany({
      where: { leagueId },
      select: { draftId: true, season: true, round: true, pickNumber: true, playerId: true, metadata: true },
    }),
  write: async (updates: DraftOwnerUpdate[]) => {
    let written = 0
    // One transaction per league: a league is either filled or untouched.
    await prisma.$transaction(async (tx) => {
      for (const u of updates) {
        // Merge, never replace, and never overwrite an owner a later sync already wrote.
        written += await tx.$executeRaw`
          UPDATE dw_draft_facts
             SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('ownerSleeperId', ${u.ownerSleeperId}::text)
           WHERE "draftId" = ${u.draftId}
             AND (metadata IS NULL OR NOT (metadata ? 'ownerSleeperId'))`
      }
    })
    return written
  },
}

async function main() {
  const apply = arg('apply') === 'true'
  const only = arg('league')
  const limit = Number(arg('limit') ?? '0') || null

  console.log(`database: ${dbHost()}`)
  console.log(`mode:     ${apply ? 'APPLY — writing owners' : 'dry run — nothing will be written'}`)

  const leagues = await prisma.league.findMany({
    where: {
      platform: { equals: 'sleeper', mode: 'insensitive' },
      NOT: { platformLeagueId: '' },
      ...(only ? { id: only } : {}),
    },
    select: { id: true, platformLeagueId: true, name: true },
    orderBy: { createdAt: 'asc' },
    ...(limit ? { take: limit } : {}),
  })
  console.log(`leagues:  ${leagues.length}`)

  const totals = { leagues: 0, seasonsRead: 0, updates: 0, written: 0, alreadyOwned: 0, unmatched: 0, ownerUnknown: 0, failed: 0 }
  for (const league of leagues) {
    try {
      const r = await backfillLeagueDraftOwners(deps, { id: league.id, platformLeagueId: league.platformLeagueId }, { apply })
      totals.leagues += 1
      totals.seasonsRead += r.seasonsRead.length
      totals.updates += r.updates.length
      totals.written += r.written
      totals.alreadyOwned += r.alreadyOwned
      totals.unmatched += r.unmatched
      totals.ownerUnknown += r.ownerUnknown
      if (r.updates.length > 0 || r.unmatched > 0) {
        console.log(
          `  ${league.id}  seasons ${r.seasonsRead.join(',') || '-'}  owners ${r.updates.length}` +
            `${apply ? ` (written ${r.written})` : ''}  already ${r.alreadyOwned}  unmatched ${r.unmatched}`,
        )
      }
    } catch (err) {
      totals.failed += 1
      console.error(`  ${league.id}  FAILED: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  console.log('totals:', JSON.stringify(totals))
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
