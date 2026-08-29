/**
 * READ-ONLY. Does the trade evaluator's name-keyed IDP board actually price defenders?
 *
 * Never writes. Mirrors `scripts/probe-idp-trade-value.ts`, one step further down the
 * chain: that probe stops at `loadLeagueIdpVorp` (Sleeper-id space), this one exercises
 * the join the trade surfaces actually use, and then prices a defender through
 * `pricePlayer` exactly as `/api/trade-evaluator` does.
 *
 * The question it answers: before this wiring a defender came back UNPRICED from
 * `pricePlayer` (FantasyCalc carries no defenders, so the position needed by the flat
 * baseline resolved to 'UNKNOWN' and that branch never fired). If the board is working,
 * the same names now come back with distinct values and `source: 'idp-vorp'`.
 */
import { PrismaClient } from '@prisma/client'

import { hasIdpScoring } from '../lib/core-app/scoringNotes'
import { extractScoringSettings } from '../lib/projections/leagueScoring'
import { loadIdpTradeValuesByName } from '../lib/idp-projections/idpTradeValues'
import { pricePlayer } from '../lib/hybrid-valuation'

const prisma = new PrismaClient()

async function main() {
  const leagues = (
    await prisma.league.findMany({
      select: { id: true, name: true, platformLeagueId: true, settings: true, isDynasty: true },
    })
  ).filter((l) => hasIdpScoring(extractScoringSettings(l.settings)) && !!l.platformLeagueId)

  console.log(`IDP-scoring leagues with a platform id: ${leagues.length}`)

  const asOfDate = new Date().toISOString().slice(0, 10)

  for (const l of leagues.slice(0, 3)) {
    const board = await loadIdpTradeValuesByName({
      prisma,
      platformLeagueId: l.platformLeagueId,
      isDynasty: l.isDynasty ?? true,
    })

    console.log(
      `\n${l.name ?? l.id} (${l.platformLeagueId})\n` +
        `  skipped=${board.skipped} coverage=${JSON.stringify(board.coverage)} ` +
        `ambiguous=${board.ambiguousNames.length}`,
    )
    if (board.byNameLower.size === 0) continue

    const sorted = [...board.byNameLower.entries()].sort((a, b) => b[1].value - a[1].value)
    const sample = [sorted[0], sorted[Math.floor(sorted.length / 2)], sorted[sorted.length - 1]]

    for (const [nameLower, entry] of sample) {
      if (!nameLower) continue
      const withBoard = await pricePlayer(nameLower, {
        asOfDate,
        isSuperFlex: false,
        idpValueByNameLower: board.byNameLower,
      })
      const withoutBoard = await pricePlayer(nameLower, { asOfDate, isSuperFlex: false })
      console.log(
        `  ${nameLower.padEnd(24)} ${String(entry.position).padEnd(3)} ` +
          `board=${String(entry.value).padStart(5)}  ` +
          `priced=${String(withBoard.value).padStart(5)} (${withBoard.source})  ` +
          `WITHOUT=${String(withoutBoard.value).padStart(5)} (${withoutBoard.source}${withoutBoard.unpriced ? ', UNPRICED' : ''})`,
      )
    }
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
