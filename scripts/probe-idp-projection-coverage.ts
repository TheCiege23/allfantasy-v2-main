/**
 * READ-ONLY production probe for the IDP projection stack.
 *
 * ⚠ THIS SCRIPT MUST NEVER WRITE. Every query below is a count/findMany. It exists because
 * the IDP projector was built and unit-tested without ever being pointed at real data, and
 * "the tests pass" is not evidence that production carries the inputs the model assumes.
 *
 * It answers, in order:
 *   1. Do `PlayerGameStat.normalizedStatMap` rows actually carry `idp_*` keys? Everything
 *      rests on this; if the vocabulary differs, the model projects nothing for everyone.
 *   2. How many leagues score IDP, by the product's own `hasIdpScoring` predicate?
 *   3. For real IDP leagues: how many rostered defenders project, how many refuse, and why?
 *   4. The headline — a real linebacker's generic number beside his league-scored one.
 *
 * Usage (never commit an env file, never print a connection string):
 *   npx tsx scripts/probe-idp-projection-coverage.ts
 */

import { PrismaClient } from '@prisma/client'

import { hasIdpScoring, isIdpPosition } from '../lib/core-app/scoringNotes'
import { loadIdpProjections } from '../lib/idp-projections/loadIdpProjections'
import { computeLeagueProjectedPoints, extractScoringSettings } from '../lib/projections/leagueScoring'

const prisma = new PrismaClient()

function heading(s: string) {
  console.log(`\n${'='.repeat(78)}\n${s}\n${'='.repeat(78)}`)
}

/** Keys the projector reads. Kept literal so the probe fails loudly if the feed renames one. */
const IDP_KEYS = [
  'idp_tkl_solo',
  'idp_tkl_ast',
  'idp_tkl',
  'idp_sack',
  'idp_int',
  'idp_pass_def',
  'idp_ff',
  'idp_fum_rec',
]

async function probeStatVocabulary() {
  heading('1. Does PlayerGameStat.normalizedStatMap carry the idp_* vocabulary?')

  const total = await prisma.playerGameStat.count({ where: { sportType: 'NFL' } })
  console.log(`NFL player_game_stats rows: ${total.toLocaleString()}`)
  if (total === 0) {
    console.log('⚠ NO ROWS AT ALL. The projector cannot work; this is an ingestion problem.')
    return { seasons: [] as number[], anyIdp: false }
  }

  const bySeason = await prisma.playerGameStat.groupBy({
    by: ['season'],
    where: { sportType: 'NFL' },
    _count: { _all: true },
    orderBy: { season: 'desc' },
    take: 6,
  })
  console.log('\nrows by season:')
  for (const s of bySeason) console.log(`  ${s.season}: ${s._count._all.toLocaleString()}`)

  // Sample the newest season and count how many rows carry each key.
  const newest = bySeason[0]?.season
  const sample = await prisma.playerGameStat.findMany({
    where: { sportType: 'NFL', season: newest },
    select: { normalizedStatMap: true },
    take: 4000,
  })
  const counts = new Map<string, number>()
  let withAnyIdp = 0
  for (const r of sample) {
    const m = (r.normalizedStatMap ?? {}) as Record<string, unknown>
    let any = false
    for (const k of IDP_KEYS) {
      if (typeof m[k] === 'number') {
        counts.set(k, (counts.get(k) ?? 0) + 1)
        any = true
      }
    }
    if (any) withAnyIdp++
  }
  console.log(`\nsampled ${sample.length} rows from season ${newest}:`)
  console.log(`  rows carrying ANY idp_* key: ${withAnyIdp} (${pct(withAnyIdp, sample.length)})`)
  for (const k of IDP_KEYS) {
    console.log(`  ${k.padEnd(14)} ${(counts.get(k) ?? 0).toString().padStart(5)}`)
  }
  if (withAnyIdp === 0) {
    console.log(
      '\n⚠ ZERO rows carry the idp_* vocabulary. The projector will refuse every defender ' +
        'for no_defensive_production. Check what keys the feed actually writes before ' +
        'trusting any coverage number below.',
    )
  }
  return { seasons: bySeason.map((s) => s.season), anyIdp: withAnyIdp > 0 }
}

async function probeIdpLeagues() {
  heading('2. How many leagues score IDP?')
  const leagues = await prisma.league.findMany({
    select: { id: true, name: true, sport: true, settings: true },
  })
  const idpLeagues = leagues.filter((l) => hasIdpScoring(extractScoringSettings(l.settings)))
  console.log(`leagues total:      ${leagues.length}`)
  console.log(`with readable scoring: ${leagues.filter((l) => extractScoringSettings(l.settings)).length}`)
  console.log(`scoring IDP:        ${idpLeagues.length} (${pct(idpLeagues.length, leagues.length)})`)
  return idpLeagues
}

type IdpLeague = { id: string; name: string | null; settings: unknown }

