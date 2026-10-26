import { Prisma } from '@prisma/client'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { prisma } from '@/lib/prisma'
import { enterRedraftOffseason } from './RedraftOffseasonService'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { effectiveFaabRolloverRule, faabBalanceAfterRollover, storedFaabRolloverRule } from '@/lib/waiver-wire/faab-rollover'
import { buildRenewalSlotOrder, resolveRenewDraftOrderMode, worstToFirstDraftRosterIds, draftOrderMethodForRenewMode } from './renewRedraftLeague'

export class RedraftRenewalError extends Error {
  constructor(message: string, public status = 409) { super(message) }
}
const object = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {}
type Input = { leagueId: string; userId: string; expectedSeason: number; removeMemberIds?: string[];
  duesEnabled?: boolean; duesAmount?: number; listInFinder?: boolean; draftOrder?: unknown; manualOrder?: unknown }

/** Archive is committed first. The year, empty roster links and NEW draft then
 * commit together. A retry names the same completed season and returns its receipt. */
export async function renewNativeRedraft(input: Input) {
  const readLeague = () => prisma.league.findUnique({ where: { id: input.leagueId } })
  const initial = await readLeague()
  if (!initial) throw new RedraftRenewalError('League not found.', 404)
  if (initial.userId !== input.userId) throw new RedraftRenewalError('Commissioner only.', 403)
  if (!isNativePlatform(initial.platform)) throw new RedraftRenewalError('Native renewal requires an AllFantasy-hosted league.')
  const receipt = object(initial.settings).redraft_renewal
  if (initial.season === input.expectedSeason + 1 && receipt?.completedSeason === input.expectedSeason) return { ...receipt, alreadyRenewed: true }
  if (initial.season !== input.expectedSeason || !['completed', 'offseason'].includes(initial.lifecycleState)) {
    throw new RedraftRenewalError('Finish the current season before renewing. Reload if the season has changed.')
  }
  const completed = await prisma.redraftSeason.findFirst({ where: { leagueId: input.leagueId, season: input.expectedSeason, status: 'complete' }, orderBy: { createdAt: 'desc' } })
  if (!completed) throw new RedraftRenewalError('A completed native season is required before renewal.')
  const archive = await enterRedraftOffseason(completed.id, input.userId)
  if (!archive.ok) throw new RedraftRenewalError(`Season archive is incomplete: ${archive.code}`)

  return prisma.$transaction(async tx => {
    const league = await tx.league.findUnique({ where: { id: input.leagueId }, include: { teams: true, rosters: true, waiverSettings: true } })
    if (!league || league.userId !== input.userId) throw new RedraftRenewalError('Commissioner only.', 403)
    const settings = { ...object(league.settings) }
    const previous = object(settings.redraft_renewal)
    if (league.season === input.expectedSeason + 1 && previous.completedSeason === input.expectedSeason) return { ...previous, alreadyRenewed: true }
    if (league.season !== input.expectedSeason || !['completed', 'offseason'].includes(league.lifecycleState)) throw new RedraftRenewalError('The league changed. Reload before renewing.')
    const snapshot = await tx.leagueSeason.findUnique({ where: { leagueId_season: { leagueId: input.leagueId, season: input.expectedSeason } } })
    if (!snapshot || snapshot.status !== 'complete') throw new RedraftRenewalError('Archive must be saved before players can be reset.')
    const claimed = await tx.league.updateMany({ where: { id: league.id, season: input.expectedSeason, lifecycleState: { in: ['completed', 'offseason'] } },
      data: { season: input.expectedSeason + 1, status: 'pre_draft', lifecycleState: 'pre_draft' } })
    if (claimed.count !== 1) throw new RedraftRenewalError('Renewal already changed this season. Reload and retry.')
    const oldDraft = await tx.draftSession.findFirst({ where: { leagueId: league.id }, orderBy: CURRENT_DRAFT_SESSION_ORDER })
    if (oldDraft && oldDraft.status !== 'completed') throw new RedraftRenewalError('Complete or resolve the current draft before renewal.')
    if (league.rosters.length < 2) throw new RedraftRenewalError('At least two teams are required.')
    const next = await tx.redraftSeason.create({ data: { leagueId: league.id, sport: completed.sport, season: input.expectedSeason + 1,
      status: 'setup', currentWeek: 0, totalWeeks: completed.totalWeeks, playoffStartWeek: completed.playoffStartWeek, medianGame: completed.medianGame } })
    const faab = league.waiverSettings?.faabBudget ?? league.waiverBudget ?? 100
    // The commissioner's FAAB rollover rule (lib/waiver-wire/faab-rollover.ts); unset, a redraft resets.
    const faabRule = effectiveFaabRolloverRule(storedFaabRolloverRule(league.waiverSettings?.waiverEngineConfig), 'redraft')
    const removed = new Set(input.removeMemberIds ?? [])
    for (const [index, generic] of league.rosters.entries()) {
      const team = league.teams.find(t => t.externalId === generic.id || t.platformUserId === generic.platformUserId || t.claimedByUserId === generic.platformUserId)
      const orphan = !!team && removed.has(team.id) && !team.isCommissioner
      const ownerId = orphan ? `roster:${generic.id}` : team?.claimedByUserId ?? team?.platformUserId ?? generic.platformUserId
      const teamFaab = faabBalanceAfterRollover(faabRule, faab, generic.faabRemaining)
      const roster = await tx.redraftRoster.create({ data: { leagueId: league.id, seasonId: next.id, ownerId,
        ownerName: orphan ? 'Open team' : team?.ownerName ?? 'Manager', teamName: team?.teamName,
        avatarUrl: team?.avatarUrl, faabBalance: teamFaab, waiverPriority: index + 1 } })
      await tx.roster.update({ where: { id: generic.id }, data: { redraftRosterId: roster.id, playerData: {}, faabRemaining: teamFaab,
        waiverPriority: index + 1, ...(orphan ? { platformUserId: ownerId } : {}) } })
      if (orphan && team) await tx.leagueTeam.update({ where: { id: team.id }, data: { claimedByUserId: null, platformUserId: ownerId, isOrphan: true, ownerName: 'Open team' } })
    }
    await tx.leagueTeam.updateMany({ where: { leagueId: league.id }, data: { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0,
      currentRank: null, aiPowerScore: null, projectedWins: null } })
    const config = resolveRedraftRosterConfig(completed.sport, settings)
    const savedOrder = await tx.leagueSettings.findUnique({ where: { leagueId: league.id }, select: { draftOrderMethod: true } })
    // An explicit choice, else the saved method — except a saved `manual`, which carries no list through
    // this call (the schema's and creation's default, so every league that never chose one): random, as
    // `renewRedraftLeague` does. It used to resolve to manual with no order and refuse the renewal (400).
    const savedMode = resolveRenewDraftOrderMode(savedOrder?.draftOrderMethod)
    const mode = (input.draftOrder != null ? resolveRenewDraftOrderMode(input.draftOrder) : savedMode === 'manual' ? null : savedMode) ?? 'random'
    if (input.draftOrder != null && !resolveRenewDraftOrderMode(input.draftOrder)) throw new RedraftRenewalError('Invalid draft order.', 400)
    const order = buildRenewalSlotOrder({ mode, teams: league.rosters.map((r, index) => ({ rosterId: r.id,
      displayName: league.teams.find(t => t.externalId === r.id || t.platformUserId === r.platformUserId)?.teamName ?? 'Team ' + (index + 1) })),
      worstToFirst: mode === 'standings' || mode === 'reverse_standings' ? await worstToFirstDraftRosterIds(league.id, completed.id, league.rosters) : null,
      manualOrder: Array.isArray(input.manualOrder) ? input.manualOrder : null })
    if (!order.ok) throw new RedraftRenewalError(order.message, 400)
    await tx.afRosterLineupAssignment.deleteMany({ where: { leagueId: league.id } })
    await tx.afLineupLockState.deleteMany({ where: { leagueId: league.id } })
    const note = 'Cancelled: league renewed for ' + next.season + '.'
    await tx.waiverClaim.updateMany({ where: { leagueId: league.id, status: 'pending' }, data: { status: 'cancelled', processedAt: new Date(), resultMessage: note } })
    await tx.redraftWaiverClaim.updateMany({ where: { leagueId: league.id, status: 'pending' }, data: { status: 'cancelled', processedAt: new Date(), denialReason: note } })
    await tx.afLeagueTrade.updateMany({ where: { leagueId: league.id, status: { in: ['pending', 'scheduled'] } }, data: { status: 'cancelled', cancelledAt: new Date() } })
    await tx.redraftTradeProposal.updateMany({ where: { leagueId: league.id, status: 'pending' }, data: { status: 'cancelled', cancelledAt: new Date(), reason: note } })
    await tx.redraftLeagueTrade.updateMany({ where: { leagueId: league.id, status: 'pending' }, data: { status: 'cancelled', processedAt: new Date(), notes: note } })
    const draft = await tx.draftSession.create({ data: { leagueId: league.id, status: 'pre_draft', sessionKind: 'live', sportType: completed.sport,
      draftType: oldDraft?.draftType ?? 'snake', rounds: oldDraft?.rounds ?? [...config.starterCapacities.values()].reduce((sum, n) => sum + n, config.benchSlots),
      teamCount: league.rosters.length, timerSeconds: oldDraft?.timerSeconds ?? 120, thirdRoundReversal: oldDraft?.thirdRoundReversal ?? false,
      cpuAutoPick: oldDraft?.cpuAutoPick ?? true, aiAutoPick: oldDraft?.aiAutoPick ?? false,
      auctionBudgetPerTeam: oldDraft?.auctionBudgetPerTeam,
      alphabeticalSort: oldDraft?.alphabeticalSort, playerPool: 'all', draftModeLabel: 'standard',
      onClockTradeTimerBehavior: oldDraft?.onClockTradeTimerBehavior, inDraftPlayerTradesEnabled: oldDraft?.inDraftPlayerTradesEnabled, customRankingsEnabled: oldDraft?.customRankingsEnabled,
      slotOrder: toPrismaJsonInput(order.slotOrder) } })
    const orphanCount = await tx.leagueTeam.count({ where: { leagueId: league.id, isOrphan: true } })
    const result = { ok: true, completedSeason: input.expectedSeason, nextSeason: next.season, seasonId: next.id, draftSessionId: draft.id, draft: { sessionId: draft.id, orderMode: mode, slotOrder: order.slotOrder },
      orphanCount, dispersalDraftEligible: orphanCount >= 2, listedInFinder: Boolean(input.listInFinder && orphanCount) }
    delete settings.redraft_start_week
    delete settings.rotisserie_result
    settings.redraft_renewal = result
    settings.renewal_completed_for_season = next.season
    settings.renewal_completed_at = new Date().toISOString()
    settings.season_phase = 'pre_season'
    if (input.duesEnabled !== undefined || input.duesAmount !== undefined) settings.dues_tracker = { ...object(settings.dues_tracker),
      enabled: input.duesEnabled ?? settings.dues_tracker?.enabled, amount: input.duesAmount ?? settings.dues_tracker?.amount, entries: [] }
    await tx.league.update({ where: { id: league.id }, data: { settings: settings as Prisma.InputJsonValue, lifecycleMetadata: { ...object(league.lifecycleMetadata), renewedIntoSeason: next.season, nextDraftCreated: draft.id, lastTransitionAt: settings.renewal_completed_at, lastTransitionFrom: league.lifecycleState } } })
    await tx.leagueSettings.updateMany({ where: { leagueId: league.id }, data: { draftDateUtc: null, autostart: false, draftOrderMethod: draftOrderMethodForRenewMode(mode) } })
    if (result.listedInFinder) await tx.findLeagueListing.upsert({ where: { leagueId_rosterId: { leagueId: league.id, rosterId: 'commissioner' } },
      create: { leagueId: league.id, rosterId: 'commissioner', headline: `${league.name ?? 'League'} — ${orphanCount} spots open`, body: `Season ${next.season}`, sport: league.sport, isActive: true },
      update: { isActive: true, headline: `${league.name ?? 'League'} — ${orphanCount} spots open` } })
    await tx.leagueAuditLog.create({ data: { leagueId: league.id, userId: input.userId, actionType: 'redraft_season_renewed', entityType: 'league',
      entityId: league.id, beforeState: { season: input.expectedSeason, snapshotId: snapshot.id }, afterState: toPrismaJsonInput(result) } })
    return { ...result, alreadyRenewed: false }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 })
}
