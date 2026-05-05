/**
 * Detect `sports_players` (SportsPlayerRecord) ID drift vs assembled league pool IDs.
 *
 * Default: dry-run report only.
 * `--apply` is reserved: this repo does not expose a single authoritative pool FK
 * that always equals `sports_players.id` — confirm which column to update (e.g.
 * PlayerIdentityMap vs SportsPlayer sync fields) before enabling writes.
 *
 * Usage:
 *   npx tsx scripts/repair-player-identity-drift.ts [--sport NFL] [--leagueId <id>] [--limit 100]
 *   npx tsx scripts/repair-player-identity-drift.ts --apply   # currently no-op writes (see stderr)
 */

import { prisma } from '@/lib/prisma'
import { getPlayerPoolForLeague } from '@/lib/sport-teams/SportPlayerPoolResolver'
import { buildStrictPlayerKey, normalizePosition, normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'
import type { LeagueSport } from '@prisma/client'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

type Stats = {
  checked: number
  exactIdMatches: number
  strictFallbackMatches: number
  ambiguousLooseSkipped: number
  noMatch: number
  proposedRepairs: number
  appliedRepairs: number
}

function parseArgs(argv: string[]) {
  let sport: string | null = null
  let leagueId: string | null = null
  let limit = 500
  let apply = false
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--sport' && argv[i + 1]) {
      sport = argv[++i]!
      continue
    }
    if (a === '--leagueId' && argv[i + 1]) {
      leagueId = argv[++i]!
      continue
    }
    if (a === '--limit' && argv[i + 1]) {
      limit = Math.max(1, Number.parseInt(argv[++i]!, 10) || 500)
      continue
    }
    if (a === '--apply') {
      apply = true
      continue
    }
  }
  return { sport: sport ?? 'NFL', leagueId, limit, apply }
}

async function main() {
  const { sport: sportRaw, leagueId, limit, apply } = parseArgs(process.argv)
  const sportU = normalizeToSupportedSport(sportRaw).toUpperCase() as LeagueSport

  const stats: Stats = {
    checked: 0,
    exactIdMatches: 0,
    strictFallbackMatches: 0,
    ambiguousLooseSkipped: 0,
    noMatch: 0,
    proposedRepairs: 0,
    appliedRepairs: 0,
  }

  const proposals: Array<{
    poolName: string
    sport: string
    position: string
    team: string | null
    poolExternalOrSprCandidate: string | null
    matchedSportsPlayersId: string
    reason: string
  }> = []

  const poolRows = leagueId
    ? await getPlayerPoolForLeague(leagueId, sportU, { limit }).catch(() => [] as any[])
    : []

  type PoolLike = {
    full_name: string
    position: string
    team_abbreviation: string | null
    external_source_id: string | null
  }

  let rows: PoolLike[] = poolRows as PoolLike[]

  if (!rows.length) {
    const sp = await prisma.sportsPlayer.findMany({
      where: { sport: sportU },
      select: {
        sleeperId: true,
        externalId: true,
        id: true,
        name: true,
        position: true,
        team: true,
      },
      take: limit,
    })
    rows = sp.map((r) => ({
      full_name: r.name,
      position: r.position ?? '',
      team_abbreviation: r.team ?? null,
      external_source_id: String(r.sleeperId ?? r.externalId ?? r.id ?? '').trim() || null,
    }))
  }

  const sprRows = await prisma.sportsPlayerRecord.findMany({
    where: { sport: sportU },
    select: { id: true, name: true, position: true, team: true },
    take: Math.min(50_000, Math.max(limit * 50, 2000)),
  })

  const strictBuckets = new Map<string, string[]>()
  for (const r of sprRows) {
    const k = buildStrictPlayerKey({
      name: r.name,
      position: r.position,
      team: r.team,
      sport: sportU,
    })
    const list = strictBuckets.get(k) ?? []
    list.push(r.id)
    strictBuckets.set(k, list)
  }

  const ambiguousLooseKeys = new Set<string>()
  const looseGroups = new Map<string, string[]>()
  for (const r of sprRows) {
    const lk = `${normalizePlayerName(r.name)}|${normalizePosition(r.position, sportU)}|${sportU}`
    const list = looseGroups.get(lk) ?? []
    list.push(r.id)
    looseGroups.set(lk, list)
  }
  for (const [lk, ids] of looseGroups) {
    if (ids.length > 1) ambiguousLooseKeys.add(lk)
  }

  for (const row of rows as PoolLike[]) {
    stats.checked += 1
    const name = row.full_name
    const position = row.position
    const team = row.team_abbreviation
    const poolId = row.external_source_id ? String(row.external_source_id).trim() : null

    const hitSprById =
      poolId &&
      sprRows.some((s) => s.id === poolId)
    if (hitSprById) {
      stats.exactIdMatches += 1
      continue
    }

    const strictKey = buildStrictPlayerKey({ name, position, team, sport: sportU })
    const bucket = strictBuckets.get(strictKey)?.filter(Boolean) ?? []
    const uniq = [...new Set(bucket)]

    if (uniq.length === 1) {
      stats.strictFallbackMatches += 1
      const matchedId = uniq[0]!
      const confidence = 0.9
      if (poolId && poolId !== matchedId && confidence >= 0.9) {
        stats.proposedRepairs += 1
        proposals.push({
          poolName: name,
          sport: sportU,
          position,
          team,
          poolExternalOrSprCandidate: poolId,
          matchedSportsPlayersId: matchedId,
          reason:
            'pool external id did not match sports_players.id; strict identity resolves exactly one row',
        })
      }
      continue
    }

    const lk = `${normalizePlayerName(name)}|${normalizePosition(position, sportU)}|${sportU}`
    if (ambiguousLooseKeys.has(lk)) {
      stats.ambiguousLooseSkipped += 1
      continue
    }

    stats.noMatch += 1
  }

  console.log(JSON.stringify({ mode: apply ? 'apply-requested' : 'dry-run', sport: sportU, leagueId, stats }, null, 2))
  if (proposals.length) {
    console.log('--- proposed repairs (strict-only, confidence >= 0.9) ---')
    for (const p of proposals.slice(0, 200)) console.log(JSON.stringify(p))
    if (proposals.length > 200) console.log(`... ${proposals.length - 200} more`)
  }

  if (apply) {
    console.error(
      '[repair-player-identity-drift] --apply requested but no DB write target is confirmed.\n' +
        'TODO: map proposals to the authoritative column (pool FK / PlayerIdentityMap / sync pipeline).\n' +
        'Until then, appliedRepairs stays 0 by design.',
    )
    await prisma.$disconnect()
    process.exit(2)
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
