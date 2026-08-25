/**
 * READ-ONLY check against the founder's stated ground truth. Never writes.
 *
 * The handoff cited three real defenders with the number their own league projects:
 *   Carson Schwesinger (LB) ~15   DeMarcus Lawrence (DE) ~9.7   Quincy Williams (LB) ~12.8
 * against a generic PPR line of 0.3 / 0.6 / 0.3. This prints what this engine produces for
 * each of them in every IDP-scoring league that rosters them, so the model can be compared
 * to a number a human already knows.
 */
import { PrismaClient } from '@prisma/client'

import { hasIdpScoring } from '../lib/core-app/scoringNotes'
import { projectIdpStatLine } from '../lib/idp-projections/projectIdpStatLine'
import { computeLeagueProjectedPoints, extractScoringSettings } from '../lib/projections/leagueScoring'

const prisma = new PrismaClient()

const TARGETS = [
  { name: 'Schwesinger', expect: 15 },
  { name: 'DeMarcus Lawrence', expect: 9.7 },
  { name: 'Quincy Williams', expect: 12.8 },
]

async function main() {
  const leagues = (
    await prisma.league.findMany({ select: { id: true, name: true, settings: true } })
  ).filter((l) => hasIdpScoring(extractScoringSettings(l.settings)))

  const maxWeek = await prisma.playerGameStat.aggregate({
    where: { sportType: 'NFL' },
    _max: { season: true },
  })
  const season = maxWeek._max.season ?? 2025
  const wk = await prisma.playerGameStat.aggregate({
    where: { sportType: 'NFL', season },
    _max: { weekOrRound: true },
  })
  const week = (wk._max.weekOrRound ?? 0) + 1
  console.log(`season ${season}, projecting week ${week}\n`)

  for (const t of TARGETS) {
    const players = await prisma.sportsPlayer.findMany({
      where: { name: { contains: t.name, mode: 'insensitive' }, sport: 'NFL' },
      select: { sleeperId: true, name: true, position: true },
    })
    const p = players.find((x) => x.sleeperId)
    if (!p?.sleeperId) {
      console.log(`${t.name}: no SportsPlayer row with a sleeperId`)
      continue
    }

    const games = await prisma.playerGameStat.findMany({
      where: {
        sportType: 'NFL',
        playerId: p.sleeperId,
        OR: [
          { season, weekOrRound: { lt: week } },
          { season: { gte: season - 1, lt: season } },
        ],
      },
      select: { season: true, weekOrRound: true, opponent: true, normalizedStatMap: true },
    })

    const out = projectIdpStatLine({
      position: p.position,
      history: games.map((g) => ({
        season: g.season,
        week: g.weekOrRound,
        opponent: g.opponent,
        statMap: g.normalizedStatMap as Record<string, unknown>,
      })),
    })

    console.log(`${p.name} (${p.position}) — ${games.length} games, league says ~${t.expect}`)
    if (!out.ok) {
      console.log(`  REFUSED: ${out.reason} — ${out.detail}\n`)
      continue
    }
    console.log(`  line: ${JSON.stringify(out.statLine)}`)

    for (const l of leagues) {
      const scoring = extractScoringSettings(l.settings)!
      const scored = computeLeagueProjectedPoints(out.statLine, scoring)
      if (!scored) continue
      const delta = scored.points - t.expect
      const flag = Math.abs(delta) <= t.expect * 0.35 ? '✓' : ' '
      console.log(
        `   ${flag} ${(l.name ?? l.id).slice(0, 34).padEnd(36)} ${scored.points.toFixed(2).padStart(7)}` +
          `  (${delta >= 0 ? '+' : ''}${delta.toFixed(1)} vs stated)`,
      )
    }
    console.log()
  }
}

main()
  .catch((e) => console.error('failed:', e instanceof Error ? e.message.slice(0, 300) : e))
  .finally(() => prisma.$disconnect())
