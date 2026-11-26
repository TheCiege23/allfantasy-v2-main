import 'server-only'

/**
 * League-intelligence grounding for Chimmy — mirrors the G15.10 commissioner
 * grounding pattern: NEVER throws, returns null on any miss, additive-only.
 *
 * When a chat turn carries a leagueId (Sleeper-imported league), this builds a
 * compact, factual brief from the SAME engines the league dashboard renders:
 *  - LeagueContext envelope (variant, scoring, IDP emphasis, pirate house rule)
 *  - THE league trade grade's chart (`createLeagueTradeGrader`) as the trade-value basis
 *  - Completed trade ledger summary, the latest trade graded by THE one grader
 *    (`oneGradeForCompletedTrade`, its frozen original when one is stored) — 2026-11-26
 *  - H2H records highlights
 *
 * Every sub-fetch is bounded by a short timeout so a cold cache can never
 * stall a chat turn — whatever resolves in time is included; the rest is
 * simply absent. The brief instructs the model to treat these as the ONLY
 * league facts and not to invent beyond them.
 */

import { prisma } from '@/lib/prisma'
import { getLeagueContext } from '@/lib/league-context/leagueContextService'
import { getTradeGrades } from '@/lib/trade-intel/sleeperTradeGradeService'
import { createLeagueTradeGrader, type LeagueTradeGrader } from '@/lib/decision-os/trade/leagueTradeGrader'
import { oneGradeForCompletedTrade } from '@/lib/decision-os/trade/completedTradeGrade'
import { loadFrozenCompletedGrades } from '@/lib/decision-os/trade/frozenCompletedGrade'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import { getLeagueH2H } from '@/lib/league-history/sleeperH2HService'
import { isLeagueConceptType, leagueConceptLabel, resolveLeagueConcept } from '@/lib/league/leagueConceptOptions'
import { getConceptById } from '@/lib/league-rules/conceptCatalog'
import { parseStandingsDivisions } from '@/lib/league-import/standingsDivisions'

/**
 * The league's named team groups (provider divisions), with the teams in each.
 *
 * ⚠ NOTHING IN CHIMMY READ THESE. `settings.standings_divisions` has been stored since 2026-09-17 and
 * the /core standings screen groups by it, but the grounding packet listed no team at all
 * ("standings: 20 items (not itemised here)"). So "which teams are New Era?" had no answer in any
 * context the model saw, although the league had been synced with exactly that split.
 *
 * ⚠ A DIVISION IS WHAT THE PROVIDER SAYS, AS OF THE LAST SYNC. In a survivor-style format the
 * commissioner usually runs the tribes as divisions, but tribes are reshuffled mid-season, and the
 * split is only as current as whoever last edited it on the host. The line says both.
 */
