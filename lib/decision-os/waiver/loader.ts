/**
 * Decision OS — route-seam data loader for `manager.waiver.claim` (Slice 2).
 *
 * The ONLY Decision-OS waiver module that touches prisma. It lives at the route seam (NOT the
 * decision layer) and loads the World facts the recommender input lacks: effective league waiver
 * settings + the user's unified Roster (FAAB remaining, waiver priority, roster size). READ-ONLY.
 * Returns null when the user has no roster in the league or settings can't resolve, so the shadow
 * path skips gracefully. Prisma access is injectable for tests.
 */
import { prisma } from '@/lib/prisma'
import { getEffectiveLeagueWaiverSettings } from '@/lib/waiver-wire/settings-service'
import { getRosterSize } from '@/lib/waiver-wire/roster-utils'
import type { WaiverSettingsFacts, WaiverWorldInput } from './world'

export interface WaiverWorldFacts {
  sport: string
  leagueId: string
  rosterId: string
  settings: WaiverSettingsFacts
  settingsKnown: boolean
  faabRemaining: number | null
  waiverPriority: number | null
  rosterSize: number
}

export interface WaiverLoaderDeps {
  loadEffectiveSettings: (leagueId: string) => Promise<{
    waiverType: string
    normalizedWaiverType: string
    faabBudget: number | null
    claimLimitPerPeriod: number | null
    claimLimitPerWeek: number | null
    maxDropsPerWeek: number | null
    lockType: string | null
  }>
  loadLeagueSport: (leagueId: string) => Promise<string | null>
  loadLinkedPlatformUserIds: (userId: string) => Promise<string[]>
  loadUserRoster: (leagueId: string, platformUserIds: string[]) => Promise<{ id: string; faabRemaining: number | null; waiverPriority: number | null; playerData: unknown } | null>
  /** Whether a settings DB row exists (vs sport/variant defaults) — drives settingsKnown honesty. */
  hasSettingsRow: (leagueId: string) => Promise<boolean>
}

export const defaultWaiverLoaderDeps: WaiverLoaderDeps = {
  loadEffectiveSettings: (leagueId) => getEffectiveLeagueWaiverSettings(leagueId),
  loadLeagueSport: async (leagueId) =>
    ((await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true } }))?.sport as string | undefined) ?? null,
  loadLinkedPlatformUserIds: async (userId) => {
    const profile = await prisma.userProfile.findUnique({
      where: { userId },
      select: { sleeperUserId: true },
    })
    return Array.from(
      new Set(
        [userId, profile?.sleeperUserId]
          .map((value) => String(value ?? '').trim())
          .filter(Boolean),
      ),
    )
  },
  loadUserRoster: async (leagueId, platformUserIds) =>
    (await (prisma as unknown as { roster: { findFirst: (a: unknown) => Promise<{ id: string; faabRemaining: number | null; waiverPriority: number | null; playerData: unknown } | null> } }).roster.findFirst({
      where: { leagueId, platformUserId: { in: platformUserIds } },
      select: { id: true, faabRemaining: true, waiverPriority: true, playerData: true },
    })),
  hasSettingsRow: async (leagueId) =>
    Boolean(await (prisma as unknown as { leagueWaiverSettings: { findUnique: (a: unknown) => Promise<unknown> } }).leagueWaiverSettings.findUnique({ where: { leagueId }, select: { leagueId: true } })),
}

/**
 * Load the World facts for a user's waiver decision in a league. Never throws — any miss returns null
 * and the caller (shadow) skips. READ-ONLY.
 */
export async function loadWaiverWorldFacts(
  userId: string,
  leagueId: string,
  deps: WaiverLoaderDeps = defaultWaiverLoaderDeps,
): Promise<WaiverWorldFacts | null> {
  try {
    const [settings, sport, platformUserIds, hasRow] = await Promise.all([
      deps.loadEffectiveSettings(leagueId),
      deps.loadLeagueSport(leagueId),
      deps.loadLinkedPlatformUserIds(userId),
      deps.hasSettingsRow(leagueId),
    ])
    if (platformUserIds.length === 0) return null
    const roster = await deps.loadUserRoster(leagueId, platformUserIds)
    if (!roster) return null
    return {
      sport: String(sport ?? 'NFL'),
      leagueId,
      rosterId: roster.id,
      settings: {
        waiverType: settings.waiverType,
        normalizedWaiverType: settings.normalizedWaiverType,
        faabBudget: settings.faabBudget,
        claimLimitPerPeriod: settings.claimLimitPerPeriod,
        claimLimitPerWeek: settings.claimLimitPerWeek,
        maxDropsPerWeek: settings.maxDropsPerWeek,
        lockType: settings.lockType,
      },
      settingsKnown: hasRow,
      faabRemaining: roster.faabRemaining ?? null,
      waiverPriority: roster.waiverPriority ?? null,
      rosterSize: getRosterSize(roster.playerData),
    }
  } catch {
    return null
  }
}

/** Shape loaded World facts into the World Resolution input (pure glue at the seam). */
export function worldInputFromFacts(facts: WaiverWorldFacts, nextProcessAtIso?: string | null): WaiverWorldInput {
  return {
    sport: facts.sport,
    leagueId: facts.leagueId,
    settings: facts.settings,
    settingsKnown: facts.settingsKnown,
    faabRemaining: facts.faabRemaining,
    waiverPriority: facts.waiverPriority,
    nextProcessAtIso: nextProcessAtIso ?? null,
  }
}
