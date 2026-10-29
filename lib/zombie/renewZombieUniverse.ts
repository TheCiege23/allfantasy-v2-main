import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { effectiveFaabRolloverRule, storedFaabRolloverRule, faabBalanceAfterRollover } from '@/lib/waiver-wire/faab-rollover'
import { runPresetEngine } from '@/lib/league-creation/preset-engine/runPresetEngine'
import { createCanonicalLeagueInTransaction } from '@/lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import type { ValidatedCreateLeagueBody } from '@/lib/league-creation/canonical/validateCreateLeague'
import { getUniverseStandings } from './ZombieUniverseStandingsService'
import { detachedPolicy, nextZombieSettings } from './renewalSettings'
import { planUniverseRenewal, renewalFingerprint } from './universeRenewalPlan'

const EVENT = 'UNIVERSE_SEASON_RENEWED'
type Tx = Prisma.TransactionClient
export type ZombieRenewalResult = {
  version: number; universeId: string; season: number; nextSeason: number; previewHash: string;
  leagues: Array<{ previousLeagueId: string; leagueId: string; draftId: string }>;
  placements: Array<{ userId: string; previousRosterId: string; leagueId: string; slot: number; movement: string }>;
  alreadyRenewed: boolean
}
export class ZombieRenewalError extends Error {}
function fail(code: string): never { throw new ZombieRenewalError(code) }

const LEAGUE_RULES = [
  'scoring','rosterSize','starters','scoringPresetId','presetKey','settingsSnapshotVersion','timezone','language',
  'waiverType','waiverBudget','waiverMinBid','waiverClearAfterGames','waiverHours','customDailyWaivers',
  'waiverProcessTime','waiverSchedule','tradeReviewHours','tradeDeadlineWeek','draftPickTrading','playoffStartWeek','playoffTeams',
  'playoffWeeksPerRound','playoffSeedingRule','playoffLowerBracket','irSlots','irAllowCovid','irAllowOut',
  'irAllowSuspended','irAllowNA','irAllowDNR','irAllowDoubtful','medianGame','allowPreDraftMoves','preventBenchDrops',
  'taxiSlots','taxiAllowNonRookies','taxiYearsLimit','taxiDeadlineWeek','aiChimmyEnabled','aiWaiverSuggestions',
  'aiTradeAnalysis','aiLineupHelp','aiDraftRecs','aiRecaps','leagueAiCommissionerAlerts','aiModeration','aiPowerRankings',
] as const
function rules(row: object) {
  const source = row as Record<string, unknown>
  return Object.fromEntries(LEAGUE_RULES.filter(k => source[k] !== undefined).map(k => [k,source[k]]))
}

