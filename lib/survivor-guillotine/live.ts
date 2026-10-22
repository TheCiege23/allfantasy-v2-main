import 'server-only'

import { createHash, randomInt, randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { addPlayerToRosterData, getRosterPlayerIds, removePlayerFromRosterData } from '@/lib/waiver-wire/roster-utils'
import { createPlatformNotification } from '@/lib/platform/notification-service'
import { buildSGSchedule } from './config'
import { resolveSGPeriod } from './competition'
import { loadCappedGameScores } from './capped-scoring'
import { isAutomaticCeremonyDue, partitionReleasedPlayers, selectActiveFinalScores } from './corrections'
import { createSGWeeklyReward, seedSGDraftIdols } from './rewards'
import { parseSGActionCommand, parseSGPowerCommand, powersVisibleTo, validateSGPowerPlay } from './powers'
import type { SGConfig, SGMatchup, SGPower, SGTeam } from './types'

export type SGTribeMember = { rosterId: string; tribeId: string; captain?: boolean }
export type SGLivePeriod = {
  period: number
  matchups: SGMatchup[]
  champions: string[]
  sitOuts: string[]
  priorSitOuts: string[]
  ceremonyAt: string | null
  scoringStartsAt?: string | null
  scoringEndsAt?: string | null
  selectionDeadlineAt?: string | null
  selectionOrder?: string[]
  selectionFallbackAppliedAt?: string | null
  immunityDeadlineAt?: string | null
  playerPowerDeadlineAt?: string | null
  ceremonyStarted: boolean
  placements?: string[]
  gauntletImmuneTribeId?: string
  commissionerTie?: { immuneTribeId: string | null; choppedTeamIds: string[]; placements: string[]; reason: string }
  chopSnapshot?: {
    teams: SGTeam[]
    protectedTeamIds: string[]
    powerIds: string[]
    choppedTeamIds: string[]
    immuneTribeId: string | null
  }
}

export function readSGPeriodState(value: unknown): SGLivePeriod | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (!Number.isInteger(row.period) || Number(row.period) < 1) return null
  const strings = (key: string) => Array.isArray(row[key]) ? (row[key] as unknown[]).filter((x): x is string => typeof x === 'string') : []
  const matchups = Array.isArray(row.matchups) ? row.matchups.filter((m): m is SGMatchup =>
    !!m && typeof m === 'object' && typeof m.team1 === 'string' && typeof m.team2 === 'string') : []
  return { period: Number(row.period), matchups, champions: strings('champions'), sitOuts: strings('sitOuts'),
    priorSitOuts: strings('priorSitOuts'), ceremonyAt: typeof row.ceremonyAt === 'string' ? row.ceremonyAt : null,
    scoringStartsAt: typeof row.scoringStartsAt === 'string' ? row.scoringStartsAt : null,
    scoringEndsAt: typeof row.scoringEndsAt === 'string' ? row.scoringEndsAt : null,
    selectionDeadlineAt: typeof row.selectionDeadlineAt === 'string' ? row.selectionDeadlineAt : null,
    selectionOrder: strings('selectionOrder'),
    selectionFallbackAppliedAt: typeof row.selectionFallbackAppliedAt === 'string' ? row.selectionFallbackAppliedAt : null,
    immunityDeadlineAt: typeof row.immunityDeadlineAt === 'string' ? row.immunityDeadlineAt : null,
    playerPowerDeadlineAt: typeof row.playerPowerDeadlineAt === 'string' ? row.playerPowerDeadlineAt : null,
    ceremonyStarted: row.ceremonyStarted === true, placements: strings('placements'),
    gauntletImmuneTribeId: typeof row.gauntletImmuneTribeId === 'string' ? row.gauntletImmuneTribeId : undefined,
    commissionerTie: row.commissionerTie && typeof row.commissionerTie === 'object' && !Array.isArray(row.commissionerTie)
      ? row.commissionerTie as SGLivePeriod['commissionerTie'] : undefined,
    chopSnapshot: row.chopSnapshot && typeof row.chopSnapshot === 'object' && !Array.isArray(row.chopSnapshot)
      ? row.chopSnapshot as SGLivePeriod['chopSnapshot'] : undefined }
}

export function readSGTribes(value: unknown): SGTribeMember[] {
  if (!Array.isArray(value)) return []
  return value.filter((m): m is SGTribeMember => !!m && typeof m === 'object' &&
    typeof m.rosterId === 'string' && typeof m.tribeId === 'string')
}

