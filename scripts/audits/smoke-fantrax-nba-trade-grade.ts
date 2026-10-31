/**
 * Read-only live-source smoke for the NBA points evaluator. Picks one source
 * backed player from each of two different public Fantrax teams. No user claim.
 *
 * node --env-file=.env.staging --require ./scripts/_audit-preload.cjs --import tsx \
 *   scripts/audits/smoke-fantrax-nba-trade-grade.ts 51isdapqmt6atvdz
 */
import { prisma } from '@/lib/prisma'
import { loadNbaPointsTradeEvaluation } from '@/lib/trades/nbaPointsTradeEvaluation'
import { fantraxScoringRules } from '@/lib/league-import/fantrax/fantraxScoring'
import type { FantraxLeagueInfo } from '@/lib/league-import/fantrax/fantraxApi'
import type { TradeLeagueContext } from '@/lib/trades/loadTradeLeagueContext'
import targetGuard from '../db-target-identity.cjs'

type Roster = { rosterItems?: Array<{ id: string }> }

async function fantraxJson(path: string): Promise<any> {
  const response = await fetch(`https://www.fantrax.com/fxea/general/${path}`, {
    signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) throw new Error('FANTRAX_HTTP_ERROR')
  return response.json()
}

async function main() {
  const leagueId = process.argv[2]
  if (!/^[a-z0-9]{16}$/.test(leagueId ?? '')) throw new Error('INVALID_LEAGUE_ID')
  if (targetGuard.identifyTarget(process.env.DIRECT_URL || process.env.DATABASE_URL).label !== 'staging') {
    throw new Error('STAGING_DATABASE_REQUIRED')
  }
  const [info, rosterPayload, directory] = await Promise.all([
    fantraxJson(`getLeagueInfo?leagueId=${leagueId}`),
    fantraxJson(`getTeamRosters?leagueId=${leagueId}`),
    fantraxJson('getPlayerIds?sport=NBA'),
  ])
  const mapped = fantraxScoringRules(info as FantraxLeagueInfo, 'nba')
  if (mapped.gaps.length || mapped.rules.length === 0) throw new Error('SCORING_RULES_UNAVAILABLE')
  const scoringRules = Object.fromEntries(mapped.rules.map((rule) => [rule.stat_key, rule.points_value]))
  const rosters = (rosterPayload.rosters ?? rosterPayload) as Record<string, Roster>
  const ids = [...new Set(Object.values(rosters).flatMap((team) =>
    (team.rosterItems ?? []).map((item) => String(item.id))))]
  const identities = await prisma.playerIdentityMap.findMany({ where: { sport: 'NBA', fantraxId: { in: ids } },
    select: { fantraxId: true } })
  const linked = new Set(identities.map((identity) => identity.fantraxId))
  const selections = Object.entries(rosters).flatMap(([teamId, team]) =>
    (team.rosterItems ?? []).filter((item) => linked.has(item.id) && directory[item.id]?.name)
      .slice(0, 1).map((item) => ({ teamId, playerId: item.id, name: directory[item.id].name as string })))
  if (selections.length < 2) throw new Error('TOO_FEW_LINKED_TEAMS')
  const result = await loadNbaPointsTradeEvaluation({
    league: { scoringRules } as TradeLeagueContext,
    senderGives: [{ name: selections[0]!.name, playerId: selections[0]!.playerId }],
    receiverGives: [{ name: selections[1]!.name, playerId: selections[1]!.playerId }],
  })
  console.log(JSON.stringify(result.ok
    ? { target: 'staging', readOnly: true, ok: true, teamCount: Object.keys(rosters).length,
      scoringRules: Object.keys(scoringRules).length, senderTotal: result.senderTotal,
      receiverTotal: result.receiverTotal, currentSeasons: [result.senderGives[0]?.currentSeason,
        result.receiverGives[0]?.currentSeason], coverageWarnings: result.coverage.length }
    : { target: 'staging', readOnly: true, ok: false, code: result.code,
      missingPlayerCount: result.players.length }, null, 2))
  if (!result.ok) process.exitCode = 1
}

main().catch((error) => {
  console.error(JSON.stringify({ failed: true, code: error?.code || error?.message || 'SMOKE_FAILED' }))
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