async function loadPlan(tx: Tx, universeId: string, season: number, actor: string) {
  if (!Number.isInteger(season) || season < 2000 || season >= 2200) fail('RENEWAL_SEASON_INVALID')
  const universe = await tx.zombieUniverse.findUnique({ where: { id: universeId }, include: { levels: true } })
  if (!universe) fail('RENEWAL_NOT_FOUND')
  if ((universe.commissionedByUserId ?? universe.createdByUserId) !== actor) fail('RENEWAL_OWNER_REQUIRED')
  const prior = await tx.zombieAuditLog.findFirst({ where: {
    universeId, eventType: EVENT, metadata: { path: ['season'], equals: season },
  } })
  if (prior) return { prior: prior.metadata, universe, sources: [], plan: null }
  if (universe.promotionMode !== 'auto') fail('RENEWAL_MANUAL_REVIEW_REQUIRED')
  if (await tx.zombieLeague.count({ where: { universeId, season: { gt: season } } })) fail('RENEWAL_NEWER_SEASON_EXISTS')
  const sources = await tx.zombieLeague.findMany({ where: { universeId, season }, orderBy: { leagueId: 'asc' },
    include: { paidConfig: true, freeRewardConfig: true, league: { include: {
      rosters: true, teams: true, leagueSettings: true, waiverSettings: true, zombieConfig: true,
      redraftDraftProfile: true, redraftExtendedSettings: true,
    } } },
  })
  if (!sources.length || sources.length > 24) fail('RENEWAL_LEAGUE_COUNT_INVALID')
  if (sources.some(z => z.status !== 'complete' || !z.levelId)) fail('RENEWAL_SEASONS_INCOMPLETE')
  if (sources.some(z => !['NFL','NBA','NHL','MLB'].includes(z.sport.toUpperCase()) ||
    z.sport.toUpperCase() !== String(z.league.sport) || String(z.league.sport) !== universe.sport.toUpperCase() ||
    !['manual','allfantasy','native','af'].includes(z.league.platform.toLowerCase()))) fail('RENEWAL_NATIVE_SPORT_REQUIRED')
  const tenantIds = new Set(sources.map(z => z.league.tenantId))
  if (tenantIds.size !== 1) fail('RENEWAL_TENANT_MISMATCH')
  const leagueIds = sources.map(z => z.leagueId)
  const seasons = await tx.redraftSeason.findMany({ where: { leagueId: { in: leagueIds }, season } })
  if (seasons.length !== sources.length || seasons.some(s => s.status !== 'complete')) fail('RENEWAL_SEASONS_INCOMPLETE')
  if (await tx.redraftMatchup.count({ where: { seasonId: { in: seasons.map(s => s.id) }, status: { not: 'final' } } })) fail('RENEWAL_RECONCILIATION_REQUIRED')
  const resolutions = await tx.zombieWeeklyResolution.findMany({ where: { zombieLeagueId: { in: sources.map(z => z.id) } } })
  if (resolutions.some(r => r.status !== 'complete' || r.requiresStatCorrection)) fail('RENEWAL_RECONCILIATION_REQUIRED')
  for (const z of sources) {
    const first = z.seasonStartWeek ?? 1
    if (!Number.isInteger(first) || first < 1 || first > z.totalWeeks ||
      Array.from({ length: z.totalWeeks-first+1 },(_,i)=>first+i).some(week =>
        !resolutions.some(r => r.zombieLeagueId === z.id && r.week === week && r.status === 'complete'))) fail('RENEWAL_RECONCILIATION_REQUIRED')
    if (!z.league.leagueSettings || !z.league.zombieConfig || z.league.rosters.length !== z.teamCount) fail('RENEWAL_CONFIGURATION_INCOMPLETE')
  }
  const drafts = await tx.draftSession.findMany({ where: { leagueId: { in: leagueIds } }, orderBy: { createdAt: 'desc' } })
  const draftFor = (leagueId: string) => drafts.find(d => d.leagueId === leagueId)
  if (sources.some(z => draftFor(z.leagueId)?.status !== 'completed')) fail('RENEWAL_DRAFT_INCOMPLETE')
  const owners = sources.flatMap(z => z.league.rosters.map(r => r.platformUserId))
  const users = await tx.appUser.findMany({ where: { id: { in: owners } }, select: { id: true, displayName: true, username: true, avatarUrl: true } })
  if (new Set(owners).size !== owners.length || users.length !== owners.length) fail('RENEWAL_MEMBERSHIP_AMBIGUOUS')
  const standings = await getUniverseStandings(universeId, season, tx)
  if (standings.length !== owners.length || standings.some(r => r.wins+r.losses+r.ties === 0)) fail('RENEWAL_STANDINGS_INCOMPLETE')
  const managers = standings.map(row => {
    const source = sources.find(z => z.leagueId === row.leagueId)!
    const roster = source.league.rosters.find(r => r.id === row.rosterId) ?? fail('RENEWAL_MEMBERSHIP_AMBIGUOUS')
    const user = users.find(u => u.id === roster.platformUserId)!
    const team = source.league.teams.find(t => t.externalId === roster.id)
    return { ...row, userId: user.id, displayName: user.displayName || user.username || 'Manager',
      teamName: team?.teamName || user.displayName || user.username || 'Team', avatarUrl: team?.avatarUrl ?? user.avatarUrl }
  })
  let placement
  try { placement = planUniverseRenewal(managers, universe.levels, universe, sources.map(z => ({
    leagueId: z.leagueId, levelId: z.levelId!, name: z.name || z.league.name || 'Zombie League', seats: z.teamCount, orderInLevel: z.orderInLevel,
  })), universeId + ':' + (season+1)) } catch (error) { fail(error instanceof Error ? error.message : 'RENEWAL_CAPACITY_INVALID') }
  // The fingerprint covers copied rules as well as membership/results: an edited rule requires a fresh preview.
  const policies = await Promise.all(sources.map(async z => ({
    leagueId: z.leagueId, leagueRules: rules(z.league), settings: nextZombieSettings(z.league.settings, season+1, z.leagueId),
    zombie: detachedPolicy(z, ['universeId','levelId','name','orderInLevel','teams','league','paidConfig','freeRewardConfig','status','currentWeek','potTotal','currentTeamCount','draftScheduledAt','rulesSnapshot']),
    config: detachedPolicy(z.league.zombieConfig!), draft: draftFor(z.leagueId),
    leagueSettings: z.league.leagueSettings, waiverSettings: z.league.waiverSettings,
    scoring: await tx.leagueScoringOverride.findMany({ where: { leagueId: z.leagueId }, orderBy: { statKey: 'asc' } }),
    roster: await tx.leagueRosterConfig.findUnique({ where: { leagueId: z.leagueId } }),
    snapshot: await tx.scoringSettingsSnapshot.findFirst({ where: { leagueId: z.leagueId }, orderBy: { createdAt: 'desc' } }),
    paid: z.paidConfig, free: z.freeRewardConfig, extended: z.league.redraftExtendedSettings,
  })))
  const assignments = placement!.assignments.map(m => {
    const destination = sources.find(z=>z.leagueId===m.destinationLeagueId)!.league
    const previous = sources.flatMap(z=>z.league.rosters).find(r=>r.id===m.rosterId)!
    const faabRule = effectiveFaabRolloverRule(storedFaabRolloverRule(destination.waiverSettings?.waiverEngineConfig),'redraft')
    return { ...m, faabRule, nextFaab: faabBalanceAfterRollover(faabRule,destination.waiverSettings?.faabBudget ?? destination.waiverBudget ?? 0,previous.faabRemaining) }
  })
  const plan = { version: 1, universeId, season, nextSeason: season+1, ...placement!, assignments }
  return { universe, sources, policies, drafts, plan, prior: null,
    previewHash: renewalFingerprint({ plan, policies }),
  }
}

