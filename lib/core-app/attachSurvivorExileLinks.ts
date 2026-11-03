import 'server-only'
import { prisma } from '@/lib/prisma'
import { normalizeSurvivorFoundationSettings } from '@/lib/survivor/survivorSettings'
import { exileRailStatus, type ExileRailStatus } from './survivorExileStatus'

/**
 * Marks each Exile Island league with the Survivor league it belongs to (`exileOf`), so the rail can
 * draw the two as one pair instead of two unrelated leagues. Exile Island is a League row of its own
 * (SurvivorExileEngine.getOrCreateExileLeague), named "Exile Island: <survivor name>", and on a rail
 * with two NBA Survivor leagues nothing said which island went with which.
 *
 * With `userId`, each island also gets `exileStatus`: the line its row shows in place of a matchup
 * (your tokens and the way back, or how many are out on the island).
 *
 * Read-only and best-effort: a failed read leaves the rail exactly as it was.
 */
export async function attachSurvivorExileLinks(
  leagues: Array<{ id: string; exileOf?: string; exileStatus?: ExileRailStatus }>,
  userId?: string,
): Promise<void> {
  if (leagues.length === 0) return
  let links: Array<{ mainLeagueId: string; exileLeagueId: string }>
  try {
    links = await prisma.survivorExileLeague.findMany({
      where: { exileLeagueId: { in: leagues.map((l) => l.id) } },
      select: { mainLeagueId: true, exileLeagueId: true },
    })
  } catch {
    return
  }
  const mainByExile = new Map(links.map((link) => [link.exileLeagueId, link.mainLeagueId]))
  for (const league of leagues) {
    const main = mainByExile.get(league.id)
    if (main) league.exileOf = main
  }
  if (!userId || links.length === 0) return
  const mainIds = [...new Set(links.map((link) => link.mainLeagueId))]
  let statusByMain: Map<string, ExileRailStatus>
  try {
    const [players, mains, returns] = await Promise.all([
      prisma.survivorPlayer.findMany({
        where: { leagueId: { in: mainIds }, OR: [{ userId }, { playerState: 'exile' }] },
        select: { leagueId: true, userId: true, playerState: true, tokenBalance: true },
      }),
      prisma.league.findMany({ where: { id: { in: mainIds } }, select: { id: true, settings: true } }),
      prisma.survivorAuditEntry.findMany({
        where: { leagueId: { in: mainIds }, action: 'scheduled_exile_return_resolved' },
        select: { leagueId: true },
      }),
    ])
    const resolved = new Set(returns.map((row) => row.leagueId))
    statusByMain = new Map(
      mains.map((league) => {
        const settings = normalizeSurvivorFoundationSettings(league.settings as Record<string, unknown> | null)
        const here = players.filter((player) => player.leagueId === league.id)
        return [
          league.id,
          exileRailStatus({
            viewer: here.find((player) => player.userId === userId) ?? null,
            onIsland: here.filter((player) => player.playerState === 'exile').length,
            exileIslandEnabled: settings.exileIslandEnabled,
            exileReturnWeek: settings.exileReturnWeek,
            exileReturnTokens: settings.exileReturnTokens,
            returnResolved: resolved.has(league.id),
          }),
        ]
      }),
    )
  } catch {
    return
  }
  for (const league of leagues) {
    const status = league.exileOf ? statusByMain.get(league.exileOf) : undefined
    if (status) league.exileStatus = status
  }
}
