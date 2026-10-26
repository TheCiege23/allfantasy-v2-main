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
 *   - REDRAFT: one action resets every roster, creates next season's RedraftSeason and its draft,
 *     ordered by the commissioner's choice (`draftOrder`: random | standings | reverse_standings |
 *     manual + `manualOrder`). See lib/redraft/offseason/renewRedraftLeague.ts.
 *   - A second renew into the same season is refused (409 `already_renewed`) by
 *     `isAlreadyRenewedIntoSeason` below — the one route-level guard. `renewRedraftLeague` refuses on
 *     the season engine's own state too (open draft / `renewedIntoSeason`), inside its transaction.
 * Commissioner only for POST. All members can GET.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { notifyCommissionerChange } from '@/lib/commissioner/CommissionerChangeNotifier'
import { isImportedPlatform, isNativePlatform } from '@/lib/league/isNativeLeague'
import { renewNativeRedraft, RedraftRenewalError } from '@/lib/redraft/offseason/renewNativeRedraft'
import { effectiveFaabRolloverRule, storedFaabRolloverRule } from '@/lib/waiver-wire/faab-rollover'
import { followsRenewalAutomatically } from '@/lib/league-import/sleeper/followRenewedLeagues'
import { checkAndTriggerRatingIfOffseason } from '@/lib/commissioner/CommissionerRatingTrigger'
import { readBracketResult } from '@/lib/redraft/offseason/RedraftOffseasonService'
import {
  isAlreadyRenewedIntoSeason,
  isSeasonOverForRenewal,
  normalizeRenewalModalType,
  renewalKindFromSelection,
  resolveLeagueVariantKey,
  shouldResetRostersForRenewal,
} from '@/lib/leagues/renewalPolicy'
import { buildSlotOrderForLeague } from '@/lib/live-draft-engine/DraftSessionService'
import {
  RENEW_DRAFT_ORDER_MODES,
  renewRedraftLeague,
  resolveRenewDraftOrderMode,
  type RenewRedraftLeagueResult,
} from '@/lib/redraft/offseason/renewRedraftLeague'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  /*
   * 🛑 MEMBER GATE. This GET returned the league to ANY signed-in user. It
   * computed the commissioner flag and handed it back as a FIELD for the UI to
   * branch on, and never refused on it — so naming any leagueId returned that
   * league's settings and team list, owner names included.
   *
   * ⚠ MEMBER-LEVEL, NOT COMMISSIONER-LEVEL, AND THAT IS LOAD-BEARING.
   * `LeagueDuesTrackerPanel` and `RosterSettingsEditor` fetch this, read
   * `isCommissioner` off the response, and render READ-ONLY for ordinary
   * members. Gating at commissioner level would close the hole and break every
   * non-commissioner in the league. The write handlers keep their own stricter
   * check; this one only has to exclude non-members.
   *
   * ⚠ BEFORE THE READ, not after. `resolveLeagueMembership` is the four-path
   * canonical predicate (owner, RedraftLeagueMember, roster-backed, claimed
   * team) and returns 401/404/403 itself, so a missing league and a league that
   * is not yours stay indistinguishable to the caller.
   */
  const membership = await resolveLeagueMembership(leagueId, session.user.id)
  if (!membership.ok) {
    return NextResponse.json(
      { error: membership.status === 404 ? 'Not found' : 'Forbidden' },
      { status: membership.status },
    )
  }


  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      userId: true, season: true, sport: true, isDynasty: true,
      leagueVariant: true, status: true, settings: true, scoring: true,
      name: true, leagueSize: true,
      lifecycleState: true, lifecycleMetadata: true,
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

  // The draft teams (Roster ids) a manual next-draft order is written in, in seat order.
  let draftTeams: Array<{ rosterId: string; displayName: string }> = []
  let savedDraftOrderMethod: string | null = null
  try {
    const [rosters, seats, ls] = await Promise.all([
      prisma.roster.findMany({ where: { leagueId }, select: { id: true } }),
      buildSlotOrderForLeague(leagueId),
      prisma.leagueSettings.findUnique({ where: { leagueId }, select: { draftOrderMethod: true } }),
    ])
    const real = new Set(rosters.map((r) => r.id))
    draftTeams = seats
      .filter((s) => real.has(s.rosterId))
      .map((s) => ({ rosterId: s.rosterId, displayName: s.displayName }))
    savedDraftOrderMethod = ls?.draftOrderMethod ?? null
  } catch {
    draftTeams = []
  }

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
    // True right after a renewal (the league is now IN the renewed season), so the modal stops
    // offering a second renew that POST would refuse. The old `=== nextSeason` read one season late.
    renewalCompleted: isAlreadyRenewedIntoSeason({
      season: currentSeason,
      status: league.status,
      settings,
      lifecycleMetadata: league.lifecycleMetadata,
    }),
    lifecycleState: league.lifecycleState,
    tournamentFeeder,
    draftTeams,
    draftOrderModes: RENEW_DRAFT_ORDER_MODES,
    defaultDraftOrder: resolveRenewDraftOrderMode(savedDraftOrderMethod) ?? 'standings',
  })
}

