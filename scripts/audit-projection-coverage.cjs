#!/usr/bin/env node
/**
 * READ-ONLY audit of fantasy_projections coverage.
 *
 * Answers four questions that determine whether the Player Command Center can
 * produce honest replacement options:
 *
 *   1. How many distinct scoringPresetId values exist? (writer hardcodes "ppr")
 *   2. How many distinct `source` values exist? -> severity of the
 *      `new Map(rows.map(...))` collapse in every consumer, which silently keeps
 *      whichever duplicate row happened to come last.
 *   3. Does FantasyProjection.playerId actually join to a player table? The cron
 *      writes `providerId || "<sport>:<name-slug>"`, which is NOT guaranteed to be
 *      the canonical AF player id the rest of Decision OS uses.
 *   4. Do IDP / defensive positions have projection rows at all?
 *
 * Performs NO writes. Safe against production.
 */
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const IDP_POSITIONS = new Set([
  'DL', 'LB', 'DB', 'DE', 'DT', 'CB', 'S', 'SS', 'FS', 'OLB', 'ILB', 'MLB', 'EDGE', 'IDP',
])

function pct(n, d) {
  if (!d) return 'n/a'
  return `${((n / d) * 100).toFixed(1)}%`
}

async function main() {
  const sport = process.argv[2] || 'NFL'
  console.log(`\n=== fantasy_projections audit — sport=${sport} ===\n`)

  const total = await prisma.fantasyProjection.count({ where: { sport } })
  console.log(`total rows: ${total}`)
  if (total === 0) {
    console.log('\nNo rows. Ingestion has never run for this sport, or writes a different sport key.')
    return
  }

  // --- 1 + 2: preset and source cardinality -------------------------------
  const byPreset = await prisma.fantasyProjection.groupBy({
    by: ['scoringPresetId'],
    where: { sport },
    _count: { _all: true },
  })
  console.log('\n--- scoringPresetId ---')
  for (const r of byPreset) console.log(`  ${r.scoringPresetId.padEnd(16)} ${r._count._all}`)
  if (byPreset.length === 1) {
    console.log(`  => SINGLE preset. Every league sees "${byPreset[0].scoringPresetId}" numbers.`)
  }

  const bySource = await prisma.fantasyProjection.groupBy({
    by: ['source'],
    where: { sport },
    _count: { _all: true },
  })
  console.log('\n--- source ---')
  for (const r of bySource) console.log(`  ${String(r.source).padEnd(24)} ${r._count._all}`)
  console.log(
    bySource.length > 1
      ? `  => ${bySource.length} sources: the Map-collapse in consumers IS live (nondeterministic pick).`
      : '  => single source: Map-collapse is latent, not currently firing.',
  )

  // --- latest season/week in the data -------------------------------------
  const latest = await prisma.fantasyProjection.findFirst({
    where: { sport },
    orderBy: [{ season: 'desc' }, { week: 'desc' }],
    select: { season: true, week: true, fetchedAt: true },
  })
  console.log(`\nlatest row: season=${latest.season} week=${latest.week} fetchedAt=${latest.fetchedAt.toISOString()}`)

  // --- duplicate rows per player (collapse blast radius) -------------------
  const dupes = await prisma.fantasyProjection.groupBy({
    by: ['playerId'],
    where: { sport, season: latest.season, week: latest.week },
    _count: { _all: true },
    having: { playerId: { _count: { gt: 1 } } },
  })
  const playersThisWeek = await prisma.fantasyProjection
    .groupBy({ by: ['playerId'], where: { sport, season: latest.season, week: latest.week } })
    .then((r) => r.length)
  console.log(
    `players with >1 row in latest week: ${dupes.length} / ${playersThisWeek} (${pct(dupes.length, playersThisWeek)})`,
  )

  // --- 3: does playerId join to a player table? ---------------------------
  const sampleRows = await prisma.fantasyProjection.findMany({
    where: { sport, season: latest.season, week: latest.week },
    select: { playerId: true },
    take: 500,
  })
  const sampleIds = [...new Set(sampleRows.map((r) => r.playerId))]
  console.log(`\n--- id namespace (sample of ${sampleIds.length}) ---`)
  console.log(`  examples: ${sampleIds.slice(0, 5).join(', ')}`)

  const sprHits = await prisma.sportsPlayerRecord.findMany({
    where: { id: { in: sampleIds } },
    select: { id: true, position: true },
  })
  const playerHits = await prisma.player.findMany({
    where: { id: { in: sampleIds } },
    select: { id: true, position: true },
  })
  console.log(`  SportsPlayerRecord.id match: ${sprHits.length}/${sampleIds.length} (${pct(sprHits.length, sampleIds.length)})`)
  console.log(`  Player.id match:             ${playerHits.length}/${sampleIds.length} (${pct(playerHits.length, sampleIds.length)})`)

  const joinTable = sprHits.length >= playerHits.length ? 'SportsPlayerRecord' : 'Player'
  const hits = sprHits.length >= playerHits.length ? sprHits : playerHits
  if (hits.length === 0) {
    console.log('\n  => playerId joins to NEITHER player table. Position breakdown impossible;')
    console.log('     replacement ranking cannot filter by position for these rows.')
    return
  }

  // --- 4: IDP coverage ----------------------------------------------------
  console.log(`\n--- position coverage (via ${joinTable}, sample) ---`)
  const byPos = new Map()
  for (const h of hits) {
    const p = (h.position || 'UNKNOWN').toUpperCase()
    byPos.set(p, (byPos.get(p) || 0) + 1)
  }
  const sorted = [...byPos.entries()].sort((a, b) => b[1] - a[1])
  for (const [pos, n] of sorted) {
    const flag = IDP_POSITIONS.has(pos) ? '  <-- IDP' : ''
    console.log(`  ${pos.padEnd(10)} ${String(n).padStart(5)}${flag}`)
  }

  const idpCount = sorted.filter(([p]) => IDP_POSITIONS.has(p)).reduce((a, [, n]) => a + n, 0)
  console.log(`\n  IDP rows in sample: ${idpCount} / ${hits.length} (${pct(idpCount, hits.length)})`)
  console.log(
    idpCount === 0
      ? '  => NO defensive projections. IDP leagues cannot produce projection-ranked\n' +
        '     replacement options. This is an INGESTION gap — re-scoring cannot fix it.'
      : '  => defensive projections exist; IDP replacement ranking is possible.',
  )
}

