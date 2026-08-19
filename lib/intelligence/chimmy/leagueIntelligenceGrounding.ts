import 'server-only'

/**
 * League-intelligence grounding for Chimmy — mirrors the G15.10 commissioner
 * grounding pattern: NEVER throws, returns null on any miss, additive-only.
 *
 * When a chat turn carries a leagueId (Sleeper-imported league), this builds a
 * compact, factual brief from the SAME engines the league dashboard renders:
 *  - LeagueContext envelope (variant, scoring, IDP emphasis, pirate house rule)
 *  - Market valuation chart in the league's exact format (FantasyCalc) + the
 *    labeled FAAB heuristic
 *  - Graded trade ledger summary (latest trade + grades)
 *  - H2H records highlights
 *
 * Every sub-fetch is bounded by a short timeout so a cold cache can never
 * stall a chat turn — whatever resolves in time is included; the rest is
 * simply absent. The brief instructs the model to treat these as the ONLY
 * league facts and not to invent beyond them.
 */

import { prisma } from '@/lib/prisma'
import { getLeagueContext } from '@/lib/league-context/leagueContextService'
import { getMarketValues } from '@/lib/trade-intel/marketValueService'
import { getTradeGrades } from '@/lib/trade-intel/sleeperTradeGradeService'
import { getLeagueH2H } from '@/lib/league-history/sleeperH2HService'

function withTimeout<T>(p: Promise<T | null>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

export async function resolveLeagueIntelligenceGrounding(args: {
  userId?: string | null
  leagueId?: string | null
}): Promise<string | null> {
  try {
    const leagueId = args.leagueId?.trim()
    const userId = args.userId?.trim()
    if (!leagueId || !userId) return null

    // Access check mirrors every league API: owner or claimed team.
    const league = await prisma.league.findFirst({
      where: {
        id: leagueId,
        OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }],
      },
      select: { name: true, platform: true, platformLeagueId: true },
    })
    if (!league || league.platform !== 'sleeper' || !league.platformLeagueId) return null
    const sid = league.platformLeagueId

    const context = await withTimeout(getLeagueContext(sid), 3000)
    if (!context) return null

    const [values, grades, h2h] = await Promise.all([
      withTimeout(getMarketValues(context), 2500),
      withTimeout(getTradeGrades(sid), 3500),
      withTimeout(getLeagueH2H(sid), 3500),
    ])

    const lines: string[] = []
    const flags = [
      context.variant.idp ? `IDP (${context.scoring.idp.emphasis ?? 'balanced'} scoring)` : null,
      context.variant.superflex ? 'superflex' : null,
      context.variant.dynasty ? 'dynasty' : context.variant.keeper ? 'keeper' : 'redraft',
      context.variant.bestBall ? 'best ball' : null,
    ].filter(Boolean)
    lines.push(
      `League: "${context.name}" (${context.teams} teams, ${context.scoring.format.replace('_', '-')}), format: ${flags.join(', ')}.`,
    )
    if (context.houseRules.pirate?.active) {
      lines.push(
        'HOUSE RULE (declared): PIRATE league — every matchup winner steals a player from the loser. Weekly floor beats season ceiling; concentrated value is risk; weigh every roster/trade/draft answer accordingly.',
      )
    } else if (context.houseRules.pirate) {
      lines.push('Possible pirate house rule detected from the league name but NOT confirmed — do not assume it.')
    }
    if (values) {
      lines.push(
        `Trade values: use ${values.source}, ${values.mode} mode (${values.numQbs}QB, ${values.numTeams}-team, ${values.ppr} PPR). Draft picks have market values in dynasty mode. ${values.faab.formula}`,
      )
    }
    if (grades && grades.trades.length > 0) {
      const t = grades.trades[0]
      const sideSummary = t.sides
        .map((s) => `${s.managerName}: ${s.currentGrade} (net ${s.cumulativeNet > 0 ? '+' : ''}${s.cumulativeNet.toFixed(0)} pts)`)
        .join('; ')
      lines.push(
        `Graded trade ledger: ${grades.trades.length} completed trades since ${grades.seasonsScanned[0]}. Latest (${t.season} wk ${t.week}): ${sideSummary}${t.tie ? ' — currently a tie' : ''}. Grades = net points while assets were held.`,
      )
    }
    if (h2h) {
      const bits: string[] = []
      if (h2h.records.highestWeek) {
        const m = h2h.managers.find((x) => x.ownerId === h2h.records.highestWeek?.ownerId)
        bits.push(
          `highest week ever ${h2h.records.highestWeek.points.toFixed(1)} (${m?.name ?? 'manager'}, ${h2h.records.highestWeek.season} wk ${h2h.records.highestWeek.week})`,
        )
      }
      if (h2h.records.longestWinStreak) {
        const m = h2h.managers.find((x) => x.ownerId === h2h.records.longestWinStreak?.ownerId)
        bits.push(`longest win streak ${h2h.records.longestWinStreak.length} (${m?.name ?? 'manager'})`)
      }
      if (bits.length > 0) {
        lines.push(`History (${h2h.totalGames} matchups synced across ${h2h.seasons.length} seasons): ${bits.join('; ')}.`)
      }
    }
    lines.push(
      'These synced facts are the ONLY league-specific truths — cite them when relevant and never invent standings, trades, records, or values beyond them. If asked for something not listed here, say it is not synced yet.',
    )
    return lines.join('\n')
  } catch {
    return null // never break the chat turn
  }
}
