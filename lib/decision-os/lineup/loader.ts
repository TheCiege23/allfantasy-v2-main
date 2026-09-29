/**
 * Decision OS — route-seam data loader for `manager.lineup.set` (Slice 1 integration).
 *
 * This is the ONLY Decision-OS lineup module that touches prisma. It lives at the route seam (NOT
 * the decision layer) and loads the SAME league-scoped data the existing redraft roster route reads
 * (resolveRedraftRosterLookupReadOnly → redraftRoster.players + season; league.settings), shaping it
 * into a RunLineupSetInput. READ-ONLY — a grounding read must never transitively write, so identity
 * resolution uses the guaranteed write-free resolver (no owner repair). Returns null when the league
 * isn't a redraft league or data is unavailable, so the caller (`grounding/decisionBridge`) reports an
 * honest gap. Prisma access is injectable for tests.
 *
 * The canonical-validator context loader that used to live below was deleted 2026-09-29 with the
 * lineup shadow runner, its only caller.
 */
import { prisma } from '@/lib/prisma'
import { resolveRedraftRosterLookupReadOnly } from '@/lib/redraft/redraftRosterIdentity'
import type { RedraftLineupPlayer } from '@/lib/redraft/lineupValidation'
import type { RunLineupSetInput } from './index'

interface LoadedRoster {
  id: string
  leagueId: string
  players: RedraftLineupPlayer[]
  season: { sport: string; season: number; currentWeek?: number | null; totalWeeks?: number | null }
}

export interface LineupLoaderDeps {
  lookup: (args: { userId: string; leagueId: string }) => Promise<{ season: { leagueId: string } | null; roster: { id: string } | null }>
  loadRoster: (rosterId: string) => Promise<LoadedRoster | null>
  loadLeagueSettings: (leagueId: string) => Promise<unknown>
}

export const defaultLineupLoaderDeps: LineupLoaderDeps = {
  // Read-only identity resolution: the grounding read must never transitively write (no owner
  // repair). See lib/redraft/redraftRosterIdentity.ts — resolveRedraftRosterLookupReadOnly shares the
  // lookup core with the legacy write-capable resolver but layers no `redraftRoster.update` on top.
  lookup: (args) => resolveRedraftRosterLookupReadOnly({ userId: args.userId, leagueId: args.leagueId }),
  loadRoster: async (rosterId) =>
    (await prisma.redraftRoster.findFirst({ where: { id: rosterId }, include: { players: true, season: true } })) as unknown as LoadedRoster | null,
  loadLeagueSettings: async (leagueId) =>
    (await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } }))?.settings ?? null,
}

/**
 * Build the league-scoped RunLineupSetInput for a user. Never throws — any miss returns null and the
 * caller reports a gap. Mirrors the redraft roster route's reads exactly (no new query shapes).
 */
export async function loadLineupSetInputs(
  userId: string,
  leagueId: string,
  deps: LineupLoaderDeps = defaultLineupLoaderDeps,
): Promise<RunLineupSetInput | null> {
  try {
    const lookup = await deps.lookup({ userId, leagueId })
    if (!lookup.season || !lookup.roster) return null
    const roster = await deps.loadRoster(lookup.roster.id)
    if (!roster) return null
    const settings = await deps.loadLeagueSettings(roster.leagueId)
    const week = Math.max(1, Number(roster.season?.currentWeek ?? 1) || 1)
    return {
      sport: String(roster.season?.sport ?? 'NFL'),
      leagueSettings: settings,
      leagueWeek: week,
      editingWeek: week,
      userId,
      leagueId: roster.leagueId,
      rosterId: roster.id,
      players: (roster.players ?? []) as RedraftLineupPlayer[],
    }
  } catch {
    return null
  }
}
