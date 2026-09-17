/**
 * After creating a League from any normalized import, populates LeagueTeam, Roster,
 * and TeamPerformance from NormalizedImportResult. Uses imported data directly.
 */

import { prisma } from '@/lib/prisma'
import type { NormalizedImportResult } from '../types'
import { importedRosterOwnerKey, planImportedRosterWrites } from '../importedRosterIdentity'

export interface SleeperLeagueBootstrapResult {
  leagueTeamsCreated: number
  rostersCreated: number
  /**
   * Teams skipped because their provider roster fetch FAILED, so the stored roster was
   * kept rather than overwritten with an empty placeholder (IMP-04). Non-zero means this
   * league is NOT fully current and must not be reported as such.
   */
  rostersPreserved?: number
  teamPerformancesCreated: number
  /** Rows moved to their team's current owner key (an owner change, or an orphan's own key). */
  rostersRekeyed?: number
  /** Extra rows bound to a team this import wrote — left in place; removing them is a data decision. */
  rosterDuplicateRows?: number
  /** Teams whose owner key is held by a row this import does not move (see `importedRosterIdentity`). */
  rosterKeyConflicts?: number
}

async function resolveImportedManagerUserIds(
  provider: string,
  sourceManagerIds: string[]
): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(sourceManagerIds.filter(Boolean)))
  const resolved = new Map<string, string>()

  if (!uniqueIds.length) return resolved

  if (provider === 'sleeper') {
    const [usersByUsername, profilesBySleeperId] = await Promise.all([
      prisma.appUser.findMany({
        where: {
          username: { in: uniqueIds.map((id) => `sleeper_${id}`) },
        },
        select: {
          id: true,
          username: true,
        },
      }),
      prisma.userProfile.findMany({
        where: {
          sleeperUserId: { in: uniqueIds },
        },
        select: {
          userId: true,
          sleeperUserId: true,
        },
      }),
    ])

    for (const user of usersByUsername) {
      if (!user.username.startsWith('sleeper_')) continue
      const sleeperId = user.username.slice('sleeper_'.length)
      if (sleeperId) {
        resolved.set(sleeperId, user.id)
      }
    }

    for (const profile of profilesBySleeperId) {
      if (profile.sleeperUserId) {
        resolved.set(profile.sleeperUserId, profile.userId)
      }
    }
  }

  return resolved
}

/**
 * Create LeagueTeam and Roster records for each normalized roster; also create
 * TeamPerformance from schedule. Call after League record exists.
 */
