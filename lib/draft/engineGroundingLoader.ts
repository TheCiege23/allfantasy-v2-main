import 'server-only'

import { prisma } from '@/lib/prisma'
import { parseSessionKey } from '@/lib/draft/session-key'
import { loadSleeperAdpBoard, MAX_BOARD_SIZE } from '@/lib/draft/sleeperDraftBoard'
import type { RecommendationPlayer } from '@/lib/draft-helper/RecommendationEngine'
import { runEngineForGrounding, unavailableGrounding, type DraftEngineGrounding } from './engineGrounding'
import { loadWarmPoolProjections, resolveDraftScoringWindow } from '@/lib/shared-services/draft/DraftContextAssembler'
import { projectionKey } from '@/lib/draft-room/poolProjections'
import { resolveTeamByeWeeks } from '@/lib/schedule/teamByeWeeks'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

/**
 * Load what Chimmy's draft tips are grounded in, for one draft-room session and one user.
 *
 * Reads the SAME three things the room itself drafts from, so the engine sees exactly the board the
 * user sees:
 *   - `DraftRoomStateRow` for the team count (the room's own row, keyed by the session key);
 *   - `DraftRoomPickRecord` for every pick so far — taken players leave the pool, and the rows this
 *     user owns (`currentOwnerId`, the pick-order id `executeDraftPick` writes) are their roster;
 *   - `loadSleeperAdpBoard`, the consensus-ADP board `/api/draft/players` and the CPU drafter use.
 *     It is NFL-only today, so other sports get the honest "unavailable" grounding.
 *
 * Never throws: any failure returns the unavailable grounding, and the tip still runs, told to make
 * no availability claims. All reads are Postgres (the ADP board is DB-backed), no provider calls.
 */
export async function loadDraftEngineGrounding(args: {
  sessionId: unknown
  userId: string
  sport?: string | null
}): Promise<DraftEngineGrounding> {
  try {
    const sessionId = typeof args.sessionId === 'string' ? args.sessionId.trim() : ''
    if (!sessionId) return unavailableGrounding()
    const sport = (args.sport ?? 'NFL').toUpperCase()
    if (sport !== 'NFL') return unavailableGrounding()

    const parsed = parseSessionKey(sessionId)
    const where = parsed.mode === 'mock' ? { roomId: parsed.id } : { leagueId: parsed.id }

    const [state, picks, board] = await Promise.all([
      prisma.draftRoomStateRow.findUnique({ where: { id: sessionId }, select: { numTeams: true } }),
      prisma.draftRoomPickRecord.findMany({
        where,
        select: { playerId: true, playerName: true, position: true, team: true, currentOwnerId: true },
        orderBy: { overallPick: 'asc' },
      }),
      loadSleeperAdpBoard({ sport, take: MAX_BOARD_SIZE }),
    ])
    if (!state || !board || board.length === 0) return unavailableGrounding()

    // A league draft (live:<leagueId>) knows its scoring window and season; a mock room does not.
    const [scoringWindow, byeByTeam, projections] =
      parsed.mode === 'live'
        ? await Promise.all([
            resolveDraftScoringWindow(parsed.id),
            prisma.league
              .findUnique({ where: { id: parsed.id }, select: { season: true } })
              .then((l) => resolveTeamByeWeeks('NFL', l?.season))
              .catch(() => new Map<string, number>()),
            // The league's warm draft pool, so replacement value runs in Chimmy's tips too.
            loadWarmPoolProjections(parsed.id),
          ])
        : [null, new Map<string, number>(), new Map<string, number>()]
    const byeFor = (team: string | null | undefined): number | null =>
      team ? byeByTeam.get(normalizeTeamAbbrev(team) ?? team.toUpperCase()) ?? null : null

    const takenIds = new Set(picks.map((p) => p.playerId).filter((id): id is string => Boolean(id)))
    const takenNames = new Set(picks.map((p) => p.playerName?.trim().toLowerCase()).filter((n): n is string => Boolean(n)))
    const available: RecommendationPlayer[] = board
      .filter((p) => !takenIds.has(p.id) && !takenNames.has(p.name.trim().toLowerCase()))
      .map((p) => ({
        name: p.name,
        position: p.position,
        team: p.team || null,
        adp: p.adp,
        byeWeek: byeFor(p.team),
        projectedPoints: projections.get(projectionKey(p.name, p.position)) ?? null,
      }))

    const teamRoster = picks
      .filter((p) => p.currentOwnerId === args.userId && p.position)
      .map((p) => ({ position: p.position as string, team: p.team ?? null, byeWeek: byeFor(p.team) }))

    return runEngineForGrounding({
      available,
      teamRoster,
      overallPick: picks.length + 1,
      totalTeams: Math.max(2, state.numTeams || 12),
      sport,
      scoringWindow,
      recentPickPositions: picks.map((p) => p.position ?? '').filter(Boolean).slice(-16),
    })
  } catch (error) {
    console.warn('[draft-ai] engine grounding unavailable', error instanceof Error ? error.message : error)
    return unavailableGrounding()
  }
}