export async function previewZombieUniverseRenewal(universeId: string, season: number, actor: string) {
  return prisma.$transaction(async tx => {
    const loaded = await loadPlan(tx, universeId, season, actor)
    return loaded.prior ? { completed: true, result: loaded.prior } :
      { completed: false, ...loaded.plan, previewHash: loaded.previewHash }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60000 })
}

export async function renewZombieUniverse(universeId: string, season: number, actor: string, previewHash: string): Promise<ZombieRenewalResult> {
  const run = () => prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM zombie_universes WHERE id = ${universeId} FOR UPDATE`)
    const loaded = await loadPlan(tx, universeId, season, actor)
    if (loaded.prior) {
      const prior = loaded.prior as unknown as ZombieRenewalResult
      if (prior.previewHash !== previewHash) fail('RENEWAL_PREVIEW_CHANGED')
      if (!Array.isArray(prior.leagues) || !Array.isArray(prior.placements)) fail('RENEWAL_MOVEMENT_REVIEW_REQUIRED')
      return { ...prior, alreadyRenewed: true }
    }
    if (!previewHash || previewHash !== loaded.previewHash) fail('RENEWAL_PREVIEW_CHANGED')
    const { sources, plan, policies, drafts } = loaded
    const movement = plan!.movement.filter(m=>m.reason !== 'watch')
    const existingMovement = await tx.zombieMovementRecord.findMany({ where: { universeId, season } })
    if (existingMovement.length) {
      if (existingMovement.length !== movement.length || movement.some(m => !existingMovement.some(r =>
        r.userId === plan!.assignments.find(a=>a.rosterId===m.rosterId)!.userId &&
        r.fromTierLabel===m.fromTierLabel && r.toTierLabel===m.toTierLabel &&
        r.movementType===(m.reason==='promotion'?'promoted':'relegated')))) fail('RENEWAL_MOVEMENT_REVIEW_REQUIRED')
    } else for (const m of movement) {
      const manager=plan!.assignments.find(a=>a.rosterId===m.rosterId)!
      await tx.zombieMovementRecord.create({ data: { universeId, season, userId: manager.userId, displayName: manager.displayName,
        fromTierLabel: m.fromTierLabel, toTierLabel: m.toTierLabel, movementType: m.reason==='promotion'?'promoted':'relegated',
        reason: 'record_performance', finalRecord: m.wins+'-'+m.losses+'-'+m.ties, finalPPW: m.pointsPerWeek, finalTierRank: m.finalTierRank, approvedBy: actor } })
    }
    if (!await tx.zombieAuditLog.findFirst({ where: { universeId, eventType: 'UNIVERSE_MOVEMENT_RECORDED', metadata: { path: ['season'], equals: season } } }))
      await tx.zombieAuditLog.create({ data: { universeId, leagueId: sources[0].leagueId, eventType: 'UNIVERSE_MOVEMENT_RECORDED',
        metadata: { version: 1, season, recorded: movement.length, actorUserId: actor, scope: 'season_renewal' } } })
    const created: Array<{ previousLeagueId: string; leagueId: string; draftId: string }> = []
    for (const z of sources) {
      const old = z.league, policy = policies!.find(p => p.leagueId === z.leagueId)!, draft = drafts!.find(d => d.leagueId === z.leagueId)!
      const name = (old.name || z.name || 'Zombie League').replace(/ · \d{4}$/, '') + ' · ' + (season+1)
      const body: ValidatedCreateLeagueBody = {
        concept: 'zombie', sport: old.sport, teamCount: z.teamCount, draftType: draft.draftType,
        scoringPreset: old.scoringPresetId || ({ NFL: 'fb_half_ppr', NBA: 'nba_points', NHL: 'nhl_points', MLB: 'mlb_points' } as Record<string,string>)[old.sport],
        leagueName: name.slice(0,100), timezone: old.timezone || 'America/New_York', language: old.language === 'es' ? 'es' : 'en', conceptSetup: {},
      }
      const engine = runPresetEngine({ concept: 'zombie', sport: old.sport, teamCount: z.teamCount,
        draftType: draft.draftType, scoringPreset: body.scoringPreset, leagueName: body.leagueName, commissionerId: actor, conceptSetup: {} })
      const shell = await createCanonicalLeagueInTransaction(tx, actor, body, engine, undefined, { tenantId: old.tenantId, season: season+1 })
      const leagueId = shell.leagueId
      const fresh = await tx.league.findUniqueOrThrow({ where: { id: leagueId }, select: { settings: true } })
      const base = fresh.settings as Prisma.JsonObject
      const settings = { ...base, ...policy.settings, default_team_count: z.teamCount,
        draftSettings: { draftType: draft.draftType, rounds: draft.rounds, timerSeconds: draft.timerSeconds, thirdRoundReversal: draft.thirdRoundReversal },
        foundation_defaults: { ...(base.foundation_defaults as Prisma.JsonObject), ...(policy.settings.foundation_defaults as Prisma.JsonObject),
          draft: { draftType: draft.draftType, rounds: draft.rounds, timerSeconds: draft.timerSeconds } },
        draft_rounds: draft.rounds, draft_type: draft.draftType, requested_draft_type: draft.draftType, draft_timer_seconds: draft.timerSeconds,
        third_round_reversal: draft.thirdRoundReversal, draft_third_round_reversal: draft.thirdRoundReversal,
      } as Prisma.InputJsonValue
      await tx.league.update({ where: { id: leagueId }, data: { ...policy.leagueRules, settings,
        starters: old.starters == null ? Prisma.DbNull : old.starters as Prisma.InputJsonValue,
        waiverSchedule: old.waiverSchedule == null ? Prisma.DbNull : old.waiverSchedule as Prisma.InputJsonValue,
        leagueVariant: 'zombie', leagueType: 'zombie', season: season+1, status: 'setup', lifecycleState: 'setup', locked: false,
      } as Prisma.LeagueUncheckedUpdateInput })
      const rosterConfig = policy.roster
      if (rosterConfig) await tx.leagueRosterConfig.create({ data: { leagueId, templateId: rosterConfig.templateId,
        ...(rosterConfig.overrides != null ? { overrides: rosterConfig.overrides as Prisma.InputJsonValue } : {}) } })
      if (policy.scoring.length) await tx.leagueScoringOverride.createMany({ data: policy.scoring.map(s => ({
        leagueId, statKey: s.statKey, pointsValue: s.pointsValue, enabled: s.enabled,
      })) })
      await tx.scoringSettingsSnapshot.deleteMany({ where: { leagueId } })
      if (policy.snapshot) await tx.scoringSettingsSnapshot.create({ data: {
        ...detachedPolicy(policy.snapshot, ['season','week'], ['overrides']), leagueId, season: season+1, week: null,
      } as Prisma.ScoringSettingsSnapshotUncheckedCreateInput })
      if (old.waiverSettings) await tx.leagueWaiverSettings.update({ where: { leagueId }, data:
        detachedPolicy(old.waiverSettings, ['faabResetDate'], ['processingDays','freeAgentWindowRules','dropRestrictions','commissionerOverrideRules','specialtyConceptOverrides','waiverEngineConfig']) as Prisma.LeagueWaiverSettingsUncheckedUpdateInput })
      if (old.redraftExtendedSettings) await tx.redraftLeagueExtendedSettings.update({ where: { leagueId }, data: {
        ...detachedPolicy(old.redraftExtendedSettings, ['settingsJson','isPublic']), isPublic: false,
      } })
      const members = plan!.assignments.filter(m => m.destinationLeagueId === z.leagueId).sort((a,b) => a.slot-b.slot)
      const seats = await tx.leagueEntrySlot.findMany({ where: { leagueId }, orderBy: { slotNumber: 'asc' } })
      if (seats.length !== members.length || seats.some(s => !s.rosterId)) fail('RENEWAL_CONFIGURATION_INCOMPLETE')
      // Detach the creator before assigning seats, so moving the commissioner cannot hit the owner uniqueness constraint.
      for (const seat of seats) await tx.roster.update({ where: { id: seat.rosterId! }, data: { platformUserId: 'renewal-seat-' + seat.id } })
      const slotOrder = []
      for (let i=0; i<members.length; i++) {
        const m=members[i], rosterId=seats[i].rosterId!
        await tx.roster.update({ where: { id: rosterId }, data: {
          platformUserId: m.userId, playerData: { players: [], draftPicks: [], foundation: { slotNumber: i+1, openTeam: false, createdBy: 'zombie_universe_renewal' } },
          faabRemaining: m.nextFaab, waiverPriority: members.length-i,
          settings: { openSlot: false, commissioner: m.userId === actor },
        } })
        await tx.leagueTeam.update({ where: { leagueId_externalId: { leagueId, externalId: rosterId } }, data: {
          platformUserId: m.userId, claimedByUserId: m.userId, ownerName: m.displayName, teamName: m.teamName,
          avatarUrl: m.avatarUrl, isOrphan: false, isCommissioner: m.userId===actor, role: m.userId===actor ? 'commissioner':'member',
          lifecycleState: 'CURRENT', managerKind: 'HUMAN',
        } })
        await tx.redraftLeagueMember.upsert({ where: { leagueId_userId: { leagueId, userId: m.userId } },
          create: { leagueId, userId: m.userId, teamNumber: i+1, role: m.userId===actor?'COMMISSIONER':'MEMBER' },
          update: { teamNumber: i+1, role: m.userId===actor?'COMMISSIONER':'MEMBER' } })
        await tx.leagueEntrySlot.update({ where: { id: seats[i].id }, data: { status: 'FILLED' } })
        slotOrder.push({ slot: i+1, rosterId, displayName: m.displayName, open: false })
      }
      if (!members.some(m=>m.userId===actor)) await tx.redraftLeagueMember.update({
        where: { leagueId_userId: { leagueId, userId: actor } }, data: { teamNumber: null },
      })
      await tx.leagueSettings.update({ where: { leagueId }, data: {
        ...detachedPolicy(old.leagueSettings!, ['draftDateUtc','autostart','draftOrderSlots','draftOrderLocked','draftOrderMethod','randomizeCount','randomizeHistory','resetHistory','updatedBy','keeperSlots']),
        draftDateUtc: null, autostart: false, alphabeticalSort: false, draftOrderSlots: slotOrder, draftOrderLocked: false, draftOrderMethod: 'manual',
      } })
      const nextDraft = await tx.draftSession.findFirstOrThrow({ where: { leagueId } })
      await tx.draftSession.update({ where: { id: nextDraft.id }, data: {
        draftType: draft.draftType, rounds: draft.rounds, teamCount: members.length, slotOrder,
        timerSeconds: draft.timerSeconds, thirdRoundReversal: draft.thirdRoundReversal,
        auctionBudgetPerTeam: draft.auctionBudgetPerTeam, aiAutoPick: draft.aiAutoPick, cpuAutoPick: draft.cpuAutoPick,
        playerPool: draft.playerPool, alphabeticalSort: false, customRankingsEnabled: draft.customRankingsEnabled,
        inDraftPlayerTradesEnabled: draft.inDraftPlayerTradesEnabled, onClockTradeTimerBehavior: draft.onClockTradeTimerBehavior,
      } })
      await tx.redraftLeagueDraftProfile.update({ where: { leagueId }, data: {
        draftType: draft.draftType, rounds: draft.rounds, timerSeconds: draft.timerSeconds,
        auctionBudget: draft.auctionBudgetPerTeam, orderMode: 'manual', scheduledAt: null, draftStatus: 'pre_draft',
      } })
      // No last-season role records, resources, payouts, balances, or paid-manager lists enter the new league.
      const nextZombie = await tx.zombieLeague.create({ data: {
        ...detachedPolicy(z, ['league','paidConfig','freeRewardConfig','rulesSnapshot','commissionerUiPrefs','season','leagueId','status','currentWeek','potTotal','draftScheduledAt','currentTeamCount','slug','name']),
        leagueId, universeId, levelId: z.levelId, name: body.leagueName, season: season+1, status: 'setup',
        currentWeek: 0, seasonStartWeek: 1, commissionerId: actor, currentTeamCount: members.length, potTotal: 0, draftScheduledAt: null, slug: '',
        ...(z.commissionerUiPrefs != null ? { commissionerUiPrefs: z.commissionerUiPrefs as Prisma.InputJsonValue } : {}),
      } as Prisma.ZombieLeagueUncheckedCreateInput })
      await tx.zombieLeagueConfig.create({ data: {
        ...detachedPolicy(old.zombieConfig!, [], ['weaponScoreThresholds']), leagueId, universeId,
      } as Prisma.ZombieLeagueConfigUncheckedCreateInput })
      if (z.paidConfig) await tx.zombiePaidConfig.create({ data: {
        ...detachedPolicy(z.paidConfig, ['totalPot','weeklyPayoutPool','ultimateSurvivorPot','paidUserIds','totalCollected','totalPaidOut','potIsLocked']),
        zombieLeagueId: nextZombie.id, buyInAmount: z.paidConfig.buyInAmount, paidUserIds: [], totalCollected: 0, totalPaidOut: 0, totalPot: 0, weeklyPayoutPool: 0, ultimateSurvivorPot: 0, potIsLocked: false,
      } as Prisma.ZombiePaidConfigUncheckedCreateInput })
      if (z.freeRewardConfig) await tx.zombieFreeRewardConfig.create({ data: {
        ...detachedPolicy(z.freeRewardConfig, ['symbolicPotTotal','symbolicWeeklyPool']), zombieLeagueId: nextZombie.id, symbolicPotTotal: 0, symbolicWeeklyPool: 0,
      } as Prisma.ZombieFreeRewardConfigUncheckedCreateInput })
      await tx.findLeagueListing.updateMany({ where: { leagueId }, data: { isActive: false } })
      created.push({ previousLeagueId: z.leagueId, leagueId, draftId: nextDraft.id })
    }
    const result = { version: 1, universeId, season, nextSeason: season+1, previewHash, leagues: created,
      placements: plan!.assignments.map(m=>({ userId: m.userId, previousRosterId: m.rosterId,
        leagueId: created.find(c=>c.previousLeagueId===m.destinationLeagueId)!.leagueId, slot: m.slot, movement: m.movement })),
      alreadyRenewed: false }
    await tx.zombieAuditLog.create({ data: { universeId, leagueId: sources[0].leagueId, eventType: EVENT,
      metadata: result as unknown as Prisma.InputJsonValue } })
    const announcementLeague = await tx.zombieLeague.findUniqueOrThrow({ where: { leagueId: created[0].leagueId } })
    await tx.zombieAnnouncement.create({ data: { universeId, zombieLeagueId: announcementLeague.id, type: 'season_renewal', title: 'Next season is ready',
      content: 'Season ' + (season+1) + ': ' + created.length + ' leagues have fresh rosters and unstarted drafts. Previous-season results and prizes remain in their original leagues.' } })
    return result
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120000, maxWait: 20000 })
  for (let attempt=0;;attempt++) {
    try { return await run() } catch(error) {
      if (attempt>=2 || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code!=='P2034') throw error
    }
  }
}
