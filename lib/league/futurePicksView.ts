import 'server-only'
import { prisma } from '@/lib/prisma'
import { loadLeaguePickBoard } from '@/lib/dynasty-core/leaguePickBoardService'
import type { LeaguePickBoard } from '@/lib/dynasty-core/leaguePickBoard'
import { matchTeamIdForRoster } from '@/lib/leagues/rosterTeamIdentity'
import { loadRookieOrderInput } from '@/lib/rookie-order/loadRookieOrderInput'
import { computeRookieOrder } from '@/lib/rookie-order/rookieOrderEngine'
import { leagueDraftOrderCarriesOver } from '@/lib/playoff-runtime/consolationPlaysFor'
import { readLiveRookieOrderSettings } from '@/lib/rookie-order/liveRookieOrderService'

/**
 * Everything the league page needs to show future draft picks (Team tab) and the projected rookie
 * pick (Standings), in one member-readable read:
 *
 * - `board`: every team's future picks — the existing league pick board (loadLeaguePickBoard), keyed
 *   by `Roster.id`.
 * - `ids`: each board team's `Roster.id` with its `LeagueTeam.id`, because imported standings rows are
 *   keyed by the team and the board by the roster (matchTeamIdForRoster is the one join rule).
 * - `projection`: next season's draft order from the existing engine (computeRookieOrder), only in a
 *   league whose order carries over. Each slot carries the engine's own status and reason, so a
 *   provisional slot never reads as settled.
 *
 * Read-only. No provider call, no AI call.
 */
export type FuturePicksTeamIds = { rosterId: string; teamId: string | null; name: string; isViewer: boolean }

export type ProjectedSlot = { slot: number; status: 'locked' | 'provisional'; reason: string; group: 'non_playoff' | 'playoff' }

export type FuturePicksView = {
  board: LeaguePickBoard | null
  ids: FuturePicksTeamIds[]
  projection: {
    /** The season whose draft the slots are for. */
    draftSeason: number
    phase: 'regular_season' | 'playoffs' | 'final'
    teamCount: number
    /** Keyed by the engine's team id: a `LeagueTeam.id` for imported leagues; match on either id. */
    slots: Record<string, ProjectedSlot>
    warnings: string[]
  } | null
}

export type FuturePicksViewResult =
  | { ok: true; view: FuturePicksView }
  | { ok: false; status: number; error: string }

export async function loadFuturePicksView(leagueId: string, userId: string | null | undefined): Promise<FuturePicksViewResult> {
  const boardResult = await loadLeaguePickBoard(leagueId, userId)
  if (!boardResult.ok) return { ok: false, status: boardResult.status, error: boardResult.error }
  const board = boardResult.board ?? null

  const [league, rosters, teams] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { leagueType: true, isDynasty: true, settings: true } }),
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true, playerData: true } }),
    prisma.leagueTeam.findMany({
      where: { leagueId },
      select: { id: true, externalId: true, platformUserId: true, claimedByUserId: true, teamName: true, ownerName: true },
    }),
  ])
  const rosterById = new Map(rosters.map((r) => [r.id, r]))
  const ids: FuturePicksTeamIds[] = (board?.teams ?? []).map((t) => {
    const roster = rosterById.get(t.rosterId)
    return { rosterId: t.rosterId, teamId: roster ? matchTeamIdForRoster(roster, teams) : null, name: t.name, isViewer: t.isViewer }
  })

  let projection: FuturePicksView['projection'] = null
  if (league && leagueDraftOrderCarriesOver(league)) {
    const loaded = await loadRookieOrderInput(leagueId).catch(() => null)
    if (loaded) {
      // The commissioner's configured ordering (or the default). The pure computation only — never
      // refreshLiveRookieOrder, which can SAVE a final order as a side effect.
      const result = computeRookieOrder({ ...loaded.input, config: readLiveRookieOrderSettings(league.settings).config })
      const slots: Record<string, ProjectedSlot> = {}
      for (const s of result.slots) slots[s.teamId] = { slot: s.slot, status: s.status, reason: s.reason, group: s.group }
      projection = {
        draftSeason: loaded.season + 1,
        phase: result.phase,
        teamCount: result.slots.length,
        slots,
        warnings: [...result.warnings, ...loaded.notes.filter((n): n is string => typeof n === 'string' && n.length > 0)],
      }
    }
  }

  return { ok: true, view: { board, ids, projection } }
}
