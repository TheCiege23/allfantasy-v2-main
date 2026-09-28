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
import { myRosterCandidates } from '@/lib/core-app/myRoster'
import { resolveRostersForTeams } from '@/lib/leagues/rosterTeamIdentity'
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
  /**
   * The roster behind the team this user CLAIMED — tried only when `loadUserRoster` found nothing.
   *
   * 🛑 WHY: `loadUserRoster` matches `Roster.platformUserId` against the app user id and the linked
   * Sleeper id, and nothing else. A Fantrax or MFL roster is keyed on the provider's own manager id
   * (or an `orphan-<provider>-<teamId>` key), so for those leagues the waiver shadow skipped every
   * manager as "no roster". The canonical join — claimed `LeagueTeam` → `myRosterCandidates` →
   * `playerData.source_team_id` — lives in lib/core-app/myRoster.ts and rosterTeamIdentity.ts;
   * this reuses it rather than growing a third copy. Optional so injected test deps stay pure.
   */
  loadClaimedTeamRoster?: (leagueId: string, userId: string) => Promise<WaiverRosterRow | null>
}

type WaiverRosterRow = { id: string; faabRemaining: number | null; waiverPriority: number | null; playerData: unknown }

type ClaimedRosterDb = {
  leagueTeam: {
    findFirst: (a: unknown) => Promise<{ platformUserId: string | null; externalId: string | null } | null>
  }
  roster: {
    findFirst: (a: unknown) => Promise<WaiverRosterRow | null>
    findMany: (a: unknown) => Promise<Array<WaiverRosterRow & { platformUserId: string | null }>>
  }
}

/** Claimed team → its roster, by the same rule every "my team" surface uses. READ-ONLY. */
export async function loadClaimedTeamRosterFrom(
  db: ClaimedRosterDb,
  leagueId: string,
  userId: string,
): Promise<WaiverRosterRow | null> {
  const team = await db.leagueTeam.findFirst({
    where: { leagueId, claimedByUserId: userId },
    select: { platformUserId: true, externalId: true },
  })
  if (!team) return null
  const select = { id: true, faabRemaining: true, waiverPriority: true, playerData: true }
  const candidates = myRosterCandidates(team, userId)
  if (candidates.length > 0) {
    const byKey = await db.roster.findFirst({ where: { leagueId, platformUserId: { in: candidates } }, select })
    if (byKey) return byKey
  }
  // A roster under a key nobody can name (orphan-…): find it by the team's own id.
  const rosters = await db.roster.findMany({ where: { leagueId }, select: { ...select, platformUserId: true } })
  const mine = team.externalId
    ? resolveRostersForTeams([team], rosters, (t) => myRosterCandidates(t, userId)).get(team.externalId)
    : undefined
  return mine ? { id: mine.id, faabRemaining: mine.faabRemaining, waiverPriority: mine.waiverPriority, playerData: mine.playerData } : null
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
  loadClaimedTeamRoster: (leagueId, userId) =>
    loadClaimedTeamRosterFrom(prisma as unknown as ClaimedRosterDb, leagueId, userId),
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
    const roster =
      (platformUserIds.length > 0 ? await deps.loadUserRoster(leagueId, platformUserIds) : null) ??
      (deps.loadClaimedTeamRoster ? await deps.loadClaimedTeamRoster(leagueId, userId) : null)
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