export async function saveSGLiveLeague(leagueId: string, config: SGConfig) {
  const schedule = buildSGSchedule(config)
  if (schedule.errors.length) throw new Error(schedule.errors.join(' '))
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, leagueSize: true,
    leagueVariant: true, guillotineMode: true, survivorMode: true } })
  if (!league) throw new Error('League not found.')
  if (league.sport !== config.sport) throw new Error('Rules sport must match the live league.')
  if (league.leagueSize && league.leagueSize !== config.teamCount) throw new Error('Starting manager count must match the live league size.')
  if (league.leagueVariant && league.leagueVariant !== 'survivor_guillotine') throw new Error('This league already runs another specialty format.')
  if (league.guillotineMode || league.survivorMode) throw new Error('A league using the older Guilly or Survivor engine cannot be converted in place.')
  const rosters = await prisma.roster.count({ where: { leagueId } })
  if (rosters && rosters !== config.teamCount) throw new Error(`Live league has ${rosters} rosters; rules specify ${config.teamCount}.`)
  const existing = await prisma.survivorGuillotineLeague.findUnique({ where: { leagueId } })
  if (existing?.status !== 'setup' && existing) throw new Error('An active season cannot be reconfigured after play begins.')
  if (existing && await prisma.survivorGuillotinePower.count({ where: { leagueId } })) throw new Error('Rules are locked after hidden powers are seeded.')
  if (await prisma.waiverTransaction.count({ where: { leagueId } })) throw new Error('FAAB budget cannot be reset after waiver transactions.')
  return prisma.$transaction(async tx => {
    const currentLeague = await tx.league.findUniqueOrThrow({ where: { id: leagueId }, select: { settings: true } })
    const settings = currentLeague.settings && typeof currentLeague.settings === 'object' && !Array.isArray(currentLeague.settings)
      ? currentLeague.settings as Record<string, unknown> : {}
    const current = await tx.survivorGuillotineLeague.findUnique({ where: { leagueId }, select: { status: true } })
    if (current?.status !== 'setup' && current) throw new Error('An active season cannot be reconfigured.')
    if (await tx.survivorGuillotinePower.count({ where: { leagueId } })) throw new Error('Rules are locked after hidden powers are seeded.')
    const result = await tx.survivorGuillotineLeague.upsert({ where: { leagueId },
      create: { id: randomUUID(), leagueId, config: config as unknown as Prisma.InputJsonValue },
      update: { config: config as unknown as Prisma.InputJsonValue, revision: { increment: 1 } },
      select: { leagueId: true, status: true, revision: true } })
    await tx.league.update({ where: { id: leagueId }, data: { leagueVariant: 'survivor_guillotine', waiverType: 'faab', waiverBudget: config.faabBudget,
      settings: { ...settings, survivorGuillotine: { tradesEnabled: config.tradesEnabled } } as Prisma.InputJsonValue } })
    await tx.leagueWaiverSettings.upsert({ where: { leagueId },
      create: { leagueId, waiverType: 'faab', faabBudget: config.faabBudget, instantFaAfterClear: false },
      update: { waiverType: 'faab', faabBudget: config.faabBudget, instantFaAfterClear: false } })
    await tx.roster.updateMany({ where: { leagueId }, data: { faabRemaining: config.faabBudget } })
    await tx.redraftRoster.updateMany({ where: { leagueId }, data: { faabBalance: config.faabBudget } })
    return result
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

export async function configureSGLivePeriod(leagueId: string, tribes: SGTribeMember[], state: SGLivePeriod, expectedRevision: number) {
  const season = await prisma.survivorGuillotineLeague.findUnique({ where: { leagueId } })
  if (!season) throw new Error('Save the league rules first.')
  if (season.revision !== expectedRevision) throw new Error('Season changed; reload before saving the period.')
  const config = season.config as unknown as SGConfig
  const schedule = buildSGSchedule(config)
  if (!schedule.periods.some(p => p.period === state.period)) throw new Error('Unknown scoring period.')
  if (state.period < season.currentPeriod) throw new Error('Cannot rewrite a completed period.')
  if (state.period > season.currentPeriod + 1) throw new Error('Complete the previous period first.')
  const previousState = readSGPeriodState(season.periodState)
  if (state.period === season.currentPeriod && previousState?.ceremonyStarted) throw new Error('A completed period cannot be reconfigured.')
  if (state.period === season.currentPeriod && await prisma.survivorGuillotinePower.count({ where: { leagueId,
    kind: 'tribe_swap', status: 'used', activationPeriod: state.period } })) {
    const original = readSGTribes(season.tribes)
    const same = original.length === tribes.length && original.every(old => tribes.some(next =>
      next.rosterId === old.rosterId && next.tribeId === old.tribeId))
    if (!same) throw new Error('A played tribe-swap token locked this period’s tribe assignments.')
  }
  if (state.period === 1 && !(await prisma.survivorGuillotinePower.count({ where: { leagueId, kind: 'personal_immunity', binding: 'player' } }))) throw new Error('Seed the hidden draft idol pool before Week 1.')
  const rosters = await prisma.roster.findMany({ where: { leagueId }, select: { id: true, playerData: true } })
  const allowed = new Set(rosters.map(r => r.id))
  if (new Set(tribes.map(m => m.rosterId)).size !== tribes.length || tribes.some(m => !allowed.has(m.rosterId))) throw new Error('Tribe assignments must use distinct league rosters.')
  const tribeIds = new Set(tribes.map(m => m.tribeId))
  if (tribeIds.size > config.tribeCount || tribeIds.size < 1) throw new Error('Invalid tribe count.')
  if (state.champions.some(id => !allowed.has(id)) || state.sitOuts.some(id => !allowed.has(id)) ||
      state.matchups.some(m => !allowed.has(m.team1) || !allowed.has(m.team2))) throw new Error('Period choices include a roster outside this league.')
  if (state.ceremonyAt && !Number.isFinite(Date.parse(state.ceremonyAt))) throw new Error('Invalid ceremony date.')
  if (state.ceremonyAt === null && schedule.periods.find(p => p.period === state.period)?.chops) throw new Error('Set the chop ceremony time for this scoring period.')
  if (config.sport === 'NBA' && config.nbaScoring === 'capped_games' &&
      schedule.periods.find(p => p.period === state.period)?.mode !== 'off' &&
      (!state.scoringStartsAt || !state.scoringEndsAt ||
        !Number.isFinite(Date.parse(state.scoringStartsAt)) || !Number.isFinite(Date.parse(state.scoringEndsAt)) ||
        Date.parse(state.scoringStartsAt) >= Date.parse(state.scoringEndsAt) ||
        (state.ceremonyAt && Date.parse(state.ceremonyAt) < Date.parse(state.scoringEndsAt)))) {
    throw new Error('Set valid start and end dates for this NBA scoring period.')
  }
  if (config.immunityDeadline === 'custom' && (!state.immunityDeadlineAt || !Number.isFinite(Date.parse(state.immunityDeadlineAt)))) throw new Error('Set this period’s custom immunity deadline.')
  if (config.playerPowerDeadline === 'custom' && (!state.playerPowerDeadlineAt || !Number.isFinite(Date.parse(state.playerPowerDeadlineAt)))) throw new Error('Set this period’s custom player-power deadline.')
  const { chopSnapshot: _clientSnapshot, ...publicChoices } = state
  const safeState = { ...publicChoices, ceremonyStarted: false, placements: [],
    priorSitOuts: state.period === previousState?.period ? previousState.priorSitOuts : previousState?.sitOuts ?? [] }
  if (safeState.sitOuts.some(id => safeState.priorSitOuts.includes(id))) throw new Error('Managers cannot sit out consecutive scoring periods.')
  await prisma.$transaction(async tx => {
    if (state.period === 1) {
      const personal = await tx.survivorGuillotinePower.findFirst({ where: { leagueId, kind: 'personal_immunity', binding: 'player' } })
      if (!personal) throw new Error('The guaranteed personal immunity idol is missing.')
      const drafted = rosters.flatMap(r => getRosterPlayerIds(r.playerData))
      if (!personal.playerId || !drafted.includes(personal.playerId)) {
        const attached = await tx.survivorGuillotinePower.findMany({ where: { leagueId, playerId: { not: null } }, select: { playerId: true } })
        const reserved = new Set(attached.map(p => p.playerId))
        const choices = [...new Set(drafted)].filter(id => !reserved.has(id))
        if (!choices.length) throw new Error('Draft rosters need an unbound player for the guaranteed idol.')
        await tx.survivorGuillotinePower.update({ where: { id: personal.id }, data: { playerId: choices[randomInt(choices.length)] } })
      }
    }
    const saved = await tx.survivorGuillotineLeague.updateMany({ where: { leagueId, revision: season.revision }, data: {
      tribes: tribes as unknown as Prisma.InputJsonValue, periodState: safeState as unknown as Prisma.InputJsonValue,
      status: 'active', currentPeriod: state.period, revision: { increment: 1 },
    } })
    if (saved.count !== 1) throw new Error('Season changed while saving; reload and try again.')
    return saved
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  return prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId }, select: { leagueId: true, currentPeriod: true, revision: true } })
}

export async function seedSGLiveDraftPowers(leagueId: string, playerIds: string[], count: number) {
  const season = await prisma.survivorGuillotineLeague.findUnique({ where: { leagueId } })
  if (!season || season.status !== 'setup') throw new Error('Powers must be seeded before the season starts.')
  const existing = await prisma.survivorGuillotinePower.count({ where: { leagueId } })
  if (existing) throw new Error('Draft powers are already seeded.')
  const config = season.config as unknown as SGConfig
  const uniqueIds = [...new Set(playerIds)]
  if (uniqueIds.length !== playerIds.length || uniqueIds.length < count) throw new Error('Choose distinct eligible draft players.')
  const verified = await prisma.player.findMany({ where: { id: { in: uniqueIds }, sport: config.sport },
    select: { id: true } })
  const known = new Set(verified.map(player => player.id))
  const unresolved = uniqueIds.filter(id => !known.has(id))
  if (unresolved.length) {
    // Native provider IDs are often not Player primary keys. A completed pick plus live roster
    // ownership is the authoritative same-league proof for those IDs.
    const draft = await prisma.draftSession.findFirst({ where: { leagueId, status: 'completed' },
      orderBy: { completedAt: 'desc' }, select: { id: true } })
    const [picks, rosters] = await Promise.all([
      draft ? prisma.draftPick.findMany({ where: { sessionId: draft.id, playerId: { in: unresolved } },
        select: { playerId: true } }) : Promise.resolve([]),
      prisma.roster.findMany({ where: { leagueId }, select: { playerData: true } }),
    ])
    const picked = new Set(picks.map(pick => pick.playerId))
    const owned = new Set(rosters.flatMap(roster => getRosterPlayerIds(roster.playerData)))
    if (unresolved.some(id => !picked.has(id) || !owned.has(id))) {
      throw new Error('Draft pool includes a missing player or a different sport.')
    }
  }
  const merge = buildSGSchedule(config).periods.find(p => p.mode === 'merged')?.period
  if (!merge) throw new Error('A merge period is required.')
  const powers = seedSGDraftIdols({ playerIds, count, allowedKinds: config.enabledPowers, expiresAfterPeriod: merge - 1 })
  await prisma.$transaction(async tx => {
    const claimed = await tx.survivorGuillotineLeague.updateMany({ where: { leagueId, revision: season.revision,
      status: 'setup' }, data: { revision: { increment: 1 } } })
    if (claimed.count !== 1 || await tx.survivorGuillotinePower.count({ where: { leagueId } })) throw new Error('Draft powers were already seeded or rules changed.')
    await tx.survivorGuillotinePower.createMany({ data: powers.map(p => ({ id: p.id, leagueId,
      kind: p.kind, binding: p.binding, playerId: p.playerId,
      expiresAfterPeriod: p.expiresAfterPeriod })) })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  return { count: powers.length }
}

/** A commissioner selects the reward week; the server chooses type and finalized high scorer. */
export async function awardSGLiveWeeklyPower(leagueId: string, period: number) {
  const season = await prisma.survivorGuillotineLeague.findUnique({ where: { leagueId } })
  if (!season || season.status !== 'active') throw new Error('The season is not active.')
  const config = season.config as unknown as SGConfig
  const merge = buildSGSchedule(config).periods.find(p => p.mode === 'merged')?.period ?? config.championshipPeriod
  if (!Number.isInteger(period) || period < 1 || period >= merge - 1 || period > season.currentPeriod) throw new Error('A finalized pre-merge period with time to use the reward is required.')
  if (!Array.isArray(season.rewardPeriods) || !season.rewardPeriods.includes(period) ||
      !(season.periodHistory as Record<string, unknown>)[String(period)]) throw new Error('This period was not scheduled for a concealed reward or has not completed.')
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { season: true } })
  if (!league) throw new Error('League not found.')
  const scores = await prisma.teamWeekResult.findMany({ where: { leagueId, season: league.season, week: period, status: 'final' },
    select: { rosterId: true, totalPoints: true }, orderBy: { totalPoints: 'desc' } })
  const history = season.scoreHistory && typeof season.scoreHistory === 'object' && !Array.isArray(season.scoreHistory)
    ? season.scoreHistory as Record<string, Record<string, number>> : {}
  const scored = history[String(period)]
    ? scores.map(row => ({ ...row, totalPoints: history[String(period)][row.rosterId] ?? row.totalPoints }))
      .sort((a, b) => b.totalPoints - a.totalPoints)
    : scores
  const pastChops = await prisma.survivorGuillotineChop.findMany({ where: { leagueId, period: { lt: period }, reversedAt: null }, select: { rosterId: true } })
  const eliminated = new Set(pastChops.map(c => c.rosterId))
  const eligible = scored.filter(s => !eliminated.has(s.rosterId))
  const expectedActive = await prisma.roster.count({ where: { leagueId } }) - eliminated.size
  if (eligible.length !== expectedActive) throw new Error('All active managers need finalized scores before a reward is awarded.')
  if (eligible.length < 2 || eligible[0].totalPoints === eligible[1].totalPoints) throw new Error('A unique finalized high scorer is required.')
  const winner = await prisma.leagueTeam.findFirst({ where: { leagueId, externalId: eligible[0].rosterId }, select: { claimedByUserId: true } })
  if (!winner?.claimedByUserId) throw new Error('The winning manager must claim their league team before receiving a private reward.')
  const reward = createSGWeeklyReward({ managerId: winner.claimedByUserId, allowedKinds: config.enabledPowers,
    expiresAfterPeriod: merge - 1 })
  await prisma.survivorGuillotinePower.create({ data: { id: reward.id, leagueId, kind: reward.kind, binding: 'manager',
    ownerUserId: reward.ownerId, awardPeriod: period, expiresAfterPeriod: reward.expiresAfterPeriod,
    source: 'weekly_reward' } })
  await createPlatformNotification({ userId: reward.ownerId, leagueId, type: 'survivor_guillotine_reward',
    title: 'Chimmy has a private reward for you', body: `You earned a hidden ${reward.kind.replaceAll('_', ' ')}. Open your Survivor Guilly powers to use it before the merge.`,
    sourceKey: `survivor-guillotine:${leagueId}:reward:${period}:${reward.ownerId}` })
  return { awarded: true, period }
}

export async function readSGLivePowers(leagueId: string, userId: string): Promise<SGPower[]> {
  const [rows, teams, rosters] = await Promise.all([
    prisma.survivorGuillotinePower.findMany({ where: { leagueId, status: { in: ['held', 'sealed', 'used'] } } }),
    prisma.leagueTeam.findMany({ where: { leagueId, claimedByUserId: userId, eliminatedAt: null }, select: { externalId: true } }),
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, playerData: true, redraftRosterId: true } }),
  ])
  const ownRosterIds = new Set(teams.map(t => t.externalId).filter(Boolean))
  const powers: SGPower[] = rows.map(row => {
    const playerRoster = row.playerId ? rosters.find(r => getRosterPlayerIds(r.playerData).includes(row.playerId!)) : null
    const ownerId = row.binding === 'player' ? (playerRoster && ownRosterIds.has(playerRoster.id) ? userId : '')
      : ownRosterIds.size > 0 ? row.ownerUserId ?? '' : ''
    return { id: row.id, kind: row.kind as SGPower['kind'], binding: row.binding as SGPower['binding'],
      playerId: row.playerId, ownerId, expiresAfterPeriod: row.expiresAfterPeriod,
      status: row.status as SGPower['status'], targetTeamId: row.targetRosterId, revealed: !!row.revealedAt }
  })
  return powersVisibleTo(powers, userId)
}

