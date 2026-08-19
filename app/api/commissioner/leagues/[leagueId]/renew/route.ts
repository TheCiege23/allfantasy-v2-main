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
      data: { isOrphan: true, ownerName: 'Removed' },
    })
    changes.push({ field: 'Members Removed', oldValue: '', newValue: `${removeMemberIds.length} member(s)` })
  }

  // ─── 3. LABEL existing orphans properly ───
  // Any team without a real owner gets labeled as orphan
  await prisma.leagueTeam.updateMany({
    where: {
      leagueId,
      OR: [
        { isOrphan: true },
        { ownerName: { startsWith: 'orphan-' } },
        { ownerName: 'Removed' },
        { platformUserId: { startsWith: 'orphan-' } },
      ],
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
