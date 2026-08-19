/**
 * Decision OS — route-seam data loader for `manager.lineup.set` (Slice 1 integration).
 *
 * This is the ONLY Decision-OS lineup module that touches prisma. It lives at the route seam (NOT
 * the decision layer) and loads the SAME league-scoped data the existing redraft roster route reads
 * (resolveRedraftRosterLookupReadOnly → redraftRoster.players + season; league.settings), shaping it
 * into a RunLineupSetInput. READ-ONLY — the shadow path must never transitively write, so identity
 * resolution uses the guaranteed write-free resolver (no owner repair). Returns null when the league
 * isn't a redraft league or data is unavailable, so the shadow path skips gracefully (and the canonical
 * fallback in ./canonicalBridge takes over). Prisma access is injectable for tests.
 */
import { prisma } from '@/lib/prisma'
import { resolveRedraftRosterLookupReadOnly } from '@/lib/redraft/redraftRosterIdentity'
import { getRosterTemplateForLeague } from '@/lib/multi-sport/MultiSportRosterService'
import { getFormatTypeForVariant } from '@/lib/sport-defaults/LeagueVariantRegistry'
import type { RedraftLineupPlayer } from '@/lib/redraft/lineupValidation'
import type { LineupValidationContext } from '@/lib/roster-lineup-engine/types'
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
  // Read-only identity resolution: the shadow lineup path must never transitively write (no owner
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
 * caller (shadow) skips. Mirrors the redraft roster route's reads exactly (no new query shapes).
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

// ── Canonical validator context (route seam) ───────────────────────────────────

export interface CanonicalContextLoaderDeps {
  /** Full league row (the canonical validator needs lifecycle/IR/taxi flags + settings + season). */
  loadLeague: (leagueId: string) => Promise<{
    id: string
    sport: LineupValidationContext['league']['sport']
    leagueVariant: string | null
    settings: LineupValidationContext['league']['settings']
    lifecycleState: LineupValidationContext['league']['lifecycleState']
    lockAllMoves: boolean | null
    irAllowOut: boolean | null
    irAllowCovid: boolean | null
    irAllowSuspended: boolean | null
    irAllowNA: boolean | null
    irAllowDNR: boolean | null
    irAllowDoubtful: boolean | null
    taxiSlots: number | null
    taxiAllowNonRookies: boolean | null
    taxiYearsLimit: number | null
    guillotineMode: boolean | null
    bestBallMode: boolean | null
    season: number
  } | null>
  /** Roster template resolution (same service the canonical validate route uses). */
  loadTemplate: (sport: string, formatType: string, leagueId: string) => Promise<LineupValidationContext['template']>
}

export const defaultCanonicalContextLoaderDeps: CanonicalContextLoaderDeps = {
  loadLeague: (leagueId) =>
    prisma.league.findUnique({ where: { id: leagueId } }) as unknown as ReturnType<CanonicalContextLoaderDeps['loadLeague']>,
  loadTemplate: (sport, formatType, leagueId) =>
    getRosterTemplateForLeague(sport as never, formatType, leagueId),
}

/**
 * Load the canonical validator's LineupValidationContext at the ROUTE SEAM (not the decision layer).
 * Mirrors app/api/leagues/[leagueId]/roster/lineup/validate exactly: full league row +
 * format-type-resolved roster template. READ-ONLY. Returns null on any miss (league absent or
 * template fails to resolve) so the shadow path skips validator parity gracefully and the legacy
 * response is never affected. Injectable for tests.
 */
export async function loadCanonicalValidatorContext(
  leagueId: string,
  week: number,
  deps: CanonicalContextLoaderDeps = defaultCanonicalContextLoaderDeps,
): Promise<LineupValidationContext | null> {
  try {
    const league = await deps.loadLeague(leagueId)
    if (!league) return null
    const sport = String(league.sport ?? 'NFL')
    const formatType = getFormatTypeForVariant(sport, league.leagueVariant ?? undefined)
    const template = await deps.loadTemplate(sport, formatType, leagueId)
    if (!template) return null
    return {
      league: {
        id: league.id,
        sport: league.sport,
        leagueVariant: league.leagueVariant,
        settings: league.settings,
        lifecycleState: league.lifecycleState,
        lockAllMoves: league.lockAllMoves,
        irAllowOut: league.irAllowOut,
        irAllowCovid: league.irAllowCovid,
        irAllowSuspended: league.irAllowSuspended,
        irAllowNA: league.irAllowNA,
        irAllowDNR: league.irAllowDNR,
        irAllowDoubtful: league.irAllowDoubtful,
        taxiSlots: league.taxiSlots,
        taxiAllowNonRookies: league.taxiAllowNonRookies,
        taxiYearsLimit: league.taxiYearsLimit,
        guillotineMode: league.guillotineMode,
        bestBallMode: league.bestBallMode,
      },
      template,
      season: league.season,
      week: Math.max(1, Number(week) || 1),
    }
  } catch {
    return null
  }
}