async function probeLeagueCoverage(league: IdpLeague, season: number, week: number) {
  const scoring = extractScoringSettings(league.settings)!

  const rosters = await prisma.roster.findMany({
    where: { leagueId: league.id },
    select: { playerData: true },
  })
  const ids = new Set<string>()
  for (const r of rosters) {
    const pd = (r.playerData ?? {}) as Record<string, unknown>
    for (const key of ['starters', 'players']) {
      const arr = pd[key]
      if (Array.isArray(arr)) for (const v of arr) if (typeof v === 'string' && v) ids.add(v)
    }
  }
  if (ids.size === 0) return null

  const players = await prisma.sportsPlayer.findMany({
    where: { sleeperId: { in: [...ids] } },
    select: { sleeperId: true, name: true, position: true, team: true },
  })
  /*
   * ⚠ DEDUPE BY sleeperId. `SportsPlayer` carries duplicate rows per Sleeper id — 571
   * rostered ids resolved to 1,329 player rows and 599 "defenders" on the first run, i.e.
   * more defenders than roster slots. Counting those inflates `requested` and `projected`
   * while the results Map silently collapses them, which is what made the earlier run
   * report 531 projected but only 260 scoreable.
   */
  const byId = new Map<string, { sleeperId: string; position: string | null; team: string | null }>()
  for (const p of players) {
    if (!p.sleeperId || !isIdpPosition(p.position)) continue
    if (!byId.has(p.sleeperId)) {
      byId.set(p.sleeperId, { sleeperId: p.sleeperId, position: p.position, team: p.team })
    }
  }
  const defenders = [...byId.values()]

  console.log(`\n--- ${league.name ?? league.id} ---`)
  console.log(`  rostered ids: ${ids.size}, resolved players: ${players.length}, defenders: ${defenders.length}`)
  if (defenders.length === 0) {
    console.log('  no rostered defenders resolved — nothing to project')
    return null
  }

  const { bySleeperId, coverage } = await loadIdpProjections({
    prisma,
    season,
    week,
    players: defenders,
  })

  console.log(`  projected: ${coverage.projected}/${coverage.requested}  refused: ${coverage.refused}`)
  console.log(`  refusal rate: ${(coverage.refusalRate * 100).toFixed(1)}%`)
  console.log(`  reasons: ${JSON.stringify(coverage.refusalsByReason)}`)
  console.log(`  cohort priors: ${JSON.stringify(coverage.priorsByPosition)}`)

  // The headline: generic number beside the league-scored one.
  const nameOf = new Map(players.map((p) => [p.sleeperId, p.name]))
  const posOf = new Map(players.map((p) => [p.sleeperId, p.position]))
  const priced: Array<{ name: string; pos: string; pts: number }> = []
  for (const [id, outcome] of bySleeperId) {
    if (!outcome.ok) continue
    const scored = computeLeagueProjectedPoints(outcome.statLine, scoring)
    if (!scored) continue
    priced.push({
      name: nameOf.get(id) ?? id,
      pos: posOf.get(id) ?? '?',
      pts: scored.points,
    })
  }
  priced.sort((a, b) => b.pts - a.pts)
  console.log(`  scoreable under this league's rules: ${priced.length}`)
  for (const p of priced.slice(0, 8)) {
    console.log(`    ${p.pos.padEnd(4)} ${p.name.padEnd(26)} ${p.pts.toFixed(2)}`)
  }
  return { coverage, priced: priced.length }
}

function pct(a: number, b: number) {
  return b === 0 ? 'n/a' : `${((a / b) * 100).toFixed(1)}%`
}

async function main() {
  const { seasons, anyIdp } = await probeStatVocabulary()
  const idpLeagues = await probeIdpLeagues()

  if (!anyIdp) {
    console.log('\nStopping: without idp_* stats in the game logs, coverage numbers would be meaningless.')
    return
  }

  heading('3. Coverage on real IDP leagues')
  const season = seasons[0]
  // Project the week after the newest one on file, so history is non-empty.
  const newestWeek = await prisma.playerGameStat.aggregate({
    where: { sportType: 'NFL', season },
    _max: { weekOrRound: true },
  })
  const week = (newestWeek._max.weekOrRound ?? 0) + 1
  console.log(`projecting season ${season}, week ${week} (history strictly before it)`)

  let totalRequested = 0
  let totalProjected = 0
  for (const l of idpLeagues.slice(0, 5)) {
    const r = await probeLeagueCoverage(l as IdpLeague, season, week)
    if (r) {
      totalRequested += r.coverage.requested
      totalProjected += r.coverage.projected
    }
  }

  heading('4. Verdict')
  console.log(`defenders requested: ${totalRequested}`)
  console.log(`defenders projected: ${totalProjected} (${pct(totalProjected, totalRequested)})`)
  const rate = totalRequested ? 1 - totalProjected / totalRequested : 1
  console.log(`overall refusal rate: ${(rate * 100).toFixed(1)}%`)
  console.log(
    rate > 0.4
      ? '⚠ ABOVE THE 40% THRESHOLD — this would fail a scheduled job by design.'
      : '✓ within the 40% refusal threshold.',
  )
}

main()
  .catch((e) => {
    // Never print the error's connection string if one leaks into the message.
    console.error('probe failed:', e instanceof Error ? e.message.slice(0, 400) : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
