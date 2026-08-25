/** READ-ONLY. Why does the pass rusher run high? Never writes. */
import { PrismaClient } from '@prisma/client'

import { deriveCohortPriors } from '../lib/idp-projections/cohortPriors'
import { projectIdpStatLine } from '../lib/idp-projections/projectIdpStatLine'
import { hasIdpScoring, isIdpPosition } from '../lib/core-app/scoringNotes'
import { computeLeagueProjectedPoints, extractScoringSettings } from '../lib/projections/leagueScoring'

const prisma = new PrismaClient()
const NAME = process.argv[2] ?? 'Demarcus Lawrence'

async function main() {
  const p = (
    await prisma.sportsPlayer.findMany({
      where: { name: { contains: NAME, mode: 'insensitive' }, sport: 'NFL' },
      select: { sleeperId: true, name: true, position: true },
    })
  ).find((x) => x.sleeperId)
  if (!p?.sleeperId) return console.log('not found')

  const games = await prisma.playerGameStat.findMany({
    where: { sportType: 'NFL', playerId: p.sleeperId },
    select: { season: true, weekOrRound: true, normalizedStatMap: true },
    orderBy: [{ season: 'asc' }, { weekOrRound: 'asc' }],
  })

  console.log(`${p.name} (${p.position}) — ${games.length} game rows\n`)

  // Raw totals, so a projected rate can be checked against what actually happened.
  const totals: Record<string, number> = {}
  const bySeason = new Map<number, number>()
  for (const g of games) {
    bySeason.set(g.season, (bySeason.get(g.season) ?? 0) + 1)
    const m = g.normalizedStatMap as Record<string, unknown>
    for (const [k, v] of Object.entries(m)) {
      if (k.startsWith('idp_') && typeof v === 'number') totals[k] = (totals[k] ?? 0) + v
    }
  }
  console.log('games by season:', JSON.stringify(Object.fromEntries([...bySeason].sort())))
  console.log('\nCAREER TOTALS over those games, and the implied per-game rate:')
  for (const [k, v] of Object.entries(totals).sort()) {
    console.log(`  ${k.padEnd(16)} total=${String(v).padStart(6)}  per-game=${(v / games.length).toFixed(3)}`)
  }

  const history = games.map((g) => ({
    season: g.season,
    week: g.weekOrRound,
    opponent: null,
    statMap: g.normalizedStatMap as Record<string, unknown>,
  }))

  // The cohort the real path would regress him toward: every rostered DE/DL in IDP leagues.
  const leagues = (
    await prisma.league.findMany({ select: { id: true, settings: true } })
  ).filter((l) => hasIdpScoring(extractScoringSettings(l.settings)))
  const ids = new Set<string>()
  for (const l of leagues) {
    const rosters = await prisma.roster.findMany({
      where: { leagueId: l.id },
      select: { playerData: true },
    })
    for (const r of rosters) {
      const pd = (r.playerData ?? {}) as Record<string, unknown>
      const arr = pd.players
      if (Array.isArray(arr)) for (const v of arr) if (typeof v === 'string' && v !== '0') ids.add(v)
    }
  }
  const pool = await prisma.sportsPlayer.findMany({
    where: { sleeperId: { in: [...ids] } },
    select: { sleeperId: true, position: true },
  })
  const seen = new Set<string>()
  const samePos = pool.filter((x) => {
    if (!x.sleeperId || seen.has(x.sleeperId) || !isIdpPosition(x.position)) return false
    seen.add(x.sleeperId)
    return x.position === p.position
  })
  const cohortGames = await prisma.playerGameStat.findMany({
    where: { sportType: 'NFL', playerId: { in: samePos.map((x) => x.sleeperId as string) } },
    select: { playerId: true, season: true, weekOrRound: true, normalizedStatMap: true },
  })
  const byPlayer = new Map<string, any[]>()
  for (const g of cohortGames) {
    const arr = byPlayer.get(g.playerId) ?? []
    arr.push({
      season: g.season,
      week: g.weekOrRound,
      opponent: null,
      statMap: g.normalizedStatMap as Record<string, unknown>,
    })
    byPlayer.set(g.playerId, arr)
  }
  const priors = deriveCohortPriors(
    p.position!,
    [...byPlayer.values()].map((h) => ({ position: p.position, history: h })),
  )
  console.log(`\ncohort ${p.position}: ${samePos.length} players, priors from ${priors?.sampleGames ?? 0} games`)
  console.log('prior per-game:', JSON.stringify(priors?.perGame))

  const noPriors = projectIdpStatLine({ position: p.position, history })
  const withPriors = projectIdpStatLine({ position: p.position, history, priors })

  console.log('\nWITHOUT priors (what the ground-truth probe ran):')
  if (noPriors.ok) console.log(' ', JSON.stringify(noPriors.statLine))
  console.log('WITH priors (what the shipped path runs):')
  if (withPriors.ok) console.log(' ', JSON.stringify(withPriors.statLine))

  const named = await prisma.league.findMany({ select: { id: true, name: true, settings: true } })
  console.log('\nscored in each genuine IDP league:      no-priors   with-priors')
  for (const l of named) {
    const sc = extractScoringSettings(l.settings)
    if (!sc || !hasIdpScoring(sc)) continue
    const a = noPriors.ok ? computeLeagueProjectedPoints(noPriors.statLine, sc)?.points : null
    const b = withPriors.ok ? computeLeagueProjectedPoints(withPriors.statLine, sc)?.points : null
    console.log(
      `  ${(l.name ?? l.id).slice(0, 32).padEnd(34)} ${String(a ?? '—').padStart(9)} ${String(b ?? '—').padStart(13)}`,
    )
  }
}

main()
  .catch((e) => console.error('failed:', e instanceof Error ? e.message.slice(0, 300) : e))
  .finally(() => prisma.$disconnect())