/**
 * The OTHER projection store. `crossLeaguePlayerPortfolio` reads only
 * FantasyProjection, but nflDataFoundationService reads BOTH — so if the real
 * data lives here, the Player Command Center is pointed at the wrong table and
 * the fix is a repoint, not an ingestion project.
 */
async function auditAfSnapshots(sport) {
  console.log(`\n\n=== af_projection_snapshots audit — sport=${sport} ===\n`)
  const total = await prisma.aFProjectionSnapshot.count({ where: { sport } })
  console.log(`total rows: ${total}`)
  if (total === 0) {
    console.log('=> ALSO empty. No populated projection store exists for this sport.')
    return
  }

  const latest = await prisma.aFProjectionSnapshot.findFirst({
    where: { sport },
    orderBy: [{ season: 'desc' }, { week: 'desc' }],
    select: { season: true, week: true, computedAt: true },
  })
  console.log(`latest: season=${latest.season} week=${latest.week} computedAt=${latest.computedAt.toISOString()}`)

  const byPos = await prisma.aFProjectionSnapshot.groupBy({
    by: ['position'],
    where: { sport, season: latest.season },
    _count: { _all: true },
  })
  console.log('\n--- position coverage (real column, no join needed) ---')
  const sorted = byPos.sort((a, b) => b._count._all - a._count._all)
  for (const r of sorted) {
    const pos = (r.position || 'UNKNOWN').toUpperCase()
    console.log(`  ${pos.padEnd(10)} ${String(r._count._all).padStart(6)}${IDP_POSITIONS.has(pos) ? '  <-- IDP' : ''}`)
  }
  const idp = sorted.filter((r) => IDP_POSITIONS.has((r.position || '').toUpperCase()))
    .reduce((a, r) => a + r._count._all, 0)
  const all = sorted.reduce((a, r) => a + r._count._all, 0)
  console.log(`\n  IDP rows: ${idp} / ${all} (${pct(idp, all)})`)

  // Does THIS store's id namespace join to a player table?
  const sample = await prisma.aFProjectionSnapshot.findMany({
    where: { sport, season: latest.season },
    select: { playerId: true },
    take: 500,
  })
  const ids = [...new Set(sample.map((r) => r.playerId))]
  const [spr, pl] = await Promise.all([
    prisma.sportsPlayerRecord.count({ where: { id: { in: ids } } }),
    prisma.player.count({ where: { id: { in: ids } } }),
  ])
  console.log(`\n--- id namespace (sample of ${ids.length}) ---`)
  console.log(`  examples: ${ids.slice(0, 5).join(', ')}`)
  console.log(`  SportsPlayerRecord.id match: ${spr}/${ids.length} (${pct(spr, ids.length)})`)
  console.log(`  Player.id match:             ${pl}/${ids.length} (${pct(pl, ids.length)})`)
}

main()
  .then(() => auditAfSnapshots(process.argv[2] || 'NFL'))
  .catch((e) => {
    console.error('\naudit failed:', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
