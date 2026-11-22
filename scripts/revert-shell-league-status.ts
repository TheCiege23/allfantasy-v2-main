/**
 * Take back the "in season" status the first status backfill wrote onto twelve empty leagues.
 *
 * WHAT HAPPENED. `scripts/backfill-native-league-status.ts` ran against production on 2026-11-19 and
 * changed 14 leagues. Two were the stale `setup` it exists for. The other twelve had NO status: ten
 * tournament division shells and two Survivor Exile Island shells, with no claimed team and no season.
 * Their `lifecycleState` read `in_season` only because that is the column's default, and the script
 * wrote it into `status`. The backfill no longer does that; this puts those twelve back as they were.
 *
 * 🛑 THE TWELVE ARE NAMED BY ID, NOT FOUND BY A RULE. A rule like "in season with no claimed team"
 * could match a real league this script has never seen. The ids below were read from production
 * straight after the run (every one updated at 04:10:03-04 UTC, the second the backfill wrote).
 *
 * AND EACH ONE IS RE-CHECKED BEFORE IT IS TOUCHED. A league is reset only if it still looks exactly
 * like what the backfill left behind:
 *   - it plays on AllFantasy (a native platform);
 *   - `status` is `in_season` AND `lifecycleState` is `in_season`;
 *   - no team in it has been claimed;
 *   - it has no season.
 * Anything else is listed under "left alone" with the reason, and never written. A shell that has
 * since been claimed or started is a real league now, and its status is its own.
 *
 * The write sets `status` to NULL, which is what it held before, and is guarded on the two values
 * read, so a league that changes while this runs is skipped.
 *
 * ⚠ DRY RUN BY DEFAULT. It prints the target database and every league by name. Pass --apply to
 * write. Writing to production also needs ALLOW_PROD_BACKFILL=1.
 *
 *     railway run npx tsx scripts/revert-shell-league-status.ts
 *     railway run npx tsx scripts/revert-shell-league-status.ts --apply     (with ALLOW_PROD_BACKFILL=1 set)
 *
 * RE-RUNNABLE. A second run finds every league already reset and writes nothing.
 *
 * ONE-OFF. Once it has run this file has no further use and can be deleted.
 */
import { prisma } from '../lib/prisma'
import { isNativePlatform } from '../lib/dashboard/platform-label'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { describeTarget, identifyTarget } = require('./db-target-identity.cjs') as {
  describeTarget: (url: string) => string
  identifyTarget: (url: string) => { kind: string }
}

/** The twelve leagues the 2026-11-19 backfill filled in. Ten tournament divisions, two Exile Island leagues. */
export const SHELL_LEAGUE_IDS: readonly string[] = [
  '0c06473d-9509-47ec-bc69-f372a5644c86',
  '3f02eea7-3ae2-438e-ad5e-14d644c6a7e4',
  '55ddacfb-e68f-404b-92c4-fd7cbbdf8e3a',
  '5a7b528b-e72a-4c3d-b252-de768bef1c57',
  '63b90578-7df8-4447-9581-f3ad646f2754',
  '7179b66d-fcb1-4bdd-9b59-555c68ea6c46',
  '81b0f2d9-8bdd-4869-b201-1a85c1ea31b3',
  'a0375d16-a2ad-4d45-90e9-d473b4510530',
  'a1f5629a-447a-4f49-8cbf-f3e24d0a1b4a',
  'ac5f93d4-95a0-4895-b147-7a5c9bbb2b0a',
  '88f92a6e-e197-455b-abba-989b9a2b75ff',
  'd7074de1-f4b6-42e9-9843-a3301d20a68c',
]

/** What the backfill wrote, and so the only pair this script will undo. */
const WRITTEN_STATUS = 'in_season'
const DEFAULT_LIFECYCLE = 'in_season'

export type ShellRow = {
  id: string
  name: string | null
  platform: string | null
  leagueVariant: string | null
  status: string | null
  lifecycleState: string | null
  claimedTeams: number
  seasons: number
}

export type ShellPlan = {
  /** Still exactly what the backfill left: set `status` back to null. */
  reset: ShellRow[]
  /** Already has no status: nothing to do. */
  alreadyReset: ShellRow[]
  /** Something about it changed, so it is not written. */
  leftAlone: Array<ShellRow & { reason: string }>
  /** Ids on the list that are not in this database. */
  missing: string[]
}

