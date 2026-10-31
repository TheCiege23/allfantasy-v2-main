import { snapshotImportedPlayerMetadata } from '@/lib/league-import/importedPlayerMetadata'
/**
 * After creating a League from any normalized import, populates LeagueTeam, Roster,
 * and TeamPerformance from NormalizedImportResult. Uses imported data directly.
 */

import { prisma } from '@/lib/prisma'
import type { NormalizedImportResult } from '../types'
import { importedRosterOwnerKey, planImportedRosterWrites } from '../importedRosterIdentity'
import { changeAwareWritesEnabled } from '../changeAwareWrites'
import { importedRosterUnchanged } from '../rosterWriteEquivalence'
import { writeTeamPerformances, type TeamPerformanceWrite } from '../teamPerformanceWrites'

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
  importer?: {
    userId: string
    sourceManagerId?: string | null
    /**
     * The team the importer picked as theirs, for a provider with no way to say which team is the
     * caller's (Fleaflicker). Validated upstream against this league's own rosters.
     *
     * ⚠ KEYED ON THE TEAM, NOT THE MANAGER. Fleaflicker falls back to the TEAM id as the manager id
     * for an ownerless team, so mapping a manager id could, in principle, claim a different row that
     * happens to share the value. The team id is the one thing that names exactly one row.
     */
    sourceTeamId?: string | null
  } | null,
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
      select: { id: true, platformUserId: true, playerData: true, faabRemaining: true, waiverPriority: true },
    }),
    prisma.leagueTeam.findMany({
      where: { leagueId },
      select: { externalId: true, claimedByUserId: true },
    }),
  ])
  const claimByTeam = new Map(storedTeams.map((t) => [t.externalId, t.claimedByUserId]))

  /*
   * The importer's self-identified team. A resolver mapping (provider-proven) wins over it, and it
   * NEVER takes a team already held by a different account — the same "never overwrite a claim"
   * rule the Fantrax/ESPN self-claim keeps. A re-import by the same person is a no-op.
   */
  const importerTeamId = importer?.sourceTeamId?.trim() || null
  const claimFor = (r: { source_team_id: string; source_manager_id: string }): string | null => {
    const resolved = managerUserIds.get(r.source_manager_id) ?? null
    if (resolved) return resolved
    if (!importer?.userId || !importerTeamId || String(r.source_team_id) !== importerTeamId) return null
    const heldBy = claimByTeam.get(r.source_team_id) ?? null
    return heldBy && heldBy !== importer.userId ? null : importer.userId
  }
  const rosterPlan = planImportedRosterWrites({
    provider,
    stored: storedRosters,
    incoming: normalized.rosters.map((r) => {
      const linkedUserId = claimFor(r)
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
  const storedRosterById = new Map(storedRosters.map((r) => [r.id, r]))
  /*
   * Rosters this import found exactly as stored. Their row is not rewritten; only `updatedAt` is
   * advanced, in one statement after the loop — see the comment there.
   */
  const unchangedRosterIds: string[] = []
  /* Kill switch: `AF_CHANGE_AWARE_WRITES_OFF=rosters` restores the always-rewrite behaviour. */
  const skipUnchangedRosters = changeAwareWritesEnabled('rosters')
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
    const resolvedClaim = claimFor(r)

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
        // The provider listed this franchise in an authoritative response, so CURRENT is evidence,
        // not a guess — which is the only basis on which this axis may be written away from UNKNOWN.
        lifecycleState: 'CURRENT',
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
        /*
         * 🛑 ONLY A PROVIDER THAT REPORTED A FLAG MAY CHANGE ONE. Sleeper, ESPN and Yahoo set
         * `is_commissioner` to a real boolean. Fantrax, MFL and Fleaflicker have no commissioner
         * field at all and leave it undefined — and `Boolean(undefined)` used to write `false` on
         * every refresh, wiping the flag an accepted import attestation had set
         * (`applyAttestedCommissioner`). Measured 2026-10-31: a Fantrax commissioner's attestation
         * was on file and no team in the league was commissioner, so no C and no hub.
         */
        ...(typeof r.is_commissioner === 'boolean' ? { isCommissioner: r.is_commissioner } : {}),
        ...(typeof r.is_co_commissioner === 'boolean' ? { isCoCommissioner: r.is_co_commissioner } : {}),
        /*
         * 🛑 RESURRECTION. THIS IS THE HALF THAT IS EASY TO OMIT AND SILENT WHEN OMITTED.
         *
         * `applySleeperLeagueSync` now ARCHIVES a vanished franchise that carries history rather
         * than deleting it, so the row survives — and `[leagueId, externalId]` is this upsert's
         * unique key, so a franchise the provider starts listing again lands on that archived row.
         * Without these three lines it would come back fully live and still marked ARCHIVED, with
         * an `archivedAt` from the week it left. Nothing would fail; it would just be wrong forever.
         *
         * Clearing them is the same evidence as above: the provider is listing it, so it is current.
         */
        lifecycleState: 'CURRENT',
        archivedAt: null,
        archiveReason: null,
      },
    })
    leagueTeamsCreated++

    const isSourceCommissioner = Boolean(
      r.is_commissioner,
    )
    // C3: canonical `lineup_sections` consumed by `getNormalizedLineupSections`
    // (Chimmy's RosterContextProvider + autocoach/war-rooms/decision-os/
    // commissioner-hub). Without it, imported rosters read as empty starters/bench.
    // `starter_ids` keeps Sleeper's `"0"` empty-slot markers (positional; stored as `starters`
    // below). A section lists PLAYERS, and a string id carries no slot index, so the markers stay
    // out of it — exactly what this section held before the mapper kept them.
    const lineupStarters = (r.starter_ids ?? []).filter((id) => id && id !== '0')
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
      player_metadata: snapshotImportedPlayerMetadata(r.player_ids, normalized.player_map),
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
      const stored = storedRosterById.get(existingRoster.id)
      if (
        skipUnchangedRosters &&
        stored &&
        importedRosterUnchanged(
          {
            // A rekey above already moved this row's key to `ownerKey`; the in-memory read predates it.
            platformUserId: plan?.rekey ? ownerKey : stored.platformUserId,
            playerData: stored.playerData,
            faabRemaining: stored.faabRemaining,
            waiverPriority: stored.waiverPriority,
          },
          {
            platformUserId: ownerKey,
            playerData,
            faabRemaining: r.faab_remaining ?? null,
            waiverPriority: r.waiver_priority ?? null,
          },
        )
      ) {
        unchangedRosterIds.push(existingRoster.id)
        rostersCreated++
        continue
      }
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

  /*
   * ⚠ AN UNCHANGED ROSTER STILL GETS ITS `updatedAt` ADVANCED, AND THAT IS DELIBERATE.
   *
   * Several readers treat `Roster.updatedAt` as "when this roster was last read from the provider":
   * the admin pipeline-freshness board (warn after 6h), the game-day triage "rosters as of" line,
   * the season-outlook data stamp and the league sync panel. The old unconditional rewrite kept it
   * current as a side effect. Leaving it behind would show a verified roster as hours stale, so it
   * is advanced in ONE statement that touches no other column — the large `playerData` value and
   * its TOAST are not rewritten, which is where the cost was.
   */
  if (unchangedRosterIds.length > 0) {
    await prisma.roster.updateMany({
      where: { id: { in: unchangedRosterIds } },
      data: { updatedAt: new Date() },
    })
  }

  let teamPerformancesCreated = 0
  const teamIdByExternalId = new Map<string, string>()
  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId },
    select: { id: true, externalId: true },
  })
  teams.forEach((t) => teamIdByExternalId.set(t.externalId, t.id))

  const performanceRows: TeamPerformanceWrite[] = []
  const resultFor = (own: number, other: number | null | undefined): string | null =>
    other != null ? (own > other ? 'W' : own < other ? 'L' : 'T') : null
  for (const weekData of normalized.schedule) {
    for (const mu of weekData.matchups) {
      const tid1 = teamIdByExternalId.get(mu.roster_id_1)
      const tid2 = teamIdByExternalId.get(mu.roster_id_2)
      if (tid1 && mu.points_1 != null) {
        performanceRows.push({
          teamId: tid1,
          week: weekData.week,
          points: mu.points_1,
          opponent: tid2 ?? null,
          result: resultFor(mu.points_1, mu.points_2),
        })
      }
      if (tid2 && mu.points_2 != null) {
        performanceRows.push({
          teamId: tid2,
          week: weekData.week,
          points: mu.points_2,
          opponent: tid1 ?? null,
          result: resultFor(mu.points_2, mu.points_1),
        })
      }
    }
  }
  /*
   * One read of the season, then only new or changed rows, in one statement. The old path was two
   * unconditional upserts per matchup per week on every sync. See `teamPerformanceWrites.ts` for
   * how its keep-the-stored-value rules for `opponent` and `result` are preserved.
   */
  const performances = await writeTeamPerformances({ season, rows: performanceRows })
  teamPerformancesCreated = performances.processed

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
