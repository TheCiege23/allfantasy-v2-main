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

/**
 * The LEAGUE half of {@link WaiverWorldFacts}, derivable without a user.
 *
 * 🛑 WHY THIS EXISTS: `waiverSettingsSource` IS DECLARED `level: 'league'` AND COULD NOT BE
 * DERIVED AT THE LEAGUE LEVEL. Both Waiver OS sources shared `loadWaiverWorldFacts`, which needs
 * a `userId` and returns that manager's FAAB and priority. So a scheduler had no way to warm the
 * league entry without inventing a user and then storing ONE MANAGER'S PRIVATE RESOURCES UNDER A
 * LEAGUE-SCOPED KEY — which is the read-side failure `waiver-os/index.ts` warns about ("tell
 * someone they can afford a bid they cannot"), reached from the write side.
 *
 * ⚠ AND IT WAS NOT ONLY A SCHEDULING PROBLEM. `loadWaiverWorldFacts` returns null when the user
 * has no roster in the league, so the league-level fact was underivable for a commissioner tool,
 * an admin view, or any caller who is not a member. League settings do not depend on who is
 * asking; this loader does not ask.
 */
export interface WaiverLeagueFacts {
  sport: string
  leagueId: string
  settings: WaiverSettingsFacts
  /** False when the league has no settings row and the values above are sport/variant defaults. */
  settingsKnown: boolean
}

/**
 * Derive the league-shaped waiver facts. Three of the five deps, and no user.
 *
 * Returns null rather than throwing, per the `OsFactSource.derive` contract — and null here means
 * "could not derive", never "no waivers", which is why the caller must not flatten it to a default.
 */
export async function loadWaiverLeagueFacts(
  leagueId: string,
  deps: WaiverLoaderDeps = defaultWaiverLoaderDeps,
): Promise<WaiverLeagueFacts | null> {
  try {
    const [settings, sport, hasRow] = await Promise.all([
      deps.loadEffectiveSettings(leagueId),
      deps.loadLeagueSport(leagueId),
      deps.hasSettingsRow(leagueId),
    ])
    return {
      sport: String(sport ?? 'NFL'),
      leagueId,
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
