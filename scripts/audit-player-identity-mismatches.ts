/**
 * Reader for `player_identity_mismatch_stats` — the draft-enrichment identity-mismatch rollup.
 *
 * WHY THIS EXISTS
 * The predecessor table (`player_identity_mismatch_logs`) was written 2,126,004 times and read
 * zero times. Part of the reason is that it was unreadable: 2.1M raw sightings of 60,987 facts,
 * with no counts and no ranking, is not something a human opens. The rollup is small enough to
 * query directly, and this script is the front door — without it we would just have rebuilt a
 * smaller write-only table.
 *
 * The signal is real: identity resolution failing for a player means the draft room shows that
 * player without stats or a headshot, because SportsPlayerRecord enrichment never joined.
 *
 * USAGE (read-only — issues no writes):
 *   node --env-file=.env --require ./scripts/_audit-preload.cjs --import tsx scripts/audit-player-identity-mismatches.ts
 *   ... --sport NFL --limit 40
 *   ... --league <leagueId>
 */
import { prisma } from '@/lib/prisma'
import { summarizePlayerMismatchForAi, type PlayerMismatchReason } from '@/lib/player-identity/playerMismatchLogger'

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag)
  return i !== -1 && process.argv[i + 1] ? String(process.argv[i + 1]) : null
}

function pct(part: number, whole: number): string {
  return whole === 0 ? '0%' : `${((100 * part) / whole).toFixed(1)}%`
}

async function main() {
  const sport = argValue('--sport')?.toUpperCase() ?? null
  const leagueId = argValue('--league')
  const limit = Number(argValue('--limit') ?? 25)

  const where = {
    ...(sport ? { sport } : {}),
    ...(leagueId ? { leagueId } : {}),
  }

  const [totalFacts, totalOccurrences, byReason, worst] = await Promise.all([
    prisma.playerIdentityMismatchStat.count({ where }),
    prisma.playerIdentityMismatchStat.aggregate({ where, _sum: { occurrences: true } }),
    prisma.playerIdentityMismatchStat.groupBy({
      by: ['reason', 'sport'],
      where,
      _count: { _all: true },
      _sum: { occurrences: true },
      orderBy: { _count: { reason: 'desc' } },
    }),
    prisma.playerIdentityMismatchStat.findMany({
      where,
      orderBy: [{ occurrences: 'desc' }, { lastSeenAt: 'desc' }],
      take: Number.isFinite(limit) && limit > 0 ? limit : 25,
    }),
  ])

  const sightings = totalOccurrences._sum.occurrences ?? 0

  console.log('\n=== Player identity mismatch rollup ===')
  if (sport || leagueId) console.log(`filter: ${[sport && `sport=${sport}`, leagueId && `league=${leagueId}`].filter(Boolean).join(' ')}`)

  if (totalFacts === 0) {
    console.log('\nNo mismatch facts recorded.')
    console.log('That is a real "all clear" only if a draft pool has resolved since the rollup shipped —')
    console.log('an empty table and a table nobody has written to yet look identical here.')
    return
  }

  console.log(`\ndistinct facts : ${totalFacts.toLocaleString()}`)
  console.log(`total sightings: ${sightings.toLocaleString()}  (${(sightings / totalFacts).toFixed(1)}x re-observed per fact)`)

  console.log('\n--- by reason ---')
  for (const row of byReason) {
    const facts = row._count._all
    console.log(
      `${row.reason.padEnd(30)} ${String(row.sport).padEnd(6)} ` +
        `facts=${String(facts).padStart(6)} (${pct(facts, totalFacts).padStart(6)})  ` +
        `sightings=${String(row._sum.occurrences ?? 0).padStart(8)}`,
    )
  }

  console.log(`\n--- top ${worst.length} most-repeated facts ---`)
  for (const row of worst) {
    console.log(
      `\n[${String(row.occurrences).padStart(6)}x] last seen ${row.lastSeenAt.toISOString().slice(0, 10)}`,
    )
    console.log(
      '  ' +
        summarizePlayerMismatchForAi({
          leagueId: row.leagueId,
          sport: row.sport,
          reason: row.reason as PlayerMismatchReason,
          playerName: row.playerName,
          position: row.position,
          team: row.team,
          poolPlayerId: row.lastPoolPlayerId,
          poolExternalId: row.lastPoolExternalId,
          sportsPlayerRecordId: row.lastSportsPlayerRecordId,
          attemptedMatchType: row.lastAttemptedMatchType,
          confidence: row.lastConfidence == null ? null : Number(row.lastConfidence),
        }),
    )
  }

  console.log('\nNO_SPORT_PLAYER_RECORD_MATCH  -> no SportsPlayerRecord for that player: draft row renders without stats/headshot.')
  console.log('ID_DRIFT_STRICT_MATCH_USED    -> pool external id did not resolve; matched on name+position+team instead.')
  console.log()
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
