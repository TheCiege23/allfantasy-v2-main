/**
 * GET: Fetch renew state (members, orphans, league type, dues, dispersal eligibility).
 * POST: Execute league renewal for next season.
 *   - Preserves all settings (roster, scoring, draft config, etc.)
 *   - Managers stay on their team
 *   - Orphan teams get labeled
 *   - History record created for completed season
 *   - 2+ orphans → dispersal draft highlighted
 *   - Optional league finder listing
 *   - Player rankings attached
 * Commissioner only for POST. All members can GET.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { notifyCommissionerChange } from '@/lib/commissioner/CommissionerChangeNotifier'
import { checkAndTriggerRatingIfOffseason } from '@/lib/commissioner/CommissionerRatingTrigger'
import {
  isSeasonOverForRenewal,
  normalizeRenewalModalType,
  renewalKindFromSelection,
  resolveLeagueVariantKey,
  shouldResetRostersForRenewal,
} from '@/lib/leagues/renewalPolicy'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      userId: true, season: true, sport: true, isDynasty: true,
      leagueVariant: true, status: true, settings: true, scoring: true,
      name: true, leagueSize: true,
      lifecycleState: true,
      teams: {
        select: {
          id: true, teamName: true, ownerName: true, avatarUrl: true,
          platformUserId: true, isOrphan: true, isCommissioner: true,
          wins: true, losses: true, pointsFor: true, currentRank: true,
        },
        orderBy: { pointsFor: 'desc' },
      },
    },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const settings = (league.settings as Record<string, unknown>) ?? {}
  const currentSeason = league.season ?? new Date().getFullYear()
  const nextSeason = currentSeason + 1
  const leagueType = (league.leagueVariant ?? settings.league_type as string ?? 'redraft').toLowerCase()
  const duesConfig = settings.dues_tracker as Record<string, unknown> | undefined

  const isSeasonOver = isSeasonOverForRenewal({
    status: league.status,
    dynastySeasonPhase: settings.dynastySeasonPhase as string | undefined,
    seasonPhase: settings.season_phase as string | undefined,
    lifecycleState: league.lifecycleState,
  })

  let tournamentFeeder: { tournamentId: string; renewFromHubPath: string } | null = null
  try {
    const link = await prisma.legacyTournamentLeague.findFirst({
      where: { leagueId },
      select: { tournamentId: true },
    })
    if (link?.tournamentId) {
      tournamentFeeder = {
        tournamentId: link.tournamentId,
        renewFromHubPath: `/tournament/${link.tournamentId}`,
      }
    }
  } catch {
    tournamentFeeder = null
  }

  // Separate active vs orphan members
  const activeMembers = league.teams.filter(t => !t.isOrphan && t.ownerName && !t.ownerName.startsWith('orphan-'))
  const orphanMembers = league.teams.filter(t => t.isOrphan || !t.ownerName || t.ownerName.startsWith('orphan-'))

  // Dispersal draft eligibility: 2+ orphans and 2+ active managers
  const dispersalDraftEligible = orphanMembers.length >= 2 && activeMembers.length >= 2

  // Check if league is already listed in finder
  let isListedInFinder = false
  try {
    const listing = await prisma.findLeagueListing.findFirst({
      where: { leagueId, isActive: true },
      select: { id: true },
    })
    isListedInFinder = Boolean(listing)
  } catch { /* table may not exist */ }

  return NextResponse.json({
    isCommissioner: league.userId === session.user.id,
    currentSeason,
    nextSeason,
    leagueType,
    sport: league.sport,
    leagueName: league.name,
    isSeasonOver,
    isDuesEnabled: Boolean(duesConfig?.enabled),
    duesAmount: (duesConfig?.amount as number) ?? null,
    members: activeMembers.map((t, i) => ({
      id: t.id,
      teamName: t.teamName,
      ownerName: t.ownerName,
      avatarUrl: t.avatarUrl,
      platformUserId: t.platformUserId,
      isCommissioner: t.isCommissioner,
      wins: t.wins,
      losses: t.losses,
      pointsFor: t.pointsFor,
      rank: t.currentRank ?? i + 1,
    })),
    orphanMembers: orphanMembers.map(t => ({
      id: t.id,
      teamName: t.teamName,
      ownerName: t.ownerName,
    })),
    orphanCount: orphanMembers.length,
    dispersalDraftEligible,
    isListedInFinder,
    renewalCompleted: Boolean(settings.renewal_completed_for_season === nextSeason),
    lifecycleState: league.lifecycleState,
    tournamentFeeder,
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      userId: true, season: true, settings: true, leagueVariant: true,
      isDynasty: true, sport: true, name: true, scoring: true,
      waiverBudget: true,
      teams: {
        select: {
          id: true, teamName: true, ownerName: true, isOrphan: true,
          isCommissioner: true, wins: true, losses: true, pointsFor: true,
          platformUserId: true, currentRank: true,
        },
      },
    },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (league.userId !== session.user.id) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const newLeagueType = typeof body.leagueType === 'string' ? body.leagueType : null
  const removeMemberIds = Array.isArray(body.removeMemberIds) ? body.removeMemberIds as string[] : []
  const duesEnabled = typeof body.duesEnabled === 'boolean' ? body.duesEnabled : undefined
  const duesAmount = typeof body.duesAmount === 'number' ? body.duesAmount : undefined
  const listInFinder = body.listInFinder === true

  const settings = (league.settings as Record<string, unknown>) ?? {}
  const selectedType = normalizeRenewalModalType(
    newLeagueType ?? resolveLeagueVariantKey(league.leagueVariant, settings),
  )
  const renewalKind = renewalKindFromSelection({
    leagueVariant: league.leagueVariant,
    settings,
    selectedType,
    isDynasty: league.isDynasty,
  })
  if (renewalKind === 'tournament_feeder') {
    const link = await prisma.legacyTournamentLeague.findFirst({
      where: { leagueId },
      select: { tournamentId: true },
    })
    return NextResponse.json(
      {
        error: 'tournament_feeder',
        message: 'This feeder league is part of a tournament. Renew the full tournament from the tournament hub so all conferences reset together.',
        tournamentId: link?.tournamentId ?? null,
        renewFromHubPath: link?.tournamentId ? `/tournament/${link.tournamentId}` : null,
      },
      { status: 409 },
    )
  }
  const currentSeason = league.season ?? new Date().getFullYear()
  const nextSeason = currentSeason + 1
  const changes: { field: string; oldValue: string; newValue: string }[] = []

  // ─── 1. STORE SEASON HISTORY with rankings ───
  try {
    // Build team records with rankings attached
    const teamRecords = league.teams
      .filter(t => !t.isOrphan)
      .sort((a, b) => (b.pointsFor ?? 0) - (a.pointsFor ?? 0))
      .map((t, i) => ({
        teamId: t.id,
        teamName: t.teamName,
        ownerName: t.ownerName,
        wins: t.wins,
        losses: t.losses,
        pointsFor: t.pointsFor,
        rank: t.currentRank ?? i + 1,
        isCommissioner: t.isCommissioner,
      }))

    // Find champion (rank 1 or highest points)
    const champion = teamRecords[0]

    await prisma.leagueSeason.upsert({
      where: { leagueId_season: { leagueId, season: currentSeason } },
      update: {
        status: 'complete',
        teamRecords: toPrismaJsonInput(teamRecords),
        championName: champion?.ownerName ?? champion?.teamName ?? null,
        runnerUpName: teamRecords[1]?.ownerName ?? teamRecords[1]?.teamName ?? null,
        regularSeasonWinnerName: champion?.ownerName ?? champion?.teamName ?? null,
        teamCount: teamRecords.length,
        scoringFormat: league.scoring ?? null,
        isDynasty: league.isDynasty,
      },
      create: {
        leagueId,
        season: currentSeason,
        platformLeagueId: leagueId,
        status: 'complete',
        teamRecords: toPrismaJsonInput(teamRecords),
        championName: champion?.ownerName ?? champion?.teamName ?? null,
        championAvatar: null,
        runnerUpName: teamRecords[1]?.ownerName ?? teamRecords[1]?.teamName ?? null,
        regularSeasonWinnerName: champion?.ownerName ?? champion?.teamName ?? null,
        teamCount: teamRecords.length,
        scoringFormat: league.scoring ?? null,
        isDynasty: league.isDynasty,
      },
    })
  } catch { /* non-fatal */ }

  // ─── 2. REMOVE unchecked members ───
  if (removeMemberIds.length > 0) {
    await prisma.leagueTeam.updateMany({
      where: { leagueId, id: { in: removeMemberIds }, isCommissioner: false },
      /*
       * A commissioner deliberately removing a member IS an archival event — one of only two
       * writers in the whole codebase that genuinely meant what `isOrphan` was read to mean.
       * `archiveReason` records WHICH of the five meanings put the row here, so the next
       * reader never has to guess again.
       *
       * ⚠ `managerKind` IS DELIBERATELY NOT SET. Removal says the franchise left; it says
       * nothing about who was running it, and a removed human is not thereby VACANT. Leaving
       * the axis untouched keeps UNKNOWN honest instead of inventing a manager state.
       */
      data: {
        isOrphan: true,
        ownerName: 'Removed',
        lifecycleState: 'ARCHIVED',
        archivedAt: new Date(),
        archiveReason: 'commissioner_removed_at_renewal',
      },
    })
    changes.push({ field: 'Members Removed', oldValue: '', newValue: `${removeMemberIds.length} member(s)` })
  }

  /*
   * ─── 3. LABEL existing orphans properly ───
   *
   * 🛑 THIS SWEEP IS THE WRITER THAT CREATED THE AMBIGUITY. One `updateMany` collected four
   * populations that land on OPPOSITE sides of the lifecycle axis and stamped one flag across all
   * of them, which is how `isOrphan` came to mean seven things. It is now THREE statements, each
   * with its own predicate and its own evidence, below.
   *
   * ⚠ THE SPLIT DOES NOT FINISH THE JOB, AND SAYING SO IS THE POINT. Only what is provable from
   * the predicate is written:
   *
   *   (a) ownerName 'Removed'        -> ARCHIVED   single writer, unambiguous
   *   (b) an `orphan-` prefix        -> CURRENT    lifecycle provable; manager axis NOT (see (b))
   *   (c) a bare `isOrphan: true`    -> nothing    any of the seven meanings; unclassifiable
   *
   * Bucket (c) is still left UNKNOWN on both axes on purpose. Nothing in this request can tell a
   * live open slot from a departed team once the flag is all that remains, and guessing is the
   * failure this whole batch exists to undo.
   *
   * ⚠ BEHAVIOUR IS PRESERVED, NOT MERELY INTENDED TO BE. Every row the old `OR` matched is still
   * matched by exactly one of the three, and every one still receives `isOrphan: true` — so no
   * reader that has not migrated sees any change. The only additions are the new axes.
   */
  /*
   * (a) ADMINISTRATIVELY REMOVED — the one branch that genuinely means departure. Single writer
   * (`ownerName: 'Removed'` is set two statements above and nowhere else in the codebase), so the
   * evidence is unambiguous and this is the only branch that may write ARCHIVED.
   */
  await prisma.leagueTeam.updateMany({
    where: { leagueId, ownerName: 'Removed' },
    data: {
      isOrphan: true,
      lifecycleState: 'ARCHIVED',
      archivedAt: new Date(),
      archiveReason: 'commissioner_removed_at_renewal',
    },
  })

  /*
   * (b) ORPHAN-PLACEHOLDER SEATS — still in the league, so CURRENT. `managerKind` is DELIBERATELY
   * NOT SET, and that is a measured refusal rather than caution.
   *
   * 🛑 THE `orphan-` PREFIX IS ITSELF OVERLOADED, THE SAME WAY `isOrphan` WAS. Four writers
   * produce it and they do not agree:
   *   commissioner/managers/route.ts        "slot is preserved but no user is linked"  -> VACANT
   *   leagues/[id]/downsize/handler.ts      vacating a seat while shrinking a league   -> VACANT
   *   commissioner/managers/assign-ai       SAME plain prefix + ownerName 'AI Manager' -> AI
   *   leagues/[id]/fill-empty-slots         `orphan-ai-<uuid>`, "AI Team N"            -> AI
   * `startsWith('orphan-')` matches all four, including `orphan-ai-`. The only thing separating
   * AI from vacant here is `ownerName: 'AI Manager'` — a DISPLAY STRING. Keying a durable state
   * on a label that exists to be rendered is how the next one of these gets built; rename the
   * label and the classification breaks with nothing going red.
   *
   * So this records what is provable (the franchise is current) and leaves the manager axis
   * UNKNOWN, which is exactly what UNKNOWN is for. The writers themselves are where that gets
   * fixed — `assign-ai` already writes `managerKind: 'AI'` on its own path.
   */
  await prisma.leagueTeam.updateMany({
    where: {
      leagueId,
      NOT: { ownerName: 'Removed' },
      OR: [
        { ownerName: { startsWith: 'orphan-' } },
        { platformUserId: { startsWith: 'orphan-' } },
      ],
    },
    data: { isOrphan: true, lifecycleState: 'CURRENT' },
  })

  /*
   * (c) ALREADY-FLAGGED, NO OTHER SIGNAL — genuinely unclassifiable, and left that way.
   *
   * A bare `isOrphan: true` carries any of the seven meanings, including a live open slot from
   * canonical creation. Nothing here can tell them apart, so NO axis is written. The statement is
   * retained rather than deleted because it is not quite a no-op: `lastUpdatedAt` is maintained by
   * Prisma, so removing it would silently stop bumping it on these rows at renewal — a behaviour
   * change smuggled inside a refactor.
   *
   * ⚠ THE TWO `NOT`s MAKE THE THREE STATEMENTS DISJOINT, WHICH THE FIRST DRAFT OF THIS SPLIT GOT
   * WRONG. Without them a row that is BOTH flagged and `orphan-`-prefixed matched (b) and (c),
   * so (c) re-wrote it after (b) had classified it. Harmless with today's payloads — (c) writes
   * no axis — but it made "each row is handled by exactly one branch" false, and a reader would
   * have had to re-derive the overlap to see that (c) cannot clobber (b).
   */
  await prisma.leagueTeam.updateMany({
    where: {
      leagueId,
      isOrphan: true,
      ownerName: { not: 'Removed' },
      NOT: {
        OR: [
          { ownerName: { startsWith: 'orphan-' } },
          { platformUserId: { startsWith: 'orphan-' } },
        ],
      },
    },
    data: { isOrphan: true },
  })

  // ─── 4. RESET team stats for new season (managers stay on teams) ───
  await prisma.leagueTeam.updateMany({
    where: { leagueId },
    data: {
      wins: 0,
      losses: 0,
      ties: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      currentRank: null,
      aiPowerScore: null,
      projectedWins: null,
    },
  })

  // ─── 4b. REDRAFT (Sleeper-style): clear rosters for a full startup draft — keep dynasty/keeper player groups ───
  if (shouldResetRostersForRenewal(renewalKind)) {
    const faab = typeof league.waiverBudget === 'number' && Number.isFinite(league.waiverBudget) ? league.waiverBudget : 100
    await prisma.roster.updateMany({
      where: { leagueId },
      data: {
        playerData: toPrismaJsonInput({}),
        faabRemaining: faab,
      },
    })
  }

  // ─── 5. UPDATE league type if changed ───
  if (newLeagueType && newLeagueType !== (league.leagueVariant ?? 'redraft')) {
    changes.push({ field: 'League Type', oldValue: league.leagueVariant ?? 'redraft', newValue: newLeagueType })
    await prisma.league.update({
      where: { id: leagueId },
      data: {
        leagueVariant: newLeagueType,
        isDynasty: newLeagueType === 'dynasty' || newLeagueType === 'devy' || newLeagueType === 'c2c',
      },
    })
  }

  // ─── 6. ADVANCE season (preserve ALL settings) ───
  changes.push({ field: 'Season', oldValue: String(currentSeason), newValue: String(nextSeason) })

  // Count orphans after removal for dispersal draft flag
  const orphanCount = await prisma.leagueTeam.count({ where: { leagueId, isOrphan: true } })
  const dispersalDraftEligible = orphanCount >= 2

  const updatedSettings: Record<string, unknown> = {
    ...settings, // ← PRESERVES all existing settings (roster, scoring, draft, etc.)
    renewal_completed_for_season: nextSeason,
    dynastySeasonPhase: 'regular',
    season_phase: 'pre_season',
    // Flag dispersal draft eligibility
    dispersal_draft_eligible: dispersalDraftEligible,
    orphan_count_at_renewal: orphanCount,
  }

  // ─── 7. UPDATE dues if changed ───
  if (duesEnabled !== undefined || duesAmount !== undefined) {
    const existingDues = (settings.dues_tracker as Record<string, unknown>) ?? {}
    updatedSettings.dues_tracker = {
      ...existingDues,
      enabled: duesEnabled ?? existingDues.enabled ?? false,
      amount: duesAmount ?? existingDues.amount ?? null,
      entries: [], // Reset payment status for new season
    }
    if (duesEnabled !== undefined && duesEnabled !== Boolean(existingDues.enabled)) {
      changes.push({ field: 'League Dues', oldValue: existingDues.enabled ? 'Paid' : 'Free', newValue: duesEnabled ? 'Paid' : 'Free' })
    }
  }

  await prisma.league.update({
    where: { id: leagueId },
    data: {
      season: nextSeason,
      status: 'pre_draft',
      settings: toPrismaJsonInput(updatedSettings),
    },
  })

  // ─── 8. LIST in league finder if requested ───
  if (listInFinder && orphanCount > 0) {
    try {
      await prisma.findLeagueListing.upsert({
        where: { leagueId_rosterId: { leagueId, rosterId: 'commissioner' } },
        update: {
          isActive: true,
          headline: `${league.name ?? 'League'} — ${orphanCount} spot${orphanCount > 1 ? 's' : ''} open for ${nextSeason}`,
          body: `${league.sport} ${newLeagueType ?? league.leagueVariant ?? 'redraft'} league looking for ${orphanCount} manager${orphanCount > 1 ? 's' : ''}. Season ${nextSeason}.`,
          sport: league.sport,
          updatedAt: new Date(),
        },
        create: {
          leagueId,
          rosterId: 'commissioner',
          headline: `${league.name ?? 'League'} — ${orphanCount} spot${orphanCount > 1 ? 's' : ''} open for ${nextSeason}`,
          body: `${league.sport} ${newLeagueType ?? league.leagueVariant ?? 'redraft'} league looking for ${orphanCount} manager${orphanCount > 1 ? 's' : ''}. Season ${nextSeason}.`,
          sport: league.sport,
          isActive: true,
        },
      })
      changes.push({ field: 'League Finder', oldValue: 'Not Listed', newValue: 'Listed' })
    } catch { /* non-fatal */ }
  }

  // ─── 9. NOTIFY league chat ───
  await notifyCommissionerChange(leagueId, session.user.id, 'League Renewal', changes).catch(() => {})

  // ─── 10. TRIGGER commissioner rating for completed season ───
  await checkAndTriggerRatingIfOffseason(leagueId).catch(() => {})

  return NextResponse.json({
    ok: true,
    nextSeason,
    orphanCount,
    dispersalDraftEligible,
    listedInFinder: listInFinder && orphanCount > 0,
  })
}
