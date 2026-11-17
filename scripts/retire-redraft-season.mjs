#!/usr/bin/env node
/**
 * Retire a stuck native redraft season — a test or abandoned league whose week can never close.
 * (2026-11-14: a 12-team, one-player-per-roster test league had held week 5 open for six weeks.)
 *
 *   railway run node scripts/retire-redraft-season.mjs                       # LIST (read-only)
 *   railway run node scripts/retire-redraft-season.mjs --season-id=<id> \
 *     --confirm-league-name="<exact league name>" --confirm-host=<db host>    # DRY RUN (read-only)
 *   …same, plus --apply                                                       # WRITE
 *
 * Retiring = two writes in one transaction, plus one audit row:
 *   - RedraftSeason.status → 'complete'   (the score-sync sweep stops considering it)
 *   - League.lifecycleState → 'archived'  (read-only; renewal is not offered — lib/leagues/renewalPolicy.ts)
 *   - an `audit_logs` row, action `season_retired`, recording the before and after values.
 * No matchup, roster or score row is touched, so nothing is lost.
 *
 * 🛑 THREE GUARDS, because this writes to production and the operator names the target:
 *   1. --confirm-host must equal the host the client will connect to (only the host is printed).
 *   2. --confirm-league-name must equal the league's name exactly — an id alone is easy to paste wrong.
 *   3. Nothing is written without --apply; every other run is read-only.
 */
import { PrismaClient } from '@prisma/client'

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}
const apply = process.argv.includes('--apply')
const seasonId = arg('season-id')
const sport = (arg('sport') ?? 'NFL').toUpperCase()
const seasonYear = Number(arg('season') ?? '2026')

function host() {
  try {
    return new URL(process.env.DIRECT_URL || process.env.DATABASE_URL || '').hostname || null
  } catch {
    return null
  }
}

const prisma = new PrismaClient()

async function list() {
  console.log(`retire-redraft-season: LIST on ${host() ?? '(unknown host)'} (read-only), ${sport} ${seasonYear}\n`)
  const rows = await prisma.$queryRaw`
    SELECT s.id AS season_id, l.name, l.platform, l."lifecycleState"::text AS lifecycle, s.status, s."currentWeek" AS week,
           (SELECT COUNT(*)::int FROM redraft_rosters r WHERE r."seasonId" = s.id) AS rosters,
           (SELECT COUNT(*)::int FROM redraft_roster_players rp JOIN redraft_rosters r ON r.id = rp."rosterId"
              WHERE r."seasonId" = s.id AND rp."droppedAt" IS NULL) AS active_players,
           (SELECT MIN(m.week) FROM redraft_matchups m
              WHERE m."seasonId" = s.id AND m."awayRosterId" IS NOT NULL AND m.status <> 'final') AS oldest_open_week
    FROM redraft_seasons s JOIN leagues l ON l.id = s."leagueId"
    WHERE upper(s.sport) = ${sport} AND s.season = ${seasonYear} AND s.status <> 'complete'
      AND EXISTS (SELECT 1 FROM redraft_matchups m WHERE m."seasonId" = s.id)
    ORDER BY oldest_open_week NULLS LAST`
  if (!rows.length) console.log('(no unfinished season with matchups)')
  for (const r of rows) {
    console.log(`season ${r.season_id}`)
    console.log(`  league "${r.name ?? '(no name)'}", platform ${r.platform}, lifecycle ${r.lifecycle}, status ${r.status}, currentWeek ${r.week}`)
    console.log(`  ${r.rosters} rosters, ${r.active_players} active players, oldest open week ${r.oldest_open_week ?? '-'}`)
  }
  console.log('\nTo retire one: re-run with --season-id=<id> --confirm-league-name="<name>" --confirm-host=<host> (dry run), then add --apply.')
}

async function retire() {
  const h = host()
  const confirmHost = arg('confirm-host')
  if (!h || confirmHost !== h) {
    console.error(`Refusing: this would act on the database at "${h}". Re-run with --confirm-host=${h} if that is the one you mean.`)
    process.exitCode = 2
    return
  }
  const season = await prisma.redraftSeason.findUnique({
    where: { id: seasonId },
    select: { id: true, status: true, sport: true, season: true, currentWeek: true, leagueId: true, league: { select: { name: true, lifecycleState: true, platform: true } } },
  })
  if (!season) {
    console.error(`Refusing: no season ${seasonId}.`)
    process.exitCode = 2
    return
  }
  const name = season.league?.name ?? ''
  if (arg('confirm-league-name') !== name) {
    console.error(`Refusing: --confirm-league-name must equal the league's name exactly: "${name}".`)
    process.exitCode = 2
    return
  }
  const before = { seasonStatus: season.status, lifecycleState: season.league?.lifecycleState ?? null }
  const after = { seasonStatus: 'complete', lifecycleState: 'archived' }
  console.log(`retire-redraft-season: ${apply ? 'APPLY' : 'DRY RUN'} on ${h}`)
  console.log(`  league "${name}" (${season.league?.platform}), ${season.sport} ${season.season}, currentWeek ${season.currentWeek}`)
  console.log(`  season status   ${before.seasonStatus} → ${after.seasonStatus}`)
  console.log(`  league lifecycle ${before.lifecycleState} → ${after.lifecycleState}`)
  if (before.seasonStatus === 'complete' && before.lifecycleState === 'archived') {
    console.log('  already retired — nothing to do.')
    return
  }
  if (!apply) {
    console.log('\nNothing written. Add --apply to make these two changes.')
    return
  }
  await prisma.$transaction([
    prisma.redraftSeason.update({ where: { id: season.id }, data: { status: 'complete' } }),
    prisma.league.update({ where: { id: season.leagueId }, data: { lifecycleState: 'archived' } }),
    prisma.leagueAuditLog.create({
      data: {
        leagueId: season.leagueId,
        userId: null,
        actionType: 'season_retired',
        entityType: 'redraft_season',
        entityId: season.id,
        beforeState: before,
        afterState: after,
        metadata: { script: 'scripts/retire-redraft-season.mjs', reason: 'stuck test league retired by the owner' },
      },
    }),
  ])
  const check = await prisma.redraftSeason.findUnique({ where: { id: season.id }, select: { status: true, league: { select: { lifecycleState: true } } } })
  console.log(`\nDone. Read back: season status ${check?.status}, league lifecycle ${check?.league?.lifecycleState}.`)
}

try {
  if (seasonId) await retire()
  else await list()
} catch (err) {
  console.error('retire-redraft-season failed:', err instanceof Error ? err.message.split('\n').slice(-1)[0] : err)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