function statusForRedraftRenewFailure(code: Extract<RenewRedraftLeagueResult, { ok: false }>['code']): number {
  if (code === 'LEAGUE_NOT_FOUND') return 404
  if (code === 'INVALID_DRAFT_ORDER' || code === 'INVALID_MANUAL_ORDER') return 400
  return 409
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
      userId: true, season: true, settings: true, leagueVariant: true, platform: true,
      isDynasty: true, sport: true, name: true, scoring: true,
      waiverBudget: true, status: true, lifecycleState: true, lifecycleMetadata: true,
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
  /*
   * 🛑 AN IMPORTED LEAGUE IS RENEWED ON ITS PLATFORM. Writing `season + 1` here left the row pointing at
   * last season's provider league, and every sync then refused it for a season mismatch. A Sleeper
   * renewal is followed automatically (lib/league-import/sleeper/followRenewedLeagues.ts).
   */
  if (isImportedPlatform(league.platform)) {
    return NextResponse.json(
      {
        error: 'imported_league',
        message: followsRenewalAutomatically(league.platform)
          ? 'This league is hosted on Sleeper. Renew it there — AllFantasy picks up the new season on its own within a few hours.'
          : 'This league is hosted on its own platform. Renew it there, then re-import it so AllFantasy follows the new season.',
      },
      { status: 409 },
    )
  }

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
  if (renewalKind === 'redraft_reset' && isNativePlatform(league.platform) && league.sport === 'NBA') {
    try {
      return NextResponse.json(await renewNativeRedraft({ leagueId, userId: session.user.id,
        expectedSeason: typeof body.expectedSeason === 'number' ? body.expectedSeason : league.season ?? new Date().getFullYear(),
        removeMemberIds, duesEnabled, duesAmount, listInFinder, draftOrder: body.draftOrder, manualOrder: body.manualOrder }))
    } catch (error) {
      if (error instanceof RedraftRenewalError) return NextResponse.json({ error: error.message }, { status: error.status })
      if ((error as { code?: string }).code === 'P2034') return NextResponse.json({ error: 'Concurrent league change. Reload and retry renewal.' }, { status: 409 })
      console.error('[renew] native NBA renewal did not complete')
      return NextResponse.json({ error: 'Renewal could not complete. Retry after the season archive is available.' }, { status: 503 })
    }
  }
  let currentSeason = league.season ?? new Date().getFullYear()
  let nextSeason = currentSeason + 1

  /*
   * 🛑 RENEW ONCE. Every POST advanced `League.season` again, so a double-click or a re-opened modal
   * skipped a whole season and wiped its stats. Renewal leaves `lifecycleState` where it was, so the
   * season-over check below still passes after it — the marker written in step 6 is what stops it.
   */
  if (isAlreadyRenewedIntoSeason({
    season: currentSeason,
    status: league.status,
    settings,
    lifecycleMetadata: league.lifecycleMetadata,
  })) {
    return NextResponse.json(
      { error: 'already_renewed', message: `This league has already been renewed for ${currentSeason}.` },
      { status: 409 },
    )
  }
  // 🛑 Same predicate GET reports as `isSeasonOver`; only the UI checked it before.
  if (!isSeasonOverForRenewal({
    status: league.status,
    dynastySeasonPhase: settings.dynastySeasonPhase as string | undefined,
    seasonPhase: settings.season_phase as string | undefined,
    lifecycleState: league.lifecycleState,
  })) {
    return NextResponse.json(
      { error: 'season_not_over', message: `The ${currentSeason} season is not over yet. Renew the league once it has finished.` },
      { status: 409 },
    )
  }

  const changes: { field: string; oldValue: string; newValue: string }[] = []

  // ─── 0. REDRAFT: roster reset + next season + next draft, in one transaction, refused as a
  // whole before anything below runs. A league with no RedraftSeason (never ran the season engine)
  // keeps the legacy roster-only reset in step 4b. ───
  const resetsRosters = shouldResetRostersForRenewal(renewalKind)
  let redraftRenewal: Extract<RenewRedraftLeagueResult, { ok: true }> | null = null
  if (resetsRosters) {
    const result = await renewRedraftLeague(leagueId, session.user.id, {
      draftOrder: body.draftOrder,
      manualOrder: body.manualOrder,
    })
    if (result.ok) {
      redraftRenewal = result
      // The season engine is the authority on which season comes next.
      nextSeason = result.season
      currentSeason = result.season - 1
    } else if (result.code !== 'NO_SEASON') {
      return NextResponse.json(
        {
          error: result.code === 'ALREADY_RENEWED' ? 'already_renewed' : result.code.toLowerCase(),
          code: result.code,
          message: result.message,
        },
        { status: statusForRedraftRenewFailure(result.code) },
      )
    }
  }

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

    /*
     * 🛑 THE CHAMPION IS THE BRACKET WINNER, NOT THE POINTS LEADER. This upsert wrote `teamRecords[0]`
     * (most points) over the snapshot `enterRedraftOffseason` had already written from the finished
     * bracket. So: a recorded snapshot is kept as it is; with none, the bracket is read the same way
     * (`readBracketResult`); the points leader is only the fallback for a season with no bracket.
     */
    const existing = await prisma.leagueSeason.findUnique({
      where: { leagueId_season: { leagueId, season: currentSeason } },
      select: { championName: true, runnerUpName: true, regularSeasonWinnerName: true, teamRecords: true },
    })
    let championName: string | null = null
    let runnerUpName: string | null = null
    if (!existing?.championName) {
      const redraftSeason = await prisma.redraftSeason.findFirst({
        where: { leagueId, season: currentSeason },
        select: {
          playoffBracket: { select: { structure: true } },
          rosters: { select: { id: true, teamName: true, ownerName: true } },
        },
      })
      const bracket = readBracketResult(redraftSeason?.playoffBracket?.structure)
      if (bracket) {
        const nameOf = (id: string | null) => {
          const r = id ? redraftSeason?.rosters.find((x) => x.id === id) : undefined
          return r ? r.teamName ?? r.ownerName : null
        }
        championName = nameOf(bracket.championRosterId)
        runnerUpName = nameOf(bracket.runnerUpRosterId)
      } else {
        championName = teamRecords[0]?.ownerName ?? teamRecords[0]?.teamName ?? null
        runnerUpName = teamRecords[1]?.ownerName ?? teamRecords[1]?.teamName ?? null
      }
    }
    const pointsLeaderName = teamRecords[0]?.ownerName ?? teamRecords[0]?.teamName ?? null

    await prisma.leagueSeason.upsert({
      where: { leagueId_season: { leagueId, season: currentSeason } },
      // Fill only what is missing; a recorded snapshot is never rewritten.
      update: {
        status: 'complete',
        ...(existing?.teamRecords == null ? { teamRecords: toPrismaJsonInput(teamRecords), teamCount: teamRecords.length } : {}),
        ...(existing?.championName ? {} : { championName }),
        ...(existing?.championName || existing?.runnerUpName ? {} : { runnerUpName }),
        ...(existing?.regularSeasonWinnerName ? {} : { regularSeasonWinnerName: pointsLeaderName }),
        scoringFormat: league.scoring ?? null,
        isDynasty: league.isDynasty,
      },
      create: {
        leagueId,
        season: currentSeason,
        platformLeagueId: leagueId,
        status: 'complete',
        teamRecords: toPrismaJsonInput(teamRecords),
        championName,
        championAvatar: null,
        runnerUpName,
        regularSeasonWinnerName: pointsLeaderName,
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
  // FAAB follows the commissioner's rollover rule (lib/waiver-wire/faab-rollover.ts). Unset, a redraft
  // reset restores the budget (as it always did) and a keeper / dynasty renewal carries balances over.
  const rolloverFaab = typeof league.waiverBudget === 'number' && Number.isFinite(league.waiverBudget) ? league.waiverBudget : 100
  let storedRolloverRule: ReturnType<typeof storedFaabRolloverRule> = null
  try {
    const row = await prisma.leagueWaiverSettings.findUnique({ where: { leagueId }, select: { waiverEngineConfig: true } })
    storedRolloverRule = storedFaabRolloverRule(row?.waiverEngineConfig)
  } catch {
    // Unreadable: the family default applies, which is what every renewal did before the setting.
  }
  if (resetsRosters && !redraftRenewal) {
    const resetFaab = effectiveFaabRolloverRule(storedRolloverRule, 'redraft') === 'reset'
    await prisma.roster.updateMany({
      where: { leagueId },
      data: {
        playerData: toPrismaJsonInput({}),
        ...(resetFaab ? { faabRemaining: rolloverFaab } : {}),
      },
    })
    if (!resetFaab) await prisma.roster.updateMany({ where: { leagueId, faabRemaining: null }, data: { faabRemaining: rolloverFaab } })
  } else if (!resetsRosters && storedRolloverRule === 'reset') {
    // A keeper / dynasty league that chose "reset" starts the new season on the full budget.
    await prisma.roster.updateMany({ where: { leagueId }, data: { faabRemaining: rolloverFaab } })
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
    renewal_completed_at: new Date().toISOString(),
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
    draft: redraftRenewal
      ? {
          sessionId: redraftRenewal.sessionId,
          seasonId: redraftRenewal.seasonId,
          orderMode: redraftRenewal.orderMode,
          slotOrder: redraftRenewal.slotOrder,
          waiverClaimsCancelled: redraftRenewal.waiverClaimsCancelled,
          tradesCancelled: redraftRenewal.tradesCancelled,
        }
      : null,
  })
}