/** PURE: what to reset, what is already done, and what to leave alone and why. */
export function planShellStatusRevert(ids: readonly string[], rows: readonly ShellRow[]): ShellPlan {
  const plan: ShellPlan = { reset: [], alreadyReset: [], leftAlone: [], missing: [] }
  const byId = new Map(rows.map((r) => [r.id, r]))
  for (const id of ids) {
    const row = byId.get(id)
    if (!row) {
      plan.missing.push(id)
      continue
    }
    if (row.status == null) {
      plan.alreadyReset.push(row)
      continue
    }
    const leave = (reason: string) => plan.leftAlone.push({ ...row, reason })
    if (!isNativePlatform(row.platform)) leave('it is an imported league')
    else if (row.status !== WRITTEN_STATUS) leave(`its status is now "${row.status}", not what the backfill wrote`)
    else if (row.lifecycleState !== DEFAULT_LIFECYCLE) leave(`its phase is now "${row.lifecycleState}", so it has moved since`)
    else if (row.claimedTeams > 0) leave(`${row.claimedTeams} of its teams ${row.claimedTeams === 1 ? 'has' : 'have'} been claimed`)
    else if (row.seasons > 0) leave('it has a season')
    else plan.reset.push(row)
  }
  return plan
}

/**
 * PURE: the ids to run over. The fixed list, except on a non-production database, where a local test
 * may name its own. Against production an override is refused outright rather than ignored, so a
 * shell that happens to carry one cannot widen what this script touches there.
 */
export function shellIdsFor(production: boolean, override: string | null | undefined): readonly string[] {
  const named = (override ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (named.length === 0) return SHELL_LEAGUE_IDS
  if (production) throw new Error('SHELL_STATUS_REVERT_TEST_IDS is for a local test database. It is refused against production.')
  return named
}

async function main() {
  const apply = process.argv.includes('--apply')
  const url = process.env.DATABASE_URL ?? ''
  if (!url) throw new Error('DATABASE_URL is not set. Name the database to run against.')
  // Never the URL itself: it carries a password.
  console.log(`Target: ${describeTarget(url)}`)
  const production = identifyTarget(url).kind === 'production'
  if (apply && production && process.env.ALLOW_PROD_BACKFILL !== '1') {
    throw new Error('Refusing to write to PRODUCTION without ALLOW_PROD_BACKFILL=1.')
  }
  const ids = shellIdsFor(production, process.env.SHELL_STATUS_REVERT_TEST_IDS)

  const leagues = await prisma.league.findMany({
    where: { id: { in: [...ids] } },
    select: {
      id: true, name: true, platform: true, leagueVariant: true, status: true, lifecycleState: true,
      teams: { where: { claimedByUserId: { not: null } }, select: { id: true } },
      redraftSeasons: { select: { id: true } },
    },
    orderBy: { name: 'asc' },
  })
  const plan = planShellStatusRevert(
    ids,
    leagues.map((l) => ({
      id: l.id, name: l.name, platform: l.platform, leagueVariant: l.leagueVariant, status: l.status,
      lifecycleState: String(l.lifecycleState), claimedTeams: l.teams.length, seasons: l.redraftSeasons.length,
    })),
  )
  const line = (r: ShellRow) => `  ${r.id}  ${r.name ?? ''}  (${r.leagueVariant ?? 'no variant'})`

  console.log(`Leagues on the list: ${ids.length}. To reset: ${plan.reset.length}. Already reset: ${plan.alreadyReset.length}. Left alone: ${plan.leftAlone.length}. Not found: ${plan.missing.length}.`)
  if (plan.reset.length) console.log('\nWould clear the status ("in_season" -> none):')
  for (const r of plan.reset) console.log(line(r))
  if (plan.alreadyReset.length) console.log('\nAlready have no status:')
  for (const r of plan.alreadyReset) console.log(line(r))
  if (plan.leftAlone.length) console.log('\nLeft alone:')
  for (const r of plan.leftAlone) console.log(`${line(r)}  because ${r.reason}`)
  if (plan.missing.length) console.log(`\nNot in this database: ${plan.missing.join(', ')}`)

  if (!apply) {
    console.log('\nDry run: nothing was written. Pass --apply to write.')
    return
  }

  let written = 0
  let skipped = 0
  for (const r of plan.reset) {
    const res = await prisma.league.updateMany({
      where: { id: r.id, status: WRITTEN_STATUS, lifecycleState: DEFAULT_LIFECYCLE as never },
      data: { status: null },
    })
    if (res.count === 1) written += 1
    else skipped += 1
  }
  console.log(`\nWritten: ${written}. Skipped because the league changed while this ran: ${skipped}.`)
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