export async function bootstrapLeagueFromNormalizedImport(
  leagueId: string,
  normalized: NormalizedImportResult,
  /**
   * The person doing the import, and which manager they are on the source
   * platform.
   *
   * ⚠ WITHOUT THIS, NO NON-SLEEPER IMPORT HAS EVER CLAIMED A TEAM.
   * `resolveImportedManagerUserIds` only knows how to map Sleeper manager ids to
   * AllFantasy accounts — there is no equivalent linkage for an ESPN member id, a
   * Yahoo guid or a Fantrax team. So every ESPN, Yahoo, Fantrax, MFL and
   * Fleaflicker league landed with `claimedByUserId` null on every row, and three
   * surfaces are gated on that claim: `/core/portfolio` lists only leagues where
   * the viewer has claimed a team, the Matchup Center 404s without one, and the
   * Trade Center's counterparty layer never runs. The league imported perfectly
   * and was invisible.
   *
   * The commissioner gate already resolves this — it has to, to decide whether
   * the caller may import at all. `checkEspn` returns the viewer's team, and the
   * value was simply dropped between there and here.
   */
  importer?: { userId: string; sourceManagerId?: string | null } | null,
): Promise<SleeperLeagueBootstrapResult> {
  const standingsByTeam = new Map(
    normalized.standings.map((s) => [s.source_team_id, s])
  )
  const season = normalized.league.season ?? new Date().getFullYear()
  const managerUserIds = await resolveImportedManagerUserIds(
    normalized.source.source_provider,
    normalized.rosters.map((r) => r.source_manager_id)
  )

  /*
   * ⚠ ONE TEAM, AND ONLY THE IMPORTER'S OWN. Every other manager in the league
   * is a stranger to us — there is no linkage from their platform id to an
   * AllFantasy account, and inventing one would hand someone else's team to
   * whoever imported the league.
   *
   * Does NOT overwrite a mapping the resolver already made: on Sleeper the
   * resolver is authoritative and knows more than this hint does.
   */
  const importerManagerId = importer?.sourceManagerId?.trim()
  if (importer?.userId && importerManagerId && !managerUserIds.has(importerManagerId)) {
    managerUserIds.set(importerManagerId, importer.userId)
  }

  let leagueTeamsCreated = 0
  let rostersCreated = 0
  /** Teams whose roster fetch failed and whose stored roster was therefore left alone (IMP-04). */
  let rostersPreserved = 0

  /*
   * 🛑 A TEAM'S ROW IS FOUND BY ITS TEAM ID, NOT ITS OWNER. Matching by owner key made every orphan
   * in a league share one row (key '') and gave a team a second row whenever its manager changed.
   * See `importedRosterIdentity.ts`. The claim read happens BEFORE the team upserts below, which only
   * ever add a claim, so a claim made through an invite keeps its roster key.
   */
  const provider = normalized.source.source_provider
  const [storedRosters, storedTeams] = await Promise.all([
    prisma.roster.findMany({
      where: { leagueId },
      select: { id: true, platformUserId: true, playerData: true },
    }),
    prisma.leagueTeam.findMany({
      where: { leagueId },
      select: { externalId: true, claimedByUserId: true },
    }),
  ])
  const claimByTeam = new Map(storedTeams.map((t) => [t.externalId, t.claimedByUserId]))
  const rosterPlan = planImportedRosterWrites({
    provider,
    stored: storedRosters,
    incoming: normalized.rosters.map((r) => {
      const linkedUserId = managerUserIds.get(r.source_manager_id) ?? null
      const claimedByUserId = claimByTeam.get(r.source_team_id) ?? null
      return {
        teamId: r.source_team_id,
        ownerKey: importedRosterOwnerKey({
          provider,
          teamId: r.source_team_id,
          linkedUserId,
          claimedByUserId,
          sourceManagerId: r.source_manager_id,
        }),
        ownerAliases: [linkedUserId, claimedByUserId, r.source_manager_id].filter(
          (v): v is string => typeof v === 'string' && v.trim().length > 0,
        ),
        keepKey: r.fetch_status === 'failed',
      }
    }),
  })
  const planByTeam = new Map(rosterPlan.plans.map((p) => [p.teamId, p]))
  const rekeys = rosterPlan.plans.filter(
    (p): p is typeof p & { rosterId: string } => p.rekey && p.rosterId != null,
  )
  if (rekeys.length > 0) {
    // Two steps, so keys can pass between rows (a chain, or two managers who swapped teams) without
    // tripping the unique (leagueId, platformUserId) half-way.
    await prisma.$transaction([
      ...rekeys.map((p) =>
        prisma.roster.update({ where: { id: p.rosterId }, data: { platformUserId: `rekey-pending:${p.rosterId}` } }),
      ),
      ...rekeys.map((p) =>
        prisma.roster.update({ where: { id: p.rosterId }, data: { platformUserId: p.ownerKey } }),
      ),
    ])
  }

  for (const r of normalized.rosters) {
    const standing = standingsByTeam.get(r.source_team_id)
    const rank = standing?.rank ?? null
    const pointsAgainst = r.points_against ?? (standing?.points_against ?? 0)
    const isOrphan = Boolean(r.is_orphan) || !r.source_manager_id
    const importedRole = isOrphan
      ? 'orphan'
      : r.is_commissioner
        ? 'commissioner'
        : r.is_co_commissioner
          ? 'co_commissioner'
          : 'member'

    // C3: when the source manager resolves to a linked AllFantasy account, claim
    // their LeagueTeam so owner-independent surfaces (Chimmy's
    // resolveLeagueIdentity) can find the user's own team. The raw
    // source_manager_id is preserved on `platformUserId` (below) and in roster
    // metadata; unresolved/orphan managers are never claimed.
    const resolvedClaim = managerUserIds.get(r.source_manager_id) ?? null

    await prisma.leagueTeam.upsert({
      where: {
        leagueId_externalId: { leagueId, externalId: r.source_team_id },
      },
      create: {
        leagueId,
        externalId: r.source_team_id,
        ownerName: r.owner_name,
        teamName: r.team_name || r.owner_name,
        avatarUrl: r.avatar_url ?? null,
        wins: r.wins,
        losses: r.losses,
        ties: r.ties,
        pointsFor: r.points_for,
        pointsAgainst,
        currentRank: rank,
        role: importedRole,
        isOrphan,
        platformUserId: r.source_manager_id || null,
        claimedByUserId: resolvedClaim,
        isCommissioner: Boolean(r.is_commissioner),
        isCoCommissioner: Boolean(r.is_co_commissioner),
      },
      update: {
        ownerName: r.owner_name,
        teamName: r.team_name || r.owner_name,
        avatarUrl: r.avatar_url ?? null,
        wins: r.wins,
        losses: r.losses,
        ties: r.ties,
        pointsFor: r.points_for,
        pointsAgainst,
        currentRank: rank,
        role: importedRole,
        isOrphan,
        platformUserId: r.source_manager_id || null,
        // Idempotent reimport: only (re)set the claim when the manager resolves;
        // never overwrite an existing claim with null.
        ...(resolvedClaim ? { claimedByUserId: resolvedClaim } : {}),
        isCommissioner: Boolean(r.is_commissioner),
        isCoCommissioner: Boolean(r.is_co_commissioner),
      },
    })
    leagueTeamsCreated++

    const isSourceCommissioner = Boolean(
      r.is_commissioner,
    )
    // C3: canonical `lineup_sections` consumed by `getNormalizedLineupSections`
    // (Chimmy's RosterContextProvider + autocoach/war-rooms/decision-os/
    // commissioner-hub). Without it, imported rosters read as empty starters/bench.
    const lineupStarters = r.starter_ids ?? []
    const lineupIr = r.reserve_ids ?? []
    const lineupTaxi = r.taxi_ids ?? []
    const lineupClaimedIds = new Set<string>([
      ...lineupStarters,
      ...lineupIr,
      ...lineupTaxi,
    ])
    const lineupBench = (r.player_ids ?? []).filter(
      (id) => !lineupClaimedIds.has(id),
    )

    const playerData = {
      players: r.player_ids,
      starters: r.starter_ids,
      reserve: r.reserve_ids ?? [],
      taxi: r.taxi_ids ?? [],
      lineup_sections: {
        starters: lineupStarters,
        bench: lineupBench,
        ir: lineupIr,
        taxi: lineupTaxi,
        devy: [] as string[],
      },
      source_provider: normalized.source.source_provider,
      source_league_id: normalized.source.source_league_id,
      source_team_id: r.source_team_id,
      source_manager_id: r.source_manager_id,
      source_season_id: normalized.source.source_season_id ?? null,
      import_batch_id: normalized.source.import_batch_id ?? null,
      imported_at: normalized.source.imported_at,
      // Placeholder-claim metadata — the generic claimer reads these to
      // match a joining user back to their pre-imported roster.
      import: {
        provider: normalized.source.source_provider,
        sourceLeagueId: normalized.source.source_league_id,
        sourceTeamId: r.source_team_id,
        sourceManagerId: r.source_manager_id,
        displayName: r.owner_name || r.team_name || null,
        ownerName: r.owner_name || null,
        teamName: r.team_name || null,
        avatarUrl: r.avatar_url ?? null,
        sourceIsCommissioner: isSourceCommissioner,
        sourceIsCoCommissioner: Boolean(r.is_co_commissioner),
        sourceIsOrphan: isOrphan,
      },
    }

    const plan = planByTeam.get(r.source_team_id)
    const existingRoster = plan?.rosterId ? { id: plan.rosterId } : null
    const ownerKey = plan?.ownerKey ?? importedRosterOwnerKey({ provider, teamId: r.source_team_id })

    /*
     * 🛑 IMP-04 — A FAILED FETCH MUST NOT CLEAR A GOOD ROSTER.
     *
     * `fetch_status === 'failed'` means the provider request for THIS team rejected and
     * `player_ids` is an empty placeholder rather than an observation. Writing it would
     * empty a real roster on a transient timeout, with nothing anywhere going red — the
     * league would simply show a manager with no players and report itself current.
     *
     * ⚠ SKIPPING ONLY APPLIES WHERE THERE IS SOMETHING TO PRESERVE. With no existing
     * row there is no last-good data to protect, and skipping would leave the team with
     * no roster at all; the placeholder is then strictly better, and the league's
     * `currentRosters` coverage is already `partial` so nothing claims it is complete.
     */
    if (r.fetch_status === 'failed' && existingRoster) {
      rostersPreserved++
      continue
    }

    if (existingRoster) {
      // The key was already moved above when it changed; the row's current key is written back as-is.
      await prisma.roster.update({
        where: { id: existingRoster.id },
        data: {
          platformUserId: ownerKey,
          playerData: playerData as any,
          faabRemaining: r.faab_remaining ?? null,
          waiverPriority: r.waiver_priority ?? null,
        },
      })
    } else {
      await prisma.roster.create({
        data: {
          leagueId,
          platformUserId: ownerKey,
          playerData: playerData as any,
          faabRemaining: r.faab_remaining ?? null,
          waiverPriority: r.waiver_priority ?? null,
        },
      })
    }
    rostersCreated++
  }

  let teamPerformancesCreated = 0
  const teamIdByExternalId = new Map<string, string>()
  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId },
    select: { id: true, externalId: true },
  })
  teams.forEach((t) => teamIdByExternalId.set(t.externalId, t.id))

  for (const weekData of normalized.schedule) {
    for (const mu of weekData.matchups) {
      const tid1 = teamIdByExternalId.get(mu.roster_id_1)
      const tid2 = teamIdByExternalId.get(mu.roster_id_2)
      if (tid1 && mu.points_1 != null) {
        try {
          await prisma.teamPerformance.upsert({
            where: {
              teamId_season_week: {
                teamId: tid1,
                season,
                week: weekData.week,
              },
            },
            create: {
              teamId: tid1,
              week: weekData.week,
              season,
              points: mu.points_1,
              opponent: tid2 ?? undefined,
              result: mu.points_2 != null ? (mu.points_1 > mu.points_2 ? 'W' : mu.points_1 < mu.points_2 ? 'L' : 'T') : null,
            },
            update: {
              points: mu.points_1,
              opponent: tid2 ?? undefined,
              result: mu.points_2 != null ? (mu.points_1 > mu.points_2 ? 'W' : mu.points_1 < mu.points_2 ? 'L' : 'T') : undefined,
            },
          })
          teamPerformancesCreated++
        } catch {
          // ignore duplicate or constraint errors
        }
      }
      if (tid2 && mu.points_2 != null) {
        try {
          await prisma.teamPerformance.upsert({
            where: {
              teamId_season_week: {
                teamId: tid2,
                season,
                week: weekData.week,
              },
            },
            create: {
              teamId: tid2,
              week: weekData.week,
              season,
              points: mu.points_2,
              opponent: tid1 ?? undefined,
              result: mu.points_1 != null ? (mu.points_2 > mu.points_1 ? 'W' : mu.points_2 < mu.points_1 ? 'L' : 'T') : null,
            },
            update: {
              points: mu.points_2,
              opponent: tid1 ?? undefined,
              result: mu.points_1 != null ? (mu.points_2 > mu.points_1 ? 'W' : mu.points_2 < mu.points_1 ? 'L' : 'T') : undefined,
            },
          })
          teamPerformancesCreated++
        } catch {
          // ignore
        }
      }
    }
  }

  return {
    leagueTeamsCreated,
    rostersCreated,
    teamPerformancesCreated,
    rostersPreserved,
    rostersRekeyed: rekeys.length,
    rosterDuplicateRows: rosterPlan.duplicateRows,
    rosterKeyConflicts: rosterPlan.plans.filter((p) => p.keyConflict).length,
  }
}

/**
 * Backward-compatible alias for older Sleeper-specific call sites.
 */
export async function bootstrapLeagueFromSleeperImport(
  leagueId: string,
  normalized: NormalizedImportResult
): Promise<SleeperLeagueBootstrapResult> {
  return bootstrapLeagueFromNormalizedImport(leagueId, normalized)
}
