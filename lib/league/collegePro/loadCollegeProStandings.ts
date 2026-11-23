import 'server-only'
import { prisma } from '@/lib/prisma'
import { buildFranchiseStandings, type FranchiseStandingRow } from './franchiseStandings'
import { loadPairContext, readLeaguePair, resolveCollegeProPair } from './leaguePair'
import { readCollegeProScoring, type CollegeProScoring } from './format'

export type CollegeProStandingsPayload =
  | { applies: false }
  | {
      applies: true
      scoring: CollegeProScoring
      pro: { leagueId: string; name: string; sport: string }
      college: { leagueId: string; name: string; sport: string }
      rows: FranchiseStandingRow[]
      /** College teams no pro team is matched to: counted, so the page can say so rather than hide them. */
      unmatchedCollege: number
      /** How many rows were matched automatically rather than chosen by the commissioner. */
      autoMatched: number
    }

/**
 * The one-league standings for a paired college + pro league, for any manager of either half. Reads
 * stored rows only (League, LeagueTeam, the Fantrax snapshot): no provider call.
 */
export async function loadCollegeProStandings(leagueId: string, userId: string): Promise<CollegeProStandingsPayload> {
  // A manager of EITHER half may see it, the same rule as the combined roster page.
  const row = await prisma.league.findUnique({ where: { id: leagueId }, select: { id: true, userId: true, settings: true } })
  if (!row) return { applies: false }
  const pair = readLeaguePair(row.settings)
  const memberOf = (ids: string[]) =>
    prisma.league.count({ where: { id: { in: ids }, OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }] } })
  if ((await memberOf(pair ? [leagueId, pair.otherLeagueId] : [leagueId])) === 0) return { applies: false }

  let ctx = await loadPairContext(leagueId, userId)
  if (!ctx) {
    // A pair that still lives only on its owner's link becomes the league's when they open it.
    await resolveCollegeProPair(leagueId, userId, { includeOperationalSummary: false }).catch(() => null)
    ctx = await loadPairContext(leagueId, userId)
  }
  if (!ctx) return { applies: false }

  const leagues = await prisma.league.findMany({
    where: { id: { in: [ctx.pro.id, ctx.college.id] } },
    select: { id: true, name: true, sport: true },
  })
  const meta = (id: string) => leagues.find((l) => l.id === id)
  const standings = buildFranchiseStandings({ proTeams: ctx.proTeams, collegeTeams: ctx.collegeTeams, map: ctx.map, proKey: ctx.proKey })
  return {
    applies: true,
    scoring: readCollegeProScoring(ctx.pro.settings),
    pro: { leagueId: ctx.pro.id, name: meta(ctx.pro.id)?.name?.trim() || 'Pro league', sport: String(meta(ctx.pro.id)?.sport ?? '') },
    college: { leagueId: ctx.college.id, name: meta(ctx.college.id)?.name?.trim() || 'College league', sport: String(meta(ctx.college.id)?.sport ?? '') },
    rows: standings.rows,
    unmatchedCollege: standings.unmatchedCollege,
    autoMatched: standings.rows.filter((r) => r.collegeKey && ctx!.auto.includes(r.proKey)).length,
  }
}