async function activateSGLiveImmunity(leagueId: string, userId: string, message: string) {
  const command = parseSGPowerCommand(message)
  if (!command) return null
  const season = await prisma.survivorGuillotineLeague.findUnique({ where: { leagueId } })
  if (!season) return null
  const state = readSGPeriodState(season.periodState)
  if (!state || state.period !== season.currentPeriod) throw new Error('The current period is not ready.')
  const config = season.config as unknown as SGConfig
  const merge = buildSGSchedule(config).periods.find(p => p.mode === 'merged')?.period ?? config.championshipPeriod
  const row = await prisma.survivorGuillotinePower.findFirst({ where: { id: command.powerId, leagueId } })
  if (!row) throw new Error('This power is unavailable.')
  if (row.awardPeriod != null && state.period <= row.awardPeriod) throw new Error('This weekly reward becomes usable next scoring period.')
  if (row.kind !== 'personal_immunity' && row.kind !== 'ally_immunity') throw new Error('This action power requires the dedicated commissioner action flow.')
  const owned = await prisma.leagueTeam.findMany({ where: { leagueId, claimedByUserId: userId, eliminatedAt: null }, select: { externalId: true } })
  const ownIds = owned.map(t => t.externalId)
  if (ownIds.length !== 1) throw new Error('Choose one claimed, active league team to play an idol.')
  const ownRosters = await prisma.roster.findMany({ where: { leagueId, id: { in: ownIds } }, select: { id: true, playerData: true } })
  const rosterPlayerIds = ownRosters.flatMap(r => getRosterPlayerIds(r.playerData))
  const power: SGPower = { id: row.id, kind: row.kind as SGPower['kind'], binding: row.binding as SGPower['binding'],
    playerId: row.playerId, ownerId: row.binding === 'player' ? (row.playerId && rosterPlayerIds.includes(row.playerId) ? userId : '') : row.ownerUserId ?? '',
    expiresAfterPeriod: row.expiresAfterPeriod, status: row.status as SGPower['status'], targetTeamId: row.targetRosterId, revealed: !!row.revealedAt }
  const deadline = config.immunityDeadline === 'custom' ? state.immunityDeadlineAt : state.ceremonyAt
  const error = validateSGPowerPlay({ power, managerId: userId, period: state.period, mergePeriod: merge,
    now: new Date().toISOString(), deadline: deadline ?? '', ceremonyStarted: state.ceremonyStarted, rosterPlayerIds })
  if (error) throw new Error(error)
  const targetRosterId = row.kind === 'personal_immunity' ? ownIds[0] : command.targetId
  if (!targetRosterId) throw new Error('A target roster is required.')
  const tribeMembers = readSGTribes(season.tribes)
  if (!tribeMembers.some(m => m.rosterId === targetRosterId)) throw new Error('Target must be an active league roster.')
  if (await prisma.survivorGuillotineChop.count({ where: { leagueId, rosterId: targetRosterId, reversedAt: null } })) throw new Error('An eliminated roster cannot receive immunity.')
  await prisma.$transaction(async tx => {
    if (!deadline || Date.now() >= Date.parse(deadline)) throw new Error('The immunity deadline passed.')
    const claimedSeason = await tx.survivorGuillotineLeague.updateMany({ where: { leagueId, revision: season.revision },
      data: { revision: { increment: 1 } } })
    if (claimedSeason.count !== 1) throw new Error('Season changed; reload before activating.')
    const updated = await tx.survivorGuillotinePower.updateMany({ where: { id: row.id, leagueId, status: 'held' },
      data: { status: 'sealed', targetRosterId, activatedAt: new Date(), activationPeriod: state.period } })
    if (updated.count !== 1) throw new Error('Power was already activated.')
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  return { reply: 'Your immunity is sealed. The league will see it at the chop ceremony.', powerId: row.id }
}

/** Executes non-immunity tokens privately, then reveals the completed action to league chat. */
export async function activateSGLivePower(leagueId: string, userId: string, message: string) {
  const command = parseSGActionCommand(message)
  if (!command) return null
  const row = await prisma.survivorGuillotinePower.findFirst({ where: { leagueId, id: command.powerId } })
  if (!row || row.status !== 'held') throw new Error('This power is unavailable.')
  const claimedTeams = await prisma.leagueTeam.findMany({ where: { leagueId, claimedByUserId: userId,
    eliminatedAt: null }, select: { externalId: true } })
  const claimedRosterIds = claimedTeams.map(t => t.externalId)
  if (!claimedRosterIds.length) throw new Error('This power is unavailable.')
  if (row.binding === 'manager' && row.ownerUserId !== userId) throw new Error('This power is unavailable.')
  if (row.binding === 'player') {
    const ownedRosters = await prisma.roster.findMany({ where: { leagueId, id: { in: claimedRosterIds } }, select: { playerData: true } })
    if (!row.playerId || !ownedRosters.some(r => getRosterPlayerIds(r.playerData).includes(row.playerId!))) throw new Error('This power is unavailable.')
  }
  if (row.kind === 'personal_immunity' || row.kind === 'ally_immunity') return activateSGLiveImmunity(leagueId, userId, message)
  const season = await prisma.survivorGuillotineLeague.findUnique({ where: { leagueId } })
  const state = readSGPeriodState(season?.periodState)
  if (!season || !state || state.period !== season.currentPeriod) throw new Error('The current period is not ready.')
  if (row.awardPeriod != null && state.period <= row.awardPeriod) throw new Error('This weekly reward becomes usable next scoring period.')
  const config = season.config as unknown as SGConfig
  const merge = buildSGSchedule(config).periods.find(p => p.mode === 'merged')?.period ?? config.championshipPeriod
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { season: true, userId: true, rosterSize: true } })
  if (!league) throw new Error('League not found.')
  const ownTeams = await prisma.leagueTeam.findMany({ where: { leagueId, claimedByUserId: userId, eliminatedAt: null }, select: { externalId: true } })
  const ownIds = ownTeams.map(t => t.externalId)
  if (ownIds.length !== 1) throw new Error('Choose one claimed, active league team to play a token.')
  const ownRoster = await prisma.roster.findUnique({ where: { id: ownIds[0] }, select: { id: true, playerData: true, faabRemaining: true, redraftRosterId: true, updatedAt: true } })
  if (!ownRoster) throw new Error('Your roster is unavailable.')
  const rosterPlayerIds = getRosterPlayerIds(ownRoster.playerData)
  const power: SGPower = { id: row.id, kind: row.kind as SGPower['kind'], binding: row.binding as SGPower['binding'],
    playerId: row.playerId, ownerId: row.binding === 'player' ? (row.playerId && rosterPlayerIds.includes(row.playerId) ? userId : '') : row.ownerUserId ?? '',
    expiresAfterPeriod: row.expiresAfterPeriod, status: row.status as SGPower['status'], targetTeamId: row.targetRosterId, revealed: !!row.revealedAt }
  const possibleStealOwners = command.targetId && row.kind === 'steal_player'
    ? (await prisma.roster.findMany({ where: { leagueId }, select: { id: true, playerData: true, redraftRosterId: true, updatedAt: true } }))
        .filter(r => getRosterPlayerIds(r.playerData).includes(command.targetId!)) : []
  if (possibleStealOwners.length > 1) throw new Error('Target player has ambiguous roster ownership.')
  const targetRoster = command.targetId && row.kind === 'tribe_swap'
    ? await prisma.roster.findFirst({ where: { id: command.targetId, leagueId }, select: { id: true, playerData: true, redraftRosterId: true, updatedAt: true } })
    : command.targetId && row.kind === 'steal_player'
      ? possibleStealOwners[0] ?? null
      : null
  if (row.kind !== 'faab_bonus' && (!targetRoster || targetRoster.id === ownRoster.id)) throw new Error('Choose an active target outside your roster.')
  if (targetRoster && await prisma.survivorGuillotineChop.count({ where: { leagueId, rosterId: targetRoster.id, reversedAt: null } })) throw new Error('An eliminated roster cannot be targeted.')
  let targetLocked = false
  let deadline = config.playerPowerDeadline === 'custom' ? state.playerPowerDeadlineAt ?? null : null
  if (row.binding === 'manager') deadline = state.ceremonyAt
  if (row.binding === 'player' && row.playerId) {
    const attached = await prisma.player.findFirst({ where: { id: row.playerId }, select: { team: true, sport: true } })
    const nativePick = attached?.sport !== config.sport ? await prisma.draftPick.findFirst({ where: {
      playerId: row.playerId, session: { is: { leagueId, status: 'completed' } } },
      orderBy: { pickedAt: 'desc' }, select: { team: true } }) : null
    const playerTeam = attached?.sport === config.sport ? attached.team : nativePick?.team
    if (!playerTeam) throw new Error('The attached player has no verifiable next game.')
    const nextGame = await prisma.gameSchedule.findFirst({ where: { sportType: config.sport, season: league.season,
      weekOrRound: state.period, startTime: { gt: new Date() }, OR: [{ homeTeam: playerTeam }, { awayTeam: playerTeam }] },
      orderBy: { startTime: 'asc' }, select: { startTime: true } })
    const ownPlayer = ownRoster.redraftRosterId ? await prisma.redraftRosterPlayer.findFirst({ where: {
      rosterId: ownRoster.redraftRosterId, playerId: row.playerId, droppedAt: null }, select: { isLocked: true } }) : null
    if (!nextGame?.startTime || ownPlayer?.isLocked !== false) throw new Error('The attached player has locked or has no upcoming game.')
    if (!deadline || nextGame.startTime < new Date(deadline)) deadline = nextGame.startTime.toISOString()
  }
  if (row.kind === 'steal_player') {
    if (league.rosterSize == null || league.rosterSize < 1) throw new Error('Set a league roster size before player steals are enabled.')
    const player = await prisma.player.findFirst({ where: { id: command.targetId! }, select: { team: true, sport: true } })
    if (!player?.team || player.sport !== config.sport) throw new Error('Target player is unavailable.')
    const game = await prisma.gameSchedule.findFirst({ where: { sportType: config.sport, season: league.season,
      weekOrRound: state.period, startTime: { gt: new Date() }, OR: [{ homeTeam: player.team }, { awayTeam: player.team }] },
      orderBy: { startTime: 'asc' }, select: { startTime: true } })
    const targetPlayer = targetRoster?.redraftRosterId ? await prisma.redraftRosterPlayer.findFirst({ where: {
      rosterId: targetRoster.redraftRosterId, playerId: command.targetId!, droppedAt: null }, select: { isLocked: true } }) : null
    const lock = targetRoster ? await prisma.afLineupLockState.findFirst({ where: { rosterId: targetRoster.id,
      season: league.season, week: state.period }, select: { globalLocked: true, lockedPlayerIds: true } }) : null
    const lockedIds = Array.isArray(lock?.lockedPlayerIds) ? lock.lockedPlayerIds : []
    targetLocked = !game?.startTime || targetPlayer?.isLocked !== false || lock?.globalLocked === true || lockedIds.includes(command.targetId)
    if (!game?.startTime) deadline = ''
    else if (!deadline || game.startTime < new Date(deadline)) deadline = game.startTime.toISOString()
    if (!targetRoster?.redraftRosterId || !ownRoster.redraftRosterId) throw new Error('Both rosters need live player records for a steal.')
    if (command.dropPlayerId && !rosterPlayerIds.includes(command.dropPlayerId)) throw new Error('Drop player must be on your roster.')
  }
  if (row.kind === 'tribe_swap') {
    const firstGame = await prisma.gameSchedule.findFirst({ where: { sportType: config.sport,
      season: league.season, weekOrRound: state.period, startTime: { not: null } },
      orderBy: { startTime: 'asc' }, select: { startTime: true } })
    if (!firstGame?.startTime || firstGame.startTime <= new Date()) throw new Error('Tribe swaps close before the first game of the period.')
    if (!deadline || firstGame.startTime < new Date(deadline)) deadline = firstGame.startTime.toISOString()
  }
  const error = validateSGPowerPlay({ power, managerId: userId, period: state.period, mergePeriod: merge,
    now: new Date().toISOString(), deadline: deadline ?? '', ceremonyStarted: state.ceremonyStarted,
    rosterPlayerIds, targetPlayerLocked: targetLocked,
    rosterFull: row.kind === 'steal_player' && league.rosterSize != null && rosterPlayerIds.length >= league.rosterSize,
    dropPlayerId: command.dropPlayerId ?? undefined })
  if (error) throw new Error(error)
  const members = readSGTribes(season.tribes)
  const ownMember = members.find(m => m.rosterId === ownRoster.id)
  const targetMember = targetRoster ? members.find(m => m.rosterId === targetRoster.id) : null
  if (row.kind === 'tribe_swap' && (!ownMember || !targetMember || ownMember.tribeId === targetMember.tribeId)) throw new Error('Swap requires managers from different tribes.')
  if (row.kind === 'tribe_swap' && (state.matchups.length > 0 || state.champions.length > 0)) throw new Error('Tribe swaps close once matchups or champions are submitted.')
  const now = new Date()
  await prisma.$transaction(async tx => {
    if (!deadline || Date.now() >= Date.parse(deadline)) throw new Error('The activation deadline passed.')
    const claimedSeason = await tx.survivorGuillotineLeague.updateMany({ where: { leagueId, revision: season.revision },
      data: { revision: { increment: 1 } } })
    if (claimedSeason.count !== 1) throw new Error('Season changed; reload before activating.')
    const claimed = await tx.survivorGuillotinePower.updateMany({ where: { id: row.id, leagueId, status: 'held' },
      data: { status: 'used', activatedAt: now, revealedAt: now, activationPeriod: state.period,
        targetRosterId: targetRoster?.id ?? ownRoster.id } })
    if (claimed.count !== 1) throw new Error('Power was already activated.')
    if (row.kind === 'faab_bonus') {
      await tx.roster.update({ where: { id: ownRoster.id }, data: { faabRemaining: { increment: 25 } } })
      if (ownRoster.redraftRosterId) await tx.redraftRoster.update({ where: { id: ownRoster.redraftRosterId }, data: { faabBalance: { increment: 25 } } })
    } else if (row.kind === 'tribe_swap' && targetRoster && ownMember && targetMember) {
      const next = members.map(m => m.rosterId === ownRoster.id ? { ...m, tribeId: targetMember.tribeId } :
        m.rosterId === targetRoster.id ? { ...m, tribeId: ownMember.tribeId } : m)
      await tx.survivorGuillotineLeague.update({ where: { leagueId }, data: { tribes: next as unknown as Prisma.InputJsonValue } })
    } else if (row.kind === 'steal_player' && targetRoster && command.targetId) {
      if (command.dropPlayerId) {
        await tx.redraftRosterPlayer.updateMany({ where: { rosterId: ownRoster.redraftRosterId!, playerId: command.dropPlayerId,
          droppedAt: null }, data: { droppedAt: now } })
        await tx.afRosterLineupAssignment.deleteMany({ where: { leagueId, rosterId: ownRoster.id,
          season: league.season, week: state.period, playerId: command.dropPlayerId } })
      }
      const moved = await tx.redraftRosterPlayer.updateMany({ where: { rosterId: targetRoster.redraftRosterId!,
        playerId: command.targetId, droppedAt: null, isLocked: false },
        data: { rosterId: ownRoster.redraftRosterId!, slotType: 'bench', acquisitionType: 'survivor_guillotine_steal' } })
      if (moved.count !== 1) throw new Error('Target player locked or changed roster.')
      await tx.afRosterLineupAssignment.deleteMany({ where: { leagueId, rosterId: targetRoster.id,
        season: league.season, week: state.period, playerId: command.targetId } })
      const ownData = command.dropPlayerId ? removePlayerFromRosterData(ownRoster.playerData, command.dropPlayerId) : ownRoster.playerData
      const added = await tx.roster.updateMany({ where: { id: ownRoster.id, updatedAt: ownRoster.updatedAt }, data: {
        playerData: addPlayerToRosterData(ownData, command.targetId) as Prisma.InputJsonValue } })
      const removed = await tx.roster.updateMany({ where: { id: targetRoster.id, updatedAt: targetRoster.updatedAt }, data: {
        playerData: removePlayerFromRosterData(targetRoster.playerData, command.targetId) as Prisma.InputJsonValue } })
      if (added.count !== 1 || removed.count !== 1) throw new Error('A roster changed during the steal; retry.')
      const benchRows = await tx.afRosterLineupAssignment.findMany({ where: { leagueId, rosterId: ownRoster.id,
        season: league.season, week: state.period, section: 'bench' }, select: { slotIndex: true } })
      await tx.afRosterLineupAssignment.create({ data: { leagueId, rosterId: ownRoster.id,
        season: league.season, week: state.period, section: 'bench',
        slotIndex: Math.max(-1, ...benchRows.map(r => r.slotIndex)) + 1, playerId: command.targetId } })
    }
    await tx.leagueChatMessage.create({ data: { leagueId, userId: league.userId, type: 'system',
      message: `A ${row.kind.replaceAll('_', ' ')} token was played in Survivor Guilly.`,
      metadata: { survivorGuillotine: true, event: 'token_used', powerId: row.id, kind: row.kind,
        targetRosterId: targetRoster?.id ?? ownRoster.id, targetPlayerId: row.kind === 'steal_player' ? command.targetId : null } } })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  return { reply: 'Your token was played and revealed to the league.', powerId: row.id }
}

/** Uses finalized server scores and actual waiver roster ownership; caller must authorize commissioner. */
export async function executeSGLiveChop(leagueId: string, periodNumber: number) {
  const season = await prisma.survivorGuillotineLeague.findUnique({ where: { leagueId } })
  if (!season || season.currentPeriod !== periodNumber) throw new Error('Scoring period is not active.')
  const config = season.config as unknown as SGConfig
  const period = buildSGSchedule(config).periods.find(p => p.period === periodNumber)
  const state = readSGPeriodState(season.periodState)
  if (!period || !state || state.period !== periodNumber) throw new Error('Period rules are unavailable.')
  const historyEntry = (season.periodHistory as Record<string, Record<string, unknown>>)[String(periodNumber)]
  const hosted = config.ceremonyMode === 'hosted' && config.ceremonyPresentation
  const pendingHosted = hosted && historyEntry?.pendingCommit === true
  const revealStage = (historyEntry?.hostedCeremony as { stage?: number } | undefined)?.stage
  if (state.ceremonyStarted && !pendingHosted) throw new Error('This ceremony has already completed.')
  if (pendingHosted && revealStage !== 2) throw new Error('Advance the hosted ceremony before committing its chop.')
  const immunityLock = config.immunityDeadline === 'custom' ? state.immunityDeadlineAt : state.ceremonyAt
  if (period.chops && (!immunityLock || !Number.isFinite(Date.parse(immunityLock)) || Date.now() < Date.parse(immunityLock))) {
    throw new Error('The immunity deadline has not passed; the chop cannot start yet.')
  }
  const previous = await prisma.survivorGuillotineChop.count({ where: { leagueId, period: periodNumber, reversedAt: null } })
  if (previous) throw new Error('This period has already been chopped.')
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { season: true, userId: true } })
  if (!league) throw new Error('League not found.')
  const [rosters, scores, priorScores, pastChops, sealed] = await Promise.all([
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, playerData: true, redraftRosterId: true, updatedAt: true } }),
    prisma.teamWeekResult.findMany({ where: { leagueId, season: league.season, week: periodNumber, status: 'final' }, select: { rosterId: true, totalPoints: true } }),
    prisma.teamWeekResult.findMany({ where: { leagueId, season: league.season, week: periodNumber - 1, status: 'final' }, select: { rosterId: true, totalPoints: true } }),
    prisma.survivorGuillotineChop.findMany({ where: { leagueId, reversedAt: null }, select: { rosterId: true } }),
    prisma.survivorGuillotinePower.findMany({ where: { leagueId, status: 'sealed' } }),
  ])
  const eliminated = new Set(pastChops.map(c => c.rosterId))
  const active = rosters.filter(r => !eliminated.has(r.id))
  // Finalized rows may still exist for managers chopped in earlier periods.
  // Only the active field can decide this ceremony or satisfy its score gate.
  const activeScores = period.mode === 'off' ? [] : selectActiveFinalScores(scores, active.map(r => r.id))
  const hasRedraftSeason = await prisma.redraftSeason.count({ where: { leagueId } })
  if (hasRedraftSeason && active.some(r => !r.redraftRosterId)) throw new Error('One or more active rosters lack their redraft link; reconcile rosters before chopping.')
  const tribes = readSGTribes(season.tribes)
  const byTribe = new Map(tribes.map(m => [m.rosterId, m.tribeId]))
  if (active.length !== period.teamsEntering || active.some(r => !byTribe.has(r.id))) throw new Error('Active rosters or tribe assignments do not match the season schedule.')
  const capped = config.sport === 'NBA' && config.nbaScoring === 'capped_games' && period.mode !== 'off'
  const scoreById = period.mode === 'off' ? new Map(active.map(r => [r.id, 0])) : capped
    ? await loadCappedGameScores({ leagueId, season: league.season, period: periodNumber,
      rosterIds: active.map(r => r.id), cap: config.nbaGameCap,
      startsAt: state.scoringStartsAt!, endsAt: state.scoringEndsAt! })
    : new Map(activeScores.map(s => [s.rosterId, s.totalPoints]))
  const history = season.scoreHistory && typeof season.scoreHistory === 'object' && !Array.isArray(season.scoreHistory)
    ? season.scoreHistory as Record<string, Record<string, number>> : {}
  const priorById = capped ? new Map(Object.entries(history[String(periodNumber - 1)] ?? {}))
    : new Map(priorScores.map(s => [s.rosterId, s.totalPoints]))
  const teams: SGTeam[] = active.map(r => ({ id: r.id, tribeId: byTribe.get(r.id)!, points: scoreById.get(r.id)!,
    previousPoints: priorById.get(r.id) ?? null, champion: state.champions.includes(r.id),
    sitOut: state.sitOuts.includes(r.id), satOutLastPeriod: state.priorSitOuts.includes(r.id) }))
  let result = resolveSGPeriod({ config, period, teams, matchups: state.matchups,
    protectedTeamIds: sealed.map(p => p.targetRosterId).filter((id): id is string => !!id),
    gauntletImmuneTribeId: state.gauntletImmuneTribeId })
  if (result.status === 'commissioner_required' && state.commissionerTie &&
      result.reasons.every(reason => /tie|tied/i.test(reason))) {
    const decision = state.commissionerTie
    const validTribe = decision.immuneTribeId === null || teams.some(t => t.tribeId === decision.immuneTribeId)
    const protectedIds = new Set(sealed.map(p => p.targetRosterId))
    const validChops = decision.choppedTeamIds.length === period.chops &&
      new Set(decision.choppedTeamIds).size === period.chops &&
      decision.choppedTeamIds.every(id => teams.some(t => t.id === id &&
        t.tribeId !== decision.immuneTribeId && !protectedIds.has(id)))
    const gauntletSplit = period.mode !== 'gauntlet' || config.gauntletElimination !== 'per_tribe' ||
      decision.immuneTribeId !== null || new Set(decision.choppedTeamIds.map(id => teams.find(t => t.id === id)?.tribeId)).size === 2
    const validPlacement = period.mode !== 'final_three' ||
      (decision.placements.length === teams.length && new Set(decision.placements).size === teams.length &&
        decision.placements.every(id => teams.some(t => t.id === id)))
    if (!validTribe || !validChops || !gauntletSplit || !validPlacement || !decision.reason.trim()) throw new Error('Commissioner tie decision is incomplete or unsafe.')
    result = { status: 'resolved', immuneTribeId: decision.immuneTribeId,
      choppedTeamIds: decision.choppedTeamIds, savedTeamIds: [], placements: decision.placements,
      reasons: [`Commissioner resolved tie: ${decision.reason}`] }
  }
  if (result.status !== 'resolved') throw new Error(result.reasons.join(' '))
  const planFingerprint = createHash('sha256').update(JSON.stringify({
    result, scores: Object.fromEntries(scoreById), teams, matchups: state.matchups,
    powerIds: sealed.map(power => power.id).sort(),
    rosters: active.map(roster => [roster.id, roster.updatedAt.toISOString()]).sort(([a], [b]) => a.localeCompare(b)),
  })).digest('hex')
  if (hosted && !pendingHosted) {
    const now = new Date().toISOString()
    const saved = await prisma.survivorGuillotineLeague.updateMany({ where: { leagueId, revision: season.revision },
      data: { revision: { increment: 1 },
        periodHistory: { ...(season.periodHistory as Record<string, unknown>), [String(periodNumber)]: {
          period: periodNumber, mode: period.mode, immuneTribeId: result.immuneTribeId,
          choppedTeamIds: result.choppedTeamIds, savedTeamIds: result.savedTeamIds,
          placements: result.placements, scores: Object.fromEntries(scoreById), reasons: result.reasons,
          teams, matchups: state.matchups, protectedTeamIds: sealed.map(power => power.targetRosterId).filter((id): id is string => !!id),
          gauntletImmuneTribeId: state.gauntletImmuneTribeId ?? null,
          hostedCeremony: { stage: 0, updatedAt: now }, pendingCommit: true, planFingerprint,
        } } as Prisma.InputJsonValue,
        periodState: { ...state, ceremonyStarted: true } as unknown as Prisma.InputJsonValue } })
    if (saved.count !== 1) throw new Error('Season changed before Chop Night; retry.')
    return { ...result, hostedPrepared: true }
  }
  if (pendingHosted && historyEntry.planFingerprint !== planFingerprint) {
    await prisma.$transaction(async tx => {
      const restarted = await tx.survivorGuillotineLeague.updateMany({ where: { leagueId, revision: season.revision },
        data: { revision: { increment: 1 },
          periodHistory: { ...(season.periodHistory as Record<string, unknown>), [String(periodNumber)]: {
            ...historyEntry, immuneTribeId: result.immuneTribeId, choppedTeamIds: result.choppedTeamIds,
            savedTeamIds: result.savedTeamIds, placements: result.placements,
            scores: Object.fromEntries(scoreById), reasons: result.reasons, teams,
            protectedTeamIds: sealed.map(power => power.targetRosterId).filter((id): id is string => !!id),
            hostedCeremony: { stage: 0, updatedAt: new Date().toISOString() }, planFingerprint,
          } } as Prisma.InputJsonValue } })
      if (restarted.count !== 1) throw new Error('Season changed during Chop Night; retry.')
      await tx.leagueChatMessage.create({ data: { leagueId, userId: league.userId, type: 'system',
        message: `Survivor Guilly period ${periodNumber} hosted ceremony restarted after the scores or rosters changed. Earlier reveals are superseded; no roster was chopped.`,
        metadata: { survivorGuillotine: true, event: 'hosted_ceremony_restarted', period: periodNumber } } })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return { ...result, hostedRestarted: true }
  }
  const choppedOwners = await prisma.leagueTeam.findMany({ where: { leagueId,
    externalId: { in: result.choppedTeamIds } },
    select: { claimedByUserId: true, externalId: true, teamName: true, ownerName: true } })
  const now = new Date()
  await prisma.$transaction(async tx => {
    for (const rosterId of result.choppedTeamIds) {
      const roster = active.find(r => r.id === rosterId)!
      const activeRedraftPlayers = roster.redraftRosterId ? await tx.redraftRosterPlayer.findMany({
        where: { rosterId: roster.redraftRosterId, droppedAt: null }, select: { id: true, playerId: true },
      }) : []
      const choppedOwner = choppedOwners.find(owner => owner.externalId === rosterId)?.claimedByUserId
      const managerPowers = choppedOwner ? await tx.survivorGuillotinePower.findMany({
        where: { leagueId, ownerUserId: choppedOwner, binding: 'manager', status: 'held' },
        select: { id: true },
      }) : []
      await tx.survivorGuillotineChop.create({ data: { id: randomUUID(), leagueId, period: periodNumber,
        rosterId, score: scoreById.get(rosterId)!, tribeId: byTribe.get(rosterId),
        releaseSnapshot: { playerData: roster.playerData, redraftPlayers: activeRedraftPlayers,
          expiredPowerIds: managerPowers.map(p => p.id) } as Prisma.InputJsonValue } })
      // This is the live waiver pool's source of truth. Clear all lineup views with the shared helper.
      let playerData: unknown = roster.playerData
      for (const playerId of getRosterPlayerIds(roster.playerData)) playerData = removePlayerFromRosterData(playerData, playerId)
      const released = await tx.roster.updateMany({ where: { id: rosterId, updatedAt: roster.updatedAt },
        data: { playerData: playerData as Prisma.InputJsonValue } })
      if (released.count !== 1) throw new Error('A roster changed during the chop; retry with fresh scores.')
      await tx.guillotineRosterState.upsert({ where: { rosterId }, create: { leagueId, rosterId,
        choppedAt: now, choppedInPeriod: periodNumber, choppedReason: 'survivor_guillotine' },
        update: { choppedAt: now, choppedInPeriod: periodNumber, choppedReason: 'survivor_guillotine' } })
      await tx.waiverClaim.updateMany({ where: { leagueId, rosterId, status: 'pending' }, data: { status: 'cancelled' } })
      await tx.leagueTeam.updateMany({ where: { leagueId, externalId: rosterId }, data: { eliminatedAt: now } })
      await tx.afRosterLineupAssignment.deleteMany({ where: { leagueId, rosterId, season: league.season,
        week: { gt: periodNumber } } })
      if (roster.redraftRosterId) {
        await tx.redraftRoster.update({ where: { id: roster.redraftRosterId }, data: { isEliminated: true } })
        await tx.redraftRosterPlayer.updateMany({ where: { rosterId: roster.redraftRosterId, droppedAt: null },
          data: { droppedAt: now } })
      }
    }
    if (sealed.length) await tx.survivorGuillotinePower.updateMany({ where: { leagueId, id: { in: sealed.map(p => p.id) } },
      data: { status: 'used', revealedAt: now } })
    const lostOwnerIds = choppedOwners.map(owner => owner.claimedByUserId).filter((id): id is string => !!id)
    if (lostOwnerIds.length) await tx.survivorGuillotinePower.updateMany({ where: { leagueId,
      binding: 'manager', ownerUserId: { in: lostOwnerIds }, status: 'held' }, data: { status: 'expired' } })
    for (const power of hosted ? [] : sealed) {
      await tx.leagueChatMessage.create({ data: { leagueId, userId: league.userId, type: 'system',
        message: `An immunity idol was played at the period ${periodNumber} chop. ${power.targetRosterId ?? 'A manager'} was protected.`,
        metadata: { survivorGuillotine: true, event: 'idol_revealed', powerId: power.id, targetRosterId: power.targetRosterId } } })
    }
    if (result.choppedTeamIds.length && !hosted) {
      const names = result.choppedTeamIds.map(id => {
        const team = choppedOwners.find(owner => owner.externalId === id)
        return team?.teamName || team?.ownerName || id
      })
      await tx.leagueChatMessage.create({ data: { leagueId, userId: league.userId, type: 'system',
        message: `Survivor Guilly period ${periodNumber} chop: ${names.join(', ')} eliminated. Their players enter league waivers.`,
        metadata: { survivorGuillotine: true, event: 'chop', period: periodNumber, rosterIds: result.choppedTeamIds } } })
    }
    if (result.placements.length && !hosted) await tx.leagueChatMessage.create({ data: { leagueId, userId: league.userId,
      type: 'system', message: `Survivor Guilly final placements are set for period ${periodNumber}.`,
      metadata: { survivorGuillotine: true, event: 'final_placements', period: periodNumber, rosterIds: result.placements } } })
    const finished = await tx.survivorGuillotineLeague.updateMany({ where: { leagueId, revision: season.revision },
      data: { status: period.mode === 'final_three' ? 'completed' : 'active', revision: { increment: 1 },
        scoreHistory: { ...history, [String(periodNumber)]: Object.fromEntries(scoreById) } as Prisma.InputJsonValue,
        periodHistory: { ...(season.periodHistory as Record<string, unknown>), [String(periodNumber)]: {
          period: periodNumber, mode: period.mode, immuneTribeId: result.immuneTribeId,
          choppedTeamIds: result.choppedTeamIds, savedTeamIds: result.savedTeamIds,
          placements: result.placements, scores: Object.fromEntries(scoreById), reasons: result.reasons,
          teams, matchups: state.matchups, protectedTeamIds: sealed.map(p => p.targetRosterId).filter((id): id is string => !!id),
          gauntletImmuneTribeId: state.gauntletImmuneTribeId ?? null,
          completedAt: now.toISOString(),
          hostedCeremony: hosted ? { stage: 3, updatedAt: now.toISOString() } : null,
        } } as Prisma.InputJsonValue,
        periodState: { ...state, ceremonyStarted: true, placements: result.placements,
          chopSnapshot: { teams, protectedTeamIds: sealed.map(p => p.targetRosterId).filter((id): id is string => !!id),
            powerIds: sealed.map(p => p.id), choppedTeamIds: result.choppedTeamIds,
            immuneTribeId: result.immuneTribeId } } as unknown as Prisma.InputJsonValue } })
    if (finished.count !== 1) throw new Error('Season changed during the chop; retry with fresh scores and powers.')
    if (hosted) await tx.leagueChatMessage.create({ data: { leagueId, userId: league.userId, type: 'system',
      message: result.placements.length
        ? `Survivor Guilly period ${periodNumber} final placements: ${result.placements.join(', ')}.`
        : `Survivor Guilly period ${periodNumber} chop: ${result.choppedTeamIds.join(', ')} eliminated. Their players enter waivers.`,
      metadata: { survivorGuillotine: true, event: 'hosted_ceremony_advanced', period: periodNumber, stage: 3,
        rosterIds: result.choppedTeamIds, placements: result.placements } } })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  return result
}

/** Re-evaluate the latest completed ceremony against corrected final scores. */
export async function reconcileSGLiveStatCorrection(leagueId: string) {
  const season = await prisma.survivorGuillotineLeague.findUnique({ where: { leagueId } })
  if (!season) throw new Error('Survivor Guilly season not found.')
  const state = readSGPeriodState(season.periodState)
  if (!state?.ceremonyStarted || !state.chopSnapshot) return { status: 'not_completed' as const }
  const config = season.config as unknown as SGConfig
  const period = buildSGSchedule(config).periods.find(p => p.period === state.period)
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { season: true, userId: true } })
  if (!period || !league) throw new Error('Period or league not found.')
  const original = state.chopSnapshot
  const ids = original.teams.map(t => t.id)
  const finalScores = await prisma.teamWeekResult.findMany({ where: { leagueId, season: league.season,
    week: state.period, status: 'final', rosterId: { in: ids } }, select: { rosterId: true, totalPoints: true } })
  if (period.mode !== 'off' && (finalScores.length !== ids.length ||
      new Set(finalScores.map(s => s.rosterId)).size !== ids.length)) return { status: 'awaiting_final_scores' as const }
  const capped = config.sport === 'NBA' && config.nbaScoring === 'capped_games' && period.mode !== 'off'
  const totals = period.mode === 'off' ? new Map(ids.map(id => [id, 0])) : capped
    ? await loadCappedGameScores({ leagueId, season: league.season, period: state.period,
      rosterIds: ids, cap: config.nbaGameCap,
      startsAt: state.scoringStartsAt!, endsAt: state.scoringEndsAt! })
    : new Map(finalScores.map(s => [s.rosterId, s.totalPoints]))
  const teams = original.teams.map(t => ({ ...t, points: totals.get(t.id)! }))
  const result = resolveSGPeriod({ config, period, teams, matchups: state.matchups,
    protectedTeamIds: original.protectedTeamIds, gauntletImmuneTribeId: state.gauntletImmuneTribeId })
  if (result.status !== 'resolved') return { status: 'commissioner_required' as const, reasons: result.reasons }
  const sameChops = [...result.choppedTeamIds].sort().join('|') === [...original.choppedTeamIds].sort().join('|')
  const samePlacement = result.placements.join('|') === (state.placements ?? []).join('|')
  const sameImmunity = result.immuneTribeId === original.immuneTribeId
  const sameScores = teams.every((team, index) => team.points === original.teams[index].points)
  if (sameChops && samePlacement && sameImmunity && sameScores) return { status: 'unchanged' as const }
  if (sameChops) {
    const history = season.scoreHistory && typeof season.scoreHistory === 'object' && !Array.isArray(season.scoreHistory)
      ? season.scoreHistory as Record<string, Record<string, number>> : {}
    await prisma.$transaction(async tx => {
      for (const rosterId of result.choppedTeamIds) await tx.survivorGuillotineChop.updateMany({
        where: { leagueId, period: state.period, rosterId, reversedAt: null }, data: { score: totals.get(rosterId)! },
      })
      const saved = await tx.survivorGuillotineLeague.updateMany({ where: { leagueId, revision: season.revision },
        data: { revision: { increment: 1 },
          scoreHistory: { ...history, [String(state.period)]: Object.fromEntries(totals) } as Prisma.InputJsonValue,
          periodHistory: { ...(season.periodHistory as Record<string, unknown>), [String(state.period)]: {
            ...((season.periodHistory as Record<string, Record<string, unknown>>)[String(state.period)] ?? {}),
            period: state.period, mode: period.mode, immuneTribeId: result.immuneTribeId,
            choppedTeamIds: result.choppedTeamIds, savedTeamIds: result.savedTeamIds,
            placements: result.placements, scores: Object.fromEntries(totals),
            teams,
            completedAt: state.ceremonyAt, correctedAt: new Date().toISOString(),
          } } as Prisma.InputJsonValue,
          periodState: { ...state, placements: result.placements,
          chopSnapshot: { ...original, teams, immuneTribeId: result.immuneTribeId } } as unknown as Prisma.InputJsonValue } })
      if (saved.count !== 1) throw new Error('Season changed during correction; retry.')
      await tx.leagueChatMessage.create({ data: { leagueId, userId: league.userId, type: 'system',
        message: `Survivor Guilly period ${state.period} scores were corrected. The chop was reviewed${samePlacement ? ' and remains in place' : '; final placements were updated'}.`,
        metadata: { survivorGuillotine: true, event: 'score_corrected', period: state.period,
          rosterIds: result.choppedTeamIds, placements: result.placements } } })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return { status: 'scores_updated' as const, result }
  }

  const chops = await prisma.survivorGuillotineChop.findMany({ where: { leagueId, period: state.period, reversedAt: null } })
  if (chops.length !== original.choppedTeamIds.length) throw new Error('Chop audit is incomplete; commissioner review required.')
  const restored: string[] = []
  const contested: string[] = []
  await prisma.$transaction(async tx => {
    for (const chop of chops) {
      const snapshot = chop.releaseSnapshot as { playerData?: unknown;
        redraftPlayers?: { id: string; playerId: string }[]; expiredPowerIds?: string[] } | null
      if (!snapshot || !Array.isArray(snapshot.redraftPlayers)) throw new Error('Chop release snapshot is missing.')
      const roster = await tx.roster.findUniqueOrThrow({ where: { id: chop.rosterId },
        select: { playerData: true, redraftRosterId: true } })
      let nextData: unknown = roster.playerData
      const otherRosters = await tx.roster.findMany({ where: { leagueId, id: { not: chop.rosterId } },
        select: { playerData: true } })
      const ownership = new Set(otherRosters.flatMap(other => getRosterPlayerIds(other.playerData)))
      const released = partitionReleasedPlayers(getRosterPlayerIds(snapshot.playerData), ownership)
      contested.push(...released.retainedByClaimants)
      for (const playerId of released.restore) {
        nextData = addPlayerToRosterData(nextData, playerId)
        restored.push(playerId)
      }
      await tx.roster.update({ where: { id: chop.rosterId }, data: {
        playerData: nextData as Prisma.InputJsonValue } })
      if (roster.redraftRosterId) {
        await tx.redraftRoster.update({ where: { id: roster.redraftRosterId }, data: { isEliminated: false } })
        for (const row of snapshot.redraftPlayers) if (restored.includes(row.playerId)) {
          await tx.redraftRosterPlayer.updateMany({ where: { id: row.id, rosterId: roster.redraftRosterId,
            droppedAt: { not: null } }, data: { droppedAt: null } })
        }
      }
      await tx.guillotineRosterState.updateMany({ where: { rosterId: chop.rosterId,
        choppedInPeriod: state.period, choppedReason: 'survivor_guillotine' },
        data: { choppedAt: null, choppedInPeriod: null, choppedReason: null } })
      if (snapshot.expiredPowerIds?.length) await tx.survivorGuillotinePower.updateMany({ where: {
        leagueId, id: { in: snapshot.expiredPowerIds }, status: 'expired' }, data: { status: 'held' } })
      await tx.leagueTeam.updateMany({ where: { leagueId, externalId: chop.rosterId }, data: { eliminatedAt: null } })
      await tx.survivorGuillotineChop.update({ where: { id: chop.id }, data: {
        reversedAt: new Date(), reversalReason: 'final_score_correction' } })
    }
    if (original.powerIds.length) await tx.survivorGuillotinePower.updateMany({ where: { leagueId,
      id: { in: original.powerIds }, status: 'used' }, data: { status: 'sealed' } })
    const saved = await tx.survivorGuillotineLeague.updateMany({ where: { leagueId, revision: season.revision },
      data: { status: 'active', revision: { increment: 1 },
        periodState: { ...state, ceremonyStarted: false, placements: [], chopSnapshot: null } as unknown as Prisma.InputJsonValue } })
    if (saved.count !== 1) throw new Error('Season changed during correction; retry.')
    await tx.leagueChatMessage.create({ data: { leagueId, userId: league.userId, type: 'system',
      message: `Survivor Guilly period ${state.period} chop was reversed after a stat correction. The ceremony will run again with corrected scores.`,
      metadata: { survivorGuillotine: true, event: 'chop_reversed', period: state.period,
        restoredPlayerIds: restored, claimedPlayerIdsRetained: contested } } })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  return { status: 'reversed' as const, restoredPlayerIds: restored, claimedPlayerIdsRetained: contested,
    correctedResult: result }
}

/** Called by the five-minute waiver heartbeat before claims are processed. */
export async function runSGAutomaticChopNight(now = new Date(), limit = 10) {
  const candidates = await prisma.survivorGuillotineLeague.findMany({ where: {
    status: { in: ['active', 'completed'] },
  }, select: { leagueId: true, config: true, periodState: true, currentPeriod: true },
    orderBy: [{ lastCorrectionCheckAt: 'asc' }, { updatedAt: 'desc' }] })
  const due = candidates.filter(row => {
    const config = row.config as unknown as SGConfig
    const state = readSGPeriodState(row.periodState)
    return isAutomaticCeremonyDue({ mode: config.ceremonyMode, ceremonyAt: state?.ceremonyAt ?? null,
      statePeriod: state?.period ?? null, currentPeriod: row.currentPeriod, now })
  }).sort((a, b) => Number(readSGPeriodState(a.periodState)?.ceremonyStarted === true) -
    Number(readSGPeriodState(b.periodState)?.ceremonyStarted === true)).slice(0, limit)
  const results: { leagueId: string; status: string; error?: string }[] = []
  for (const row of due) {
    try {
      const state = readSGPeriodState(row.periodState)!
      if (state.ceremonyStarted) {
        const correction = await reconcileSGLiveStatCorrection(row.leagueId)
        if (correction.status !== 'reversed') {
          const { advanceSGPeriod } = await import('./operations')
          const advanced = await advanceSGPeriod(row.leagueId, now)
          await prisma.survivorGuillotineLeague.update({ where: { leagueId: row.leagueId },
            data: { lastCorrectionCheckAt: now } })
          results.push({ leagueId: row.leagueId, status: advanced.advanced ? 'advanced' :
            'reason' in advanced ? String(advanced.reason) : correction.status })
          continue
        }
      }
      await executeSGLiveChop(row.leagueId, row.currentPeriod)
      const fresh = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId: row.leagueId },
        select: { rewardPeriods: true, status: true } })
      if (fresh.status === 'active' && Array.isArray(fresh.rewardPeriods) && fresh.rewardPeriods.includes(row.currentPeriod) &&
          !await prisma.survivorGuillotinePower.count({ where: { leagueId: row.leagueId, awardPeriod: row.currentPeriod } })) {
        await awardSGLiveWeeklyPower(row.leagueId, row.currentPeriod)
      }
      const { advanceSGPeriod } = await import('./operations')
      const advanced = await advanceSGPeriod(row.leagueId, now)
      await prisma.survivorGuillotineLeague.update({ where: { leagueId: row.leagueId },
        data: { lastCorrectionCheckAt: now } })
      results.push({ leagueId: row.leagueId, status: advanced.advanced ? 'chopped_and_advanced' :
        'reason' in advanced ? `chopped_${String(advanced.reason)}` : 'chopped' })
    } catch (error) {
      results.push({ leagueId: row.leagueId, status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error' })
    }
  }
  return { scanned: candidates.length, due: due.length, results }
}