async function describeLeagueGroups(leagueId: string, settings: unknown, concept: unknown): Promise<string | null> {
  const divisions = parseStandingsDivisions(settings)
  if (!divisions) return null
  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId },
    select: { externalId: true, teamName: true, ownerName: true },
  })
  const members = new Map<string, string[]>()
  for (const t of teams) {
    const key = divisions.teams[t.externalId]
    if (!key) continue
    const owner = t.ownerName && t.ownerName !== 'Unknown' ? t.ownerName : null
    const label = t.teamName && t.teamName !== 'Unknown'
      ? (owner && owner !== t.teamName ? `${t.teamName} (${owner})` : t.teamName)
      : owner ?? `roster ${t.externalId}, owner not on file`
    members.set(key, [...(members.get(key) ?? []), label])
  }
  if (members.size < 2) return null
  const survivorStyle = typeof concept === 'string' && /survivor/.test(concept)
  const groups = [...members.entries()]
    .map(([key, names]) => `${divisions.names[key] ?? `Division ${key}`} (${names.length}): ${names.join(', ')}`)
    .join('. ')
  return `Team groups, from the league's ${divisions.source === 'sleeper' ? 'Sleeper' : 'ESPN'} divisions as of the last sync: ${groups}.${
    survivorStyle
      ? ' In a survivor-style league these divisions are usually the tribes. Tribes are reshuffled during the season, so present this as the last synced split, which may predate a shuffle.'
      : ''
  }`
}

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
      select: { name: true, platform: true, platformLeagueId: true, leagueType: true, settings: true },
    })
    if (!league || league.platform !== 'sleeper' || !league.platformLeagueId) return null
    const sid = league.platformLeagueId

    const context = await withTimeout(getLeagueContext(sid), 3000)
    if (!context) return null

    /*
     * 🛑 ONE GRADER (2026-11-26). The value basis and the latest trade's letter are THE grade's — the
     * league chart and AllFantasy market every trade screen prices on — never `marketValueService`'s
     * own board or the ledger's points-while-held letter. Membership was proven by the query above.
     * The ledger (`getTradeGrades`) supplies the completed trades themselves: who, when, what moved.
     */
    const [grader, grades, h2h] = await Promise.all([
      withTimeout<LeagueTradeGrader>(createLeagueTradeGrader({ leagueId, userId }), 3000),
      withTimeout(getTradeGrades(sid), 3500),
      withTimeout(getLeagueH2H(sid), 3500),
    ])
    const latestTrade = grades?.trades[0] ?? null
    const latestGrade: TradeGradeView | null =
      latestTrade && grader
        ? await withTimeout<TradeGradeView>(
            (async () => {
              const frozen = await loadFrozenCompletedGrades(leagueId, [latestTrade.id]).catch(() => new Map())
              return oneGradeForCompletedTrade(leagueId, latestTrade, Number(context.season) || new Date().getUTCFullYear(), {
                graderFor: async () => grader,
                frozen,
              })
            })(),
            2500,
          )
        : null

    const lines: string[] = []
    const leagueConcept = resolveLeagueConcept(league.settings, league.leagueType)
    const flags = [
      context.variant.idp ? `IDP (${context.scoring.idp.emphasis ?? 'balanced'} scoring)` : null,
      context.variant.superflex ? 'superflex' : null,
      context.variant.dynasty ? 'dynasty' : context.variant.keeper ? 'keeper' : 'redraft',
      context.variant.bestBall ? 'best ball' : null,
    ].filter(Boolean)
    lines.push(
      `League: "${context.name}" (${context.teams} teams, ${context.scoring.format.replace('_', '-')}), format: ${flags.join(', ')}.`,
    )
    if (isLeagueConceptType(leagueConcept)) {
      lines.push(
        `AllFantasy league concept: ${leagueConceptLabel(leagueConcept)}. Use this concept when reasoning about roster horizon, trade value, elimination risk, and league-specific strategy.`,
      )
      /*
       * ⚠ THE LABEL ALONE TOLD THE MODEL NOTHING. Asked about the "New Era" and "Old School" tribes of
       * a confirmed Survivor All-Stars Guillotine league (2026-09-28), Chimmy said "guillotine as a
       * format has no factions". It had the name of the format and none of its rules. The catalog
       * entry's own summary, and any action the format forbids, go in with it.
       */
      const entry = getConceptById(leagueConcept)
      if (entry) {
        const banned = entry.actions.filter((a) => a.legalInFormat === false).map((a) => `${a.label}${a.note ? ` (${a.note})` : ''}`)
        lines.push(`What ${entry.label} means: ${entry.summary}${banned.length ? ` Not part of this format: ${banned.join('; ')}.` : ''}`)
      }
    }
    const groups = await withTimeout(describeLeagueGroups(leagueId, league.settings, leagueConcept), 1500)
    if (groups) lines.push(groups)
    if (context.houseRules.pirate?.active) {
      lines.push(
        'HOUSE RULE (declared): PIRATE league — every matchup winner steals a player from the loser. Weekly floor beats season ceiling; concentrated value is risk; weigh every roster/trade/draft answer accordingly.',
      )
    } else if (context.houseRules.pirate) {
      lines.push('Possible pirate house rule detected from the league name but NOT confirmed — do not assume it.')
    }
    if (grader) {
      const c = grader.chart
      lines.push(
        `Trade values: this league's AllFantasy trade grade — the league chart (${c.chartIsDynasty ? 'dynasty' : 'redraft'}, ${c.isSuperFlex ? 'superflex' : '1QB'}, ${c.leagueSize}-team, ${c.pprNfl} PPR) and AllFantasy market every trade letter in the app is priced on. For a value or a grade on a specific deal, use the evaluate_trade tool; never quote a trade value from general knowledge.`,
      )
    }
    if (grades && latestTrade) {
      const t = latestTrade
      /*
       * 🛑 THE LETTER IS THE ONE GRADER'S, OR THERE IS NONE. The ledger's own "points while held" letter
       * (`currentGrade`) is a second scale — a 0-net trade read as a C "tie" for every side, which is why
       * `hasNoSignal` existed. THE grade is on league value (sides[0] sends its `give`); a withheld grade
       * publishes its reason, never a neutral letter standing in for missing data.
       */
      const names = t.sides.map((s) => s.managerName)
      const latest =
        latestGrade?.graded && t.sides.length === 2
          ? `Latest (${t.season} wk ${t.week}): ${names[0]}: ${latestGrade.letter}; ${names[1]}: ${latestGrade.partnerLetter} — ${latestGrade.label} (league trade grade on this league's chart).`
          : `Latest (${t.season} wk ${t.week}): ${names.join(' / ')} — not graded${latestGrade && !latestGrade.graded ? `: ${latestGrade.reason.replace(/\.$/, '')}` : ': the league trade grade could not be read just now'}. Do not call it even, close, or a win for either side.`
      lines.push(`Completed trade ledger: ${grades.trades.length} completed trades since ${grades.seasonsScanned[0]}. ${latest}`)
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
