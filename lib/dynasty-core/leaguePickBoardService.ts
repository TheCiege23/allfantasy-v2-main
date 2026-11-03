/**
 * Loads the league-wide future-pick board (`./leaguePickBoard.ts`) for a league member.
 *
 * The inventory is the one each kind of league already trades from, so the board can never show a
 * pick the Trade Center would not:
 *   - a dynasty league AllFantasy runs: `loadNativeFuturePicks` — every team's own pick in every
 *     upcoming rookie draft, moved where a trade moved it, forfeited picks gone;
 *   - an imported Sleeper or MFL league: `loadImportedFuturePicks` — the provider's traded picks over
 *     each team's own, or the traded picks alone when the league's draft size is unknown.
 * Any other league has no pick inventory to show, and says so rather than showing an empty board.
 *
 * DB-first: league, team and pick reads only. No provider call.
 */
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { matchTeamIdForRoster } from '@/lib/leagues/rosterTeamIdentity'
import { isNativeFuturePickLeague, loadNativeFuturePicks } from '@/lib/league-trade-engine/nativeFuturePicks'
import { hasSyncedProviderPicks, loadImportedFuturePicks } from '@/lib/league-trade-engine/importedFuturePicks'
import { buildLeaguePickBoard, type BoardPickInput, type LeaguePickBoard } from './leaguePickBoard'

export type LeaguePickBoardResult =
  | { ok: true; board: LeaguePickBoard; trade: PickBoardTradeContext }
  | { ok: true; board: null; reason: 'no_picks_tracked' }
  | { ok: false; status: 401 | 403 | 404; error: string }

/** What the "Propose a pick trade" entry needs to open the league's own trade builder honestly. */
export type PickBoardTradeContext = { platform: string | null; sport: string | null }

export async function loadLeaguePickBoard(leagueId: string, userId: string | null | undefined): Promise<LeaguePickBoardResult> {
  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' }
  const access = await resolveLeagueAccess(leagueId, userId)
  if (!access?.isMember) return { ok: false, status: 403, error: 'Forbidden' }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { platform: true, sport: true, leagueType: true, isDynasty: true, leagueVariant: true, season: true, settings: true },
  })
  if (!league) return { ok: false, status: 404, error: 'League not found' }

  const [rosters, teams] = await Promise.all([
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true, playerData: true } }),
    prisma.leagueTeam.findMany({
      where: { leagueId },
      select: { id: true, externalId: true, platformUserId: true, claimedByUserId: true, teamName: true, ownerName: true },
    }),
  ])
  const teamById = new Map(teams.map((t) => [t.id, t]))
  const boardTeams = rosters.map((r, i) => {
    const teamId = matchTeamIdForRoster(r, teams)
    const team = teamId ? teamById.get(teamId) : undefined
    return { rosterId: r.id, name: team?.teamName?.trim() || team?.ownerName?.trim() || `Team ${i + 1}` }
  })
  const viewerRosterId = rosters.find((r) => r.platformUserId === userId)?.id ?? null
  const trade: PickBoardTradeContext = { platform: league.platform ?? null, sport: league.sport != null ? String(league.sport) : null }

  if (isNativeFuturePickLeague(league)) {
    const inv = await loadNativeFuturePicks(leagueId)
    if (!inv) return { ok: true, board: null, reason: 'no_picks_tracked' }
    const picks: BoardPickInput[] = inv.picks.map((p) => ({ season: p.season, round: p.round, ownerRosterId: p.ownerTeamId, originalRosterId: p.originalTeamId }))
    return { ok: true, board: buildLeaguePickBoard({ teams: boardTeams, picks, seasons: inv.seasons, rounds: inv.rounds, coverage: 'complete', viewerRosterId }), trade }
  }

  if (hasSyncedProviderPicks(league.platform)) {
    const settings = league.settings && typeof league.settings === 'object' ? (league.settings as Record<string, unknown>) : {}
    const imported = await loadImportedFuturePicks({
      leagueId,
      platform: league.platform,
      isDynasty: Boolean(league.isDynasty),
      leagueSeason: league.season ?? null,
      status: typeof settings.status === 'string' ? settings.status : null,
      teams: teams.map((t) => ({ id: t.id, externalId: String(t.externalId ?? ''), platformUserId: t.platformUserId, claimedByUserId: t.claimedByUserId, teamName: t.teamName ?? null })),
      rosters,
    })
    if (imported.readFailed || imported.coverage === 'none') return { ok: true, board: null, reason: 'no_picks_tracked' }
    const picks: BoardPickInput[] = []
    for (const [ownerRosterId, list] of imported.picksByRosterId) {
      for (const p of list) {
        picks.push({ season: p.season, round: p.round, ownerRosterId, originalRosterId: imported.rosterIdByTeamId.get(p.originalTeamId) ?? p.originalTeamId })
      }
    }
    const seasons = [...new Set(picks.map((p) => p.season))].sort((a, b) => a - b)
    const rounds = picks.length ? Math.max(...picks.map((p) => p.round)) : null
    return {
      ok: true,
      board: buildLeaguePickBoard({ teams: boardTeams, picks, seasons, rounds: imported.coverage === 'complete' ? rounds : null, coverage: imported.coverage, viewerRosterId }),
      trade,
    }
  }

  return { ok: true, board: null, reason: 'no_picks_tracked' }
}
