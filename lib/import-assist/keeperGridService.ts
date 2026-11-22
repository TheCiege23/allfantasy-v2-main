import 'server-only'

import { prisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import { resolveKeeperRules } from '@/lib/keeper/keeperRules'
import { measureKeeperCostRule, type KeeperDraftPick } from '@/lib/keeper/importedKeeperCost'
import { rosterPlayerIds } from '@/lib/core-app/myRoster'
import { resolvePlayerNamesForSport } from '@/lib/roster/resolvePlayerNames'
import { buildKeeperGrid, keeperChecklist, type KeeperGrid } from './keeperGrid'

/**
 * Imported-league keeper grid — reads. Rules in ./keeperGrid.
 *
 * DB-first: `leagues`, `rosters`, `league_teams` and the imported draft history in `dw_draft_facts`
 * (Sleeper keeps its `is_keeper` flag in `metadata.isKeeper`). No provider is called.
 *
 * AF Commissioner (`commissioner_automation`), per the owner decision that imported-league tools are
 * part of the Commissioner plan (spec §6.3). The league is entitled when the head commissioner or the
 * viewer holds the plan — gate by league, not only by user (spec §5).
 */

export type ImportedKeeperGridView =
  | { applies: false; reason: 'not_found' | 'native' | 'not_keeper' }
  | { applies: true; locked: true; platform: string | null }
  | { applies: true; locked: false; platform: string | null; grid: KeeperGrid | null; steps: string[]; shareText: string; note: string | null }

async function entitled(userIds: readonly string[]): Promise<boolean> {
  const gate = new FeatureGateService()
  for (const id of [...new Set(userIds.filter(Boolean))]) {
    const access = await gate.evaluateUserFeatureAccess(id, 'commissioner_automation').catch(() => null)
    if (access?.allowed) return true
  }
  return false
}

export async function readImportedKeeperGrid(leagueId: string, viewerId: string): Promise<ImportedKeeperGridView> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      userId: true, platform: true, sport: true, leagueType: true, settings: true,
      keeperCostSystem: true, keeperRoundPenalty: true, keeperInflationRate: true, keeperConflictRule: true,
      keeperWaiverAllowed: true, keeperMaxYears: true,
    },
  })
  if (!league) return { applies: false, reason: 'not_found' }
  if (isNativePlatform(league.platform)) return { applies: false, reason: 'native' }
  if (String(league.leagueType ?? '').toLowerCase() !== 'keeper') return { applies: false, reason: 'not_keeper' }
  if (!(await entitled([league.userId, viewerId]))) return { applies: true, locked: true, platform: league.platform }

  const [facts, rosters, teams] = await Promise.all([
    prisma.draftFact.findMany({ where: { leagueId, season: { not: null } }, select: { playerId: true, season: true, round: true, metadata: true } }),
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true, playerData: true } }),
    prisma.leagueTeam.findMany({ where: { leagueId }, select: { externalId: true, teamName: true, ownerName: true } }),
  ])
  const picks: KeeperDraftPick[] = facts.map((r) => ({
    playerId: r.playerId,
    season: r.season as number,
    round: r.round,
    isKeeper: !!r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata) && (r.metadata as Record<string, unknown>).isKeeper === true,
  }))
  const teamByExternal = new Map(teams.map((t) => [t.externalId, t]))
  const gridTeams = rosters.map((r) => {
    const t = teamByExternal.get(r.platformUserId) ?? teamByExternal.get(r.id)
    return { teamId: r.id, name: t?.teamName?.trim() || t?.ownerName?.trim() || 'Team', playerIds: rosterPlayerIds(r.playerData) }
  })
  const names = await resolvePlayerNamesForSport(gridTeams.flatMap((t) => t.playerIds), String(league.sport), league.platform)
  const grid = buildKeeperGrid({
    rules: resolveKeeperRules(league),
    picks,
    measured: measureKeeperCostRule(picks),
    teams: gridTeams,
    names,
    waiverPickupsAllowed: league.keeperWaiverAllowed !== false,
    maxYears: league.keeperMaxYears != null && league.keeperMaxYears > 0 ? league.keeperMaxYears : null,
  })
  if (!grid) {
    return { applies: true, locked: false, platform: league.platform, grid: null, steps: [], shareText: '', note: 'No imported draft is on file for this league yet, so keeper costs cannot be worked out. They appear after the league’s draft history syncs.' }
  }
  const c = keeperChecklist(grid, league.platform)
  return { applies: true, locked: false, platform: league.platform, grid, steps: c.steps, shareText: c.shareText, note: null }
}
