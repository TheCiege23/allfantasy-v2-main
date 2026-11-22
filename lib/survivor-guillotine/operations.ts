import {sgAutomationAllowed,recordSGAutomation} from './commissionerRuntime'
import 'server-only'

import { randomInt, randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createPlatformNotification } from '@/lib/platform/notification-service'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { buildSGSchedule } from './config'
import { sgEligibleChampions, sgMatchupStage, validateSGSelectionStages } from './seasonRules'
import { buildSGNflCalendar, sgOrderStages, validateSGOrderChoice } from './calendar'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { matchedStarterCount } from '@/lib/redraft/nativeDraftRosterTemplate'
import { allowedPositionsForSlot } from '@/lib/redraft/lineupValidation'
import { sgGameWindow } from './gameWindow'
import { resolveSGPeriod } from './competition'
import { executeSGLiveChop, readSGPeriodState, readSGTribes, seedSGLiveDraftPowers } from './live'
import { configureSGLivePeriod } from './live'
import type { SGTribeMember, SGLivePeriod } from './live'
import type { SGConfig } from './types'

function easternDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric',
    month: '2-digit', day: '2-digit' }).format(date)
}

export async function getSGManagerRoster(leagueId: string, userId: string) {
  const team = await prisma.leagueTeam.findFirst({ where: { leagueId, claimedByUserId: userId,
    eliminatedAt: null }, select: { externalId: true, platformUserId: true } })
  if (!team) throw new Error('Claim an active league team before taking this action.')
  const roster = await prisma.roster.findFirst({ where: { leagueId, OR: [
    { id: team.externalId }, { platformUserId: userId },
    ...(team.platformUserId ? [{ platformUserId: team.platformUserId }] : []),
  ] }, select: { id: true, playerData: true, faabRemaining: true, redraftRosterId: true } })
  if (!roster) throw new Error('The claimed team has no matching active roster.')
  return roster
}

/** Draft-completion hook; idempotent and safe to retry after roster finalization. */
export async function bootstrapSGAfterDraft(leagueId: string) {
  // Draft completion calls this hook for every format. Read the shared discriminator
  // before touching optional specialty tables, which may not be installed.
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { leagueVariant: true } })
  if (league?.leagueVariant !== 'survivor_guillotine') return { status: 'not_applicable' as const }
  const season = await prisma.survivorGuillotineLeague.findUnique({ where: { leagueId } })
  if (!season || season.status !== 'setup') return { status: 'not_applicable' as const }
  const draft = await prisma.draftSession.findFirst({ where: { leagueId, status: 'completed' },
    orderBy: { completedAt: 'desc' }, select: { id: true } })
  if (!draft) return { status: 'draft_incomplete' as const }
  const [picks, rosters] = await Promise.all([
    prisma.draftPick.findMany({ where: { sessionId: draft.id, playerId: { not: null } }, select: { playerId: true } }),
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, playerData: true } }),
  ])
  const config = season.config as unknown as SGConfig
  if (rosters.length !== config.teamCount) throw new Error('Drafted roster count does not match Survivor rules.')
  const drafted = new Set(rosters.flatMap(roster => getRosterPlayerIds(roster.playerData)))
  const playerIds = [...new Set(picks.map(p => p.playerId).filter((id): id is string => !!id && drafted.has(id)))]
  if (!playerIds.length) throw new Error('The completed draft has no player IDs for hidden idols.')
  if (buildSGSchedule(config).periods.find(p => p.mode === 'merged')?.period !== 1 && !await prisma.survivorGuillotinePower.count({ where: { leagueId } })) {
    await seedSGLiveDraftPowers(leagueId, playerIds, config.enabledPowers?.length === 1 ? 1 : Math.min(3, playerIds.length))
  }
  if (config.tribeFormation === 'random' && !readSGTribes(season.tribes).length) {
    const shuffled = [...rosters]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = randomInt(i + 1)
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    const members = shuffled.map((roster, i) => ({ rosterId: roster.id, tribeId: `tribe-${i % config.tribeCount}` }))
    await setSGTribes(leagueId, members)
  }
  return { status: 'ready' as const }
}

export async function setSGTribes(leagueId: string, members: SGTribeMember[], deadlineAt?: string | null) {
  const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
  if (season.currentPeriod > 0) throw new Error('Use a scheduled shuffle or Gauntlet draft after play begins.')
  const config = season.config as unknown as SGConfig
  const rosters = await prisma.roster.findMany({ where: { leagueId }, select: { id: true } })
  const allowed = new Set(rosters.map(r => r.id))
  if (members.length !== rosters.length || new Set(members.map(m => m.rosterId)).size !== rosters.length ||
      members.some(m => !allowed.has(m.rosterId))) throw new Error('Assign every league roster exactly once.')
  const tribes = [...new Set(members.map(m => m.tribeId))]
  const sizes = tribes.map(id => members.filter(m => m.tribeId === id).length)
  if (tribes.length !== config.tribeCount || Math.max(...sizes) - Math.min(...sizes) > 1) throw new Error('Start with balanced tribes.')
  const deadline = deadlineAt ? new Date(deadlineAt) : null
  if (deadlineAt && !Number.isFinite(deadline!.getTime())) throw new Error('Invalid captain voting deadline.')
  const saved = await prisma.survivorGuillotineLeague.updateMany({ where: { leagueId, revision: season.revision },
    data: { tribes: members.map(m => ({ rosterId: m.rosterId, tribeId: m.tribeId, captain: false })) as Prisma.InputJsonValue,
      tribeDraftState: {},
      captainElectionDeadlineAt: deadline, revision: { increment: 1 } } })
  if (saved.count !== 1) throw new Error('Tribe assignments changed; reload and retry.')
  return { tribes: members.length }
}

/** Managers select a starting tribe; capacity checks preserve a balanced final field. */
export async function chooseSGStartingTribe(leagueId: string, userId: string, tribeId: string) {
  const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
  const config = season.config as unknown as SGConfig
  if (config.tribeFormation !== 'manager_choice' || season.currentPeriod !== 0 ||
      readSGTribes(season.tribes).length) throw new Error('Starting tribe selection is closed.')
  const validTribes = Array.from({ length: config.tribeCount }, (_, i) => `tribe-${i}`)
  if (!validTribes.includes(tribeId)) throw new Error('Choose one of this league’s starting tribes.')
  const roster = await getSGManagerRoster(leagueId, userId)
  const rosters = await prisma.roster.findMany({ where: { leagueId }, select: { id: true } })
  if (rosters.length !== config.teamCount) throw new Error('All starting rosters must be ready before tribe selection.')
  return prisma.$transaction(async tx => {
    const claimed = await tx.survivorGuillotineLeague.updateMany({ where: { leagueId,
      revision: season.revision, currentPeriod: 0 }, data: { revision: { increment: 1 } } })
    if (claimed.count !== 1) throw new Error('Tribe selections changed; reload and retry.')
    const choices = await tx.survivorGuillotineTribeChoice.findMany({ where: { leagueId } })
    const current = choices.filter(c => c.rosterId !== roster.id)
    const next = [...current, { rosterId: roster.id, tribeId }]
    const floor = Math.floor(config.teamCount / config.tribeCount)
    const ceiling = Math.ceil(config.teamCount / config.tribeCount)
    const counts = validTribes.map(id => next.filter(c => c.tribeId === id).length)
    if (counts.some(n => n > ceiling) || config.teamCount - next.length < counts.reduce((need, n) => need + Math.max(0, floor - n), 0)) {
      throw new Error('That tribe is full or this choice would leave another tribe short.')
    }
    await tx.survivorGuillotineTribeChoice.upsert({ where: { leagueId_rosterId: { leagueId, rosterId: roster.id } },
      create: { leagueId, rosterId: roster.id, tribeId }, update: { tribeId } })
    if (next.length === config.teamCount) {
      await tx.survivorGuillotineLeague.update({ where: { leagueId }, data: { tribes: next.map(c => ({
        rosterId: c.rosterId, tribeId: c.tribeId, captain: false })) as Prisma.InputJsonValue } })
    }
    return { selected: tribeId, filled: next.length, total: config.teamCount,
      readyForCaptainVote: next.length === config.teamCount }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

export async function voteSGCaptain(leagueId: string, userId: string, candidateRosterId: string) {
  const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
  const roster = await getSGManagerRoster(leagueId, userId)
  const eliminated = new Set((await prisma.survivorGuillotineChop.findMany({ where: { leagueId,
    reversedAt: null }, select: { rosterId: true } })).map(row => row.rosterId))
  const members = readSGTribes(season.tribes).filter(m => !eliminated.has(m.rosterId))
  const config = season.config as unknown as SGConfig
  if (season.currentPeriod === 0 && members.length !== config.teamCount) throw new Error('Finish forming tribes before electing captains.')
  const own = members.find(m => m.rosterId === roster.id)
  if (!own || !members.some(m => m.rosterId === candidateRosterId && m.tribeId === own.tribeId)) throw new Error('Vote for an active member of your tribe.')
  if (members.some(m => m.tribeId === own.tribeId && m.captain)) throw new Error('Your tribe already has an active captain.')
  const period = Math.max(1, season.currentPeriod + (readSGPeriodState(season.periodState)?.ceremonyStarted ? 1 : 0))
  const deadline = period === 1 ? season.captainElectionDeadlineAt?.getTime() :
    Date.parse(readSGCalendar(season.periodCalendar)[period]?.selectionDeadlineAt ?? '')
  if (deadline && Number.isFinite(deadline) && Date.now() >= deadline) throw new Error('Captain voting has closed.')
  await prisma.survivorGuillotineCaptainVote.upsert({ where: { leagueId_period_voterRosterId: {
    leagueId, period, voterRosterId: roster.id } },
    create: { leagueId, period, tribeId: own.tribeId, voterRosterId: roster.id, candidateRosterId },
    update: { candidateRosterId } })
  return { voted: true }
}

export async function finalizeSGCaptains(leagueId: string, commissionerChoices: Record<string, string> = {}) {
  const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
  const eliminated = new Set((await prisma.survivorGuillotineChop.findMany({ where: { leagueId,
    reversedAt: null }, select: { rosterId: true } })).map(row => row.rosterId))
  const members = readSGTribes(season.tribes).filter(m => !eliminated.has(m.rosterId))
  if (!members.length) throw new Error('Create tribes before electing captains.')
  const config = season.config as unknown as SGConfig
  if (season.currentPeriod === 0 && members.length !== config.teamCount) throw new Error('Finish forming tribes before finalizing captains.')
  const period = Math.max(1, season.currentPeriod + (readSGPeriodState(season.periodState)?.ceremonyStarted ? 1 : 0))
  const votes = await prisma.survivorGuillotineCaptainVote.findMany({ where: { leagueId, period } })
  const captains = new Map<string, string>()
  for (const tribeId of new Set(members.map(m => m.tribeId))) {
    const eligible = members.filter(m => m.tribeId === tribeId)
    const incumbent = eligible.find(m => m.captain)
    if (incumbent && !commissionerChoices[tribeId]) { captains.set(tribeId, incumbent.rosterId); continue }
    const counts = eligible.map(m => ({ rosterId: m.rosterId,
      votes: votes.filter(v => v.tribeId === tribeId && v.candidateRosterId === m.rosterId).length }))
      .sort((a, b) => b.votes - a.votes || a.rosterId.localeCompare(b.rosterId))
    const tied = counts.filter(row => row.votes === counts[0].votes)
    const manual = commissionerChoices[tribeId]
    if (manual && !eligible.some(m => m.rosterId === manual)) throw new Error(`Invalid captain for ${tribeId}.`)
    if (!manual && tied.length > 1 && config.missingSubmission === 'commissioner') throw new Error(`Commissioner must resolve the ${tribeId} captain tie.`)
    captains.set(tribeId, manual ?? (tied.length > 1 ? tied[randomInt(tied.length)].rosterId : counts[0].rosterId))
  }
  const next = members.map(m => ({ ...m, captain: captains.get(m.tribeId) === m.rosterId }))
  const saved = await prisma.survivorGuillotineLeague.updateMany({ where: { leagueId, revision: season.revision },
    data: { tribes: next as Prisma.InputJsonValue, revision: { increment: 1 } } })
  if (saved.count !== 1) throw new Error('Captain election changed; retry.')
  return Object.fromEntries(captains)
}

/** A valid pick is committed atomically; both teams are selected in the same action. */
export async function submitSGPeriodChoice(leagueId: string, userId: string, choice:
  { kind: 'matchup'; team1: string; team2: string } |
  { kind: 'champion'; rosterId: string } |
  { kind: 'sit_out'; rosterId: string }, commissioner = false) {
  const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
  const state = readSGPeriodState(season.periodState)
  const config = season.config as unknown as SGConfig
  const mode = buildSGSchedule(config).periods.find(row => row.period === season.currentPeriod)?.mode
  if (!state || state.ceremonyStarted || !['match_play', 'tribe_champion'].includes(mode ?? '')) throw new Error('Tribe selections are closed.')
  if (state.selectionDeadlineAt && Date.now() >= Date.parse(state.selectionDeadlineAt) && !commissioner) throw new Error('The selection deadline passed.')
  const members = readSGTribes(season.tribes)
  const ownRoster = commissioner ? null : await getSGManagerRoster(leagueId, userId)
  const actor = ownRoster ? members.find(m => m.rosterId === ownRoster.id) : null
  if (!commissioner && !actor) throw new Error('Only active tribe managers can submit choices.')
  if (!commissioner && (config.submissionMode === 'commissioner' || config.submissionMode === 'tribe_vote' ||
      (config.submissionMode === 'captain' && !actor?.captain))) throw new Error('This league requires a commissioner or tribe vote to resolve the choice.')
  const next = { ...state, matchups: [...state.matchups], champions: [...state.champions], sitOuts: [...state.sitOuts] }
  if (choice.kind === 'matchup' && state.orderChoice && !state.orderChoice.selected) throw new Error('The choosing tribe must select bookends or middle before matchup picks begin.')
  if (choice.kind === 'sit_out') {
    if (mode !== 'match_play') throw new Error('Sit-outs apply to Match Play.')
    const member = members.find(m => m.rosterId === choice.rosterId)
    if (!member || (!commissioner && member.tribeId !== actor?.tribeId) || state.priorSitOuts.includes(member.rosterId) ||
        state.sitOuts.includes(member.rosterId) || state.matchups.some(m => m.team1 === member.rosterId || m.team2 === member.rosterId)) throw new Error('That manager cannot sit out this period.')
    const minSize = Math.min(...[...new Set(members.map(m => m.tribeId))].map(id => members.filter(m => m.tribeId === id).length))
    if (members.filter(m => m.tribeId === member.tribeId).length - next.sitOuts.filter(id => members.some(m => m.rosterId === id && m.tribeId === member.tribeId)).length <= minSize) throw new Error('This tribe has no extra manager to sit out.')
    next.sitOuts.push(member.rosterId)
  } else if (choice.kind === 'champion') {
    if (mode !== 'tribe_champion') throw new Error('Champion submissions apply to Tribe Champion periods.')
    const nominee = members.find(m => m.rosterId === choice.rosterId)
    if (!nominee || (!commissioner && nominee.tribeId !== actor?.tribeId)) throw new Error('Nominate an active member of your tribe.')
    const stage = state.selectionStages?.find(row => row.tribeId === nominee.tribeId)
    if (!commissioner && stage && Date.now() >= Date.parse(stage.deadlineAt)) throw new Error('Your tribe’s champion deadline passed.')
    if (!sgEligibleChampions(config, state.period, members, nominee.tribeId, season.periodHistory).includes(nominee.rosterId)) throw new Error('Every active tribe member must serve as champion before a repeat nomination.')
    if (next.champions.some(id => members.some(m => m.rosterId === id && m.tribeId === nominee.tribeId))) throw new Error('This tribe already has a champion.')
    next.champions.push(nominee.rosterId)
  } else {
    if (mode !== 'match_play') throw new Error('Matchups apply to Match Play periods.')
    if (config.matchupOrder === 'commissioner' && !commissioner) throw new Error('The commissioner controls matchup order in this league.')
    const first = members.find(m => m.rosterId === choice.team1)
    const second = members.find(m => m.rosterId === choice.team2)
    const used = new Set([...state.sitOuts, ...state.matchups.flatMap(m => [m.team1, m.team2])])
    if (!first || !second || first.tribeId === second.tribeId || used.has(first.rosterId) || used.has(second.rosterId)) throw new Error('Choose two unused, non-sitting managers from different tribes.')
    const order = state.selectionOrder?.length ? state.selectionOrder : [...new Set(members.map(m => m.tribeId))]
    const stage = sgMatchupStage(state.selectionStages, next.matchups.length)
    if (state.selectionStages?.length && !stage) throw new Error('All staged matchups have been selected.')
    if (!commissioner && stage && Date.now() >= Date.parse(stage.deadlineAt)) throw new Error('This matchup batch deadline passed; commissioner or fallback resolution is required.')
    const turn = stage?.tribeId ?? order[Math.floor(next.matchups.length / config.matchupBatchSize) % order.length]
    if (!commissioner && (actor?.tribeId !== turn || first.tribeId !== turn)) throw new Error(`It is ${turn}'s selection turn; choose one of its managers as Team 1.`)
    next.matchups.push({ team1: first.rosterId, team2: second.rosterId })
  }
  const saved = await prisma.survivorGuillotineLeague.updateMany({ where: { leagueId, revision: season.revision },
    data: { periodState: next as unknown as Prisma.InputJsonValue, revision: { increment: 1 } } })
  if (saved.count !== 1) throw new Error('Tribe choices changed; reload and retry.')
  return { saved: true, period: state.period, choice }
}

export async function voteSGPeriodChoice(leagueId: string, userId: string,
  choice: Parameters<typeof submitSGPeriodChoice>[2]) {
  const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
  const config = season.config as unknown as SGConfig
  const state = readSGPeriodState(season.periodState)
  if (config.submissionMode !== 'tribe_vote' || !state || state.ceremonyStarted) throw new Error('Tribe voting is unavailable.')
  if (state.selectionDeadlineAt && Date.now() >= Date.parse(state.selectionDeadlineAt)) throw new Error('Tribe voting has closed.')
  const roster = await getSGManagerRoster(leagueId, userId)
  const members = readSGTribes(season.tribes)
  const actor = members.find(m => m.rosterId === roster.id)
  if (!actor) throw new Error('Only an active tribe member can vote.')
  const candidate = choice.kind === 'matchup' ? members.find(m => m.rosterId === choice.team1)
    : members.find(m => m.rosterId === choice.rosterId)
  if (!candidate || candidate.tribeId !== actor.tribeId) throw new Error('Your tribe must propose one of its own managers.')
  const mode = buildSGSchedule(config).periods.find(p => p.period === season.currentPeriod)?.mode
  if (choice.kind === 'matchup' && mode !== 'match_play' || choice.kind === 'champion' && mode !== 'tribe_champion' ||
      choice.kind === 'sit_out' && mode !== 'match_play') throw new Error('This choice is unavailable in the current format.')
  const order = state.selectionOrder?.length ? state.selectionOrder : [...new Set(members.map(m => m.tribeId))]
  if (choice.kind === 'matchup' && config.matchupOrder === 'commissioner') throw new Error('The commissioner controls matchup order in this league.')
  const stage = choice.kind === 'matchup' ? sgMatchupStage(state.selectionStages, state.matchups.length)
    : state.selectionStages?.find(row => row.tribeId === actor.tribeId)
  if (stage && Date.now() >= Date.parse(stage.deadlineAt)) throw new Error('This tribe selection deadline passed.')
  if (choice.kind === 'matchup' && actor.tribeId !== (stage?.tribeId ?? order[Math.floor(state.matchups.length / config.matchupBatchSize) % order.length])) throw new Error('It is another tribe’s selection turn.')
  const slotKey = choice.kind === 'matchup' ? `matchup:${state.matchups.length}` :
    choice.kind === 'champion' ? `champion:${actor.tribeId}` :
      `sit_out:${actor.tribeId}:${state.sitOuts.filter(id => members.some(m => m.rosterId === id && m.tribeId === actor.tribeId)).length}`
  const normalizedChoice = choice.kind === 'matchup'
    ? { kind: 'matchup' as const, team1: choice.team1, team2: choice.team2 }
    : { kind: choice.kind, rosterId: choice.rosterId }
  await prisma.survivorGuillotineChoiceVote.upsert({ where: { leagueId_period_slotKey_voterRosterId: {
    leagueId, period: state.period, slotKey, voterRosterId: roster.id } },
    create: { leagueId, period: state.period, slotKey, tribeId: actor.tribeId, voterRosterId: roster.id,
      choice: normalizedChoice as Prisma.InputJsonValue }, update: { choice: normalizedChoice as Prisma.InputJsonValue } })
  const ballots = await prisma.survivorGuillotineChoiceVote.findMany({ where: { leagueId,
    period: state.period, slotKey, tribeId: actor.tribeId }, select: { choice: true } })
  const same = ballots.filter(row => JSON.stringify(row.choice) === JSON.stringify(normalizedChoice)).length
  const threshold = Math.floor(members.filter(m => m.tribeId === actor.tribeId).length / 2) + 1
  if (same < threshold) return { voted: true, votesForChoice: same, votesNeeded: threshold }
  const committed = await submitSGPeriodChoice(leagueId, userId, normalizedChoice, true)
  return { voted: true, committed }
}

export async function submitSGTribeChoice(leagueId: string, userId: string,
  choice: Parameters<typeof submitSGPeriodChoice>[2]) {
  const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId },
    select: { config: true } })
  return (season.config as unknown as SGConfig).submissionMode === 'tribe_vote'
    ? voteSGPeriodChoice(leagueId, userId, choice)
    : submitSGPeriodChoice(leagueId, userId, choice)
}

export async function previewSGCalendar(leagueId: string) {
  const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { season: true, settings: true } })
  const config = season.config as unknown as SGConfig
  const games = await prisma.sportsGame.findMany({ where: { sport: 'NFL', season: league.season,
    startTime: { not: null }, week: { gte: 1, lte: config.championshipPeriod } }, select: { week: true, startTime: true, seasonType: true } })
  const preview = buildSGNflCalendar(config, games.filter(game => game.startTime && !/pre|post|playoff/i.test(game.seasonType ?? ''))
    .map(game => ({ week: game.week!, startTime: game.startTime! })))
  const calendar = readSGCalendar(season.periodCalendar)
  return { calendar: { ...calendar, ...Object.fromEntries(Object.entries(preview).filter(([period]) => Number(period) > season.currentPeriod)) } }
}

export async function chooseSGMatchupOrder(leagueId: string, userId: string, selected: 'bookends' | 'middle', commissioner = false) {
  if (!['bookends', 'middle'].includes(selected)) throw new Error('Choose bookends or middle.')
  const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
  const state = readSGPeriodState(season.periodState), config = season.config as unknown as SGConfig
  const choice = state?.orderChoice
  if (!state || state.ceremonyStarted || state.matchups.length || !choice || choice.selected) throw new Error('The matchup order choice is closed.')
  const members = readSGTribes(season.tribes)
  if (!commissioner) {
    const roster = await getSGManagerRoster(leagueId, userId)
    const actor = members.find(m => m.rosterId === roster.id)
    if (!actor || actor.tribeId !== choice.tribeId || Date.now() >= Date.parse(choice.deadlineAt)) throw new Error('Only the choosing tribe may decide before its deadline.')
    if (config.submissionMode === 'commissioner' || config.submissionMode === 'captain' && !actor.captain) throw new Error('This league requires its configured tribe decision authority.')
    if (config.submissionMode === 'tribe_vote') {
      await prisma.survivorGuillotineChoiceVote.upsert({ where: { leagueId_period_slotKey_voterRosterId: {
        leagueId, period: state.period, slotKey: 'matchup_order', voterRosterId: roster.id } },
        create: { leagueId, period: state.period, slotKey: 'matchup_order', tribeId: actor.tribeId,
          voterRosterId: roster.id, choice: { selected } }, update: { choice: { selected } } })
      const ballots = await prisma.survivorGuillotineChoiceVote.findMany({ where: { leagueId, period: state.period,
        slotKey: 'matchup_order', tribeId: actor.tribeId }, select: { choice: true } })
      const votesForChoice = ballots.filter(row => (row.choice as { selected?: string })?.selected === selected).length
      const votesNeeded = Math.floor(members.filter(m => m.tribeId === actor.tribeId).length / 2) + 1
      if (votesForChoice < votesNeeded) return { votesForChoice, votesNeeded }
    }
  }
  const stages = sgOrderStages(choice, [...new Set(members.map(m => m.tribeId))], selected)
  const saved = await prisma.survivorGuillotineLeague.updateMany({ where: { leagueId, revision: season.revision },
    data: { periodState: { ...state, orderChoice: { ...choice, selected }, selectionStages: stages } as unknown as Prisma.InputJsonValue,
      revision: { increment: 1 } } })
  if (saved.count !== 1) throw new Error('The order choice changed; reload and retry.')
  return { selected, stages }
}

export async function saveSGCommissionerTie(leagueId: string, decision: NonNullable<SGLivePeriod['commissionerTie']>) {
  const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
  const state = readSGPeriodState(season.periodState)
  if (!state || state.ceremonyStarted) throw new Error('The ceremony is already complete.')
  if (!decision || (decision.immuneTribeId !== null && typeof decision.immuneTribeId !== 'string') ||
      !Array.isArray(decision.choppedTeamIds) || decision.choppedTeamIds.some(id => typeof id !== 'string') ||
      !Array.isArray(decision.placements) || decision.placements.some(id => typeof id !== 'string') ||
      (decision.rewardWinnerId !== undefined && typeof decision.rewardWinnerId !== 'string') ||
      (decision.matchupWinners !== undefined && (!decision.matchupWinners || typeof decision.matchupWinners !== 'object' || Array.isArray(decision.matchupWinners) || Object.values(decision.matchupWinners).some(id => typeof id !== 'string'))) ||
      typeof decision.reason !== 'string' || !decision.reason.trim()) throw new Error('A complete, reasoned tie decision is required.')
  const saved = await prisma.survivorGuillotineLeague.updateMany({ where: { leagueId, revision: season.revision },
    data: { periodState: { ...state, commissionerTie: decision } as unknown as Prisma.InputJsonValue,
      revision: { increment: 1 } } })
  if (saved.count !== 1) throw new Error('Season changed; reload and retry.')
  return { saved: true }
}

/** A submitted NBA daily lineup is locked when that day's first scheduled game begins. */
export async function saveSGDailyLineup(leagueId: string, userId: string, period: number,
  gameDay: string, playerIds: string[], now = new Date()) {
  const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
  const config = season.config as unknown as SGConfig
  const state = readSGPeriodState(season.periodState)
  if (config.sport !== 'NBA' || config.nbaScoring !== 'capped_games' || season.currentPeriod !== period ||
      !state || state.ceremonyStarted) throw new Error('No active NBA capped scoring period.')
  const day = new Date(`${gameDay}T00:00:00.000Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(gameDay) || Number.isNaN(day.getTime()) ||
      gameDay < easternDay(new Date(state.scoringStartsAt!)) ||
      gameDay > easternDay(new Date(new Date(state.scoringEndsAt!).getTime() - 1))) {
    throw new Error('Choose a day inside this scoring period.')
  }
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { season: true, settings: true } })
  const schedule = await prisma.gameSchedule.findMany({ where: { sportType: 'NBA', season: league.season,
    startTime: { gte: new Date(day.getTime() - 7 * 3600_000), lt: new Date(day.getTime() + 31 * 3600_000) } },
    select: { startTime: true } })
  const tipoffs = schedule.map(g => g.startTime).filter((d): d is Date => !!d && easternDay(d) === gameDay)
  if (!tipoffs.length) throw new Error('NBA game schedule is unavailable for this day.')
  if (now >= new Date(Math.min(...tipoffs.map(d => d.getTime())))) throw new Error('Daily lineup locked when the first NBA game began.')
  const roster = await getSGManagerRoster(leagueId, userId)
  const owned = new Set(getRosterPlayerIds(roster.playerData))
  if (!playerIds.length || new Set(playerIds).size !== playerIds.length || playerIds.some(id => !owned.has(id))) throw new Error('Select distinct players currently on your roster.')
  if (!roster.redraftRosterId) throw new Error('Link the scoring roster before submitting NBA starters.')
  const rosterConfig = resolveRedraftRosterConfig('NBA', league.settings)
  const slots = [...rosterConfig.starterCapacities].flatMap(([slot, count]) => Array.from({ length: count }, () => ({ allowedPositions: allowedPositionsForSlot('NBA', slot) })))
  const available = await prisma.redraftRosterPlayer.findMany({ where: { rosterId: roster.redraftRosterId,
    droppedAt: null, playerId: { in: playerIds } }, select: { playerId: true, position: true, slotType: true } })
  const eligible = available.filter(row => !['IR', 'RESERVE', 'TAXI', 'DEVY'].includes(row.slotType.toUpperCase()))
  if (eligible.length !== playerIds.length || playerIds.length > slots.length || matchedStarterCount(eligible.map(row => row.position), slots) < playerIds.length) throw new Error('Choose active players that fit the league’s actual NBA starting slots.')
  await prisma.survivorGuillotineDailyLineup.upsert({ where: { leagueId_period_rosterId_gameDay: {
    leagueId, period, rosterId: roster.id, gameDay: day } },
    create: { leagueId, period, rosterId: roster.id, gameDay: day, playerIds },
    update: { playerIds } })
  return { saved: true, gameDay, lockAt: new Date(Math.min(...tipoffs.map(d => d.getTime()))).toISOString() }
}

export type SGCalendarEntry = { ceremonyAt: string; scoringStartsAt?: string | null;
  scoringEndsAt?: string | null; selectionDeadlineAt?: string | null; auctionClosesAt?: string | null;
  draftDeadlineAt?: string | null;
  selectionStages?: import('./types').SGSelectionStage[]; orderChoice?: import('./types').SGOrderChoice;
  gauntletIdolPlayerId?: string | null; tribes?: SGTribeMember[] }

export type SGTribeDraftState = { status: 'active' | 'complete'; leaders: { tribeId: string; rosterId: string }[];
  pickIndex: number; deadlineAt: string | null; phase?: 'starting' | 'gauntlet'; period?: number;
  pickMode?: 'snake' | 'alternating' | 'commissioner' }

export function readSGTribeDraftState(value: unknown): SGTribeDraftState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if ((row.status !== 'active' && row.status !== 'complete') || !Number.isInteger(row.pickIndex) ||
      !Array.isArray(row.leaders)) return null
  const leaders = row.leaders.filter((leader): leader is { tribeId: string; rosterId: string } =>
    !!leader && typeof leader === 'object' && typeof leader.tribeId === 'string' && typeof leader.rosterId === 'string')
  if (leaders.length !== row.leaders.length) return null
  return { status: row.status, leaders, pickIndex: Number(row.pickIndex),
    phase: row.phase === 'gauntlet' ? 'gauntlet' : 'starting',
    period: Number.isInteger(row.period) ? Number(row.period) : undefined,
    pickMode: row.pickMode === 'alternating' || row.pickMode === 'commissioner' ? row.pickMode : 'snake',
    deadlineAt: typeof row.deadlineAt === 'string' ? row.deadlineAt : null }
}

export async function startSGCaptainDraft(leagueId: string, captainRosterIds: string[], deadlineAt?: string | null) {
  const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
  const config = season.config as unknown as SGConfig
  if (config.tribeFormation !== 'captain_draft' || season.currentPeriod !== 0 ||
      readSGTribes(season.tribes).length || readSGTribeDraftState(season.tribeDraftState)) throw new Error('Starting captain draft is unavailable.')
  const rosters = await prisma.roster.findMany({ where: { leagueId }, select: { id: true } })
  const allowed = new Set(rosters.map(r => r.id))
  if (rosters.length !== config.teamCount || captainRosterIds.length !== config.tribeCount ||
      new Set(captainRosterIds).size !== captainRosterIds.length ||
      captainRosterIds.some(id => !allowed.has(id))) throw new Error('Choose one distinct captain from each starting tribe.')
  const deadline = deadlineAt ? new Date(deadlineAt) : null
  if (deadlineAt && (!Number.isFinite(deadline!.getTime()) || deadline! <= new Date())) throw new Error('Choose a future captain draft deadline.')
  const leaders = captainRosterIds.map((rosterId, i) => ({ rosterId, tribeId: `tribe-${i}` }))
  const draft: SGTribeDraftState = { status: 'active', leaders, pickIndex: 0,
    deadlineAt: deadline?.toISOString() ?? null }
  const saved = await prisma.survivorGuillotineLeague.updateMany({ where: { leagueId, revision: season.revision },
    data: { tribes: leaders.map(m => ({ ...m, captain: false })) as Prisma.InputJsonValue,
      tribeDraftState: draft as unknown as Prisma.InputJsonValue, revision: { increment: 1 } } })
  if (saved.count !== 1) throw new Error('Season changed; reload and retry.')
  return { leaders, nextTribeId: leaders[0].tribeId }
}

function draftTurn(index: number, tribeCount: number): number {
  const cycle = 2 * tribeCount
  const place = index % cycle
  return place < tribeCount ? place : cycle - place - 1
}

export async function pickSGCaptainDraft(leagueId: string, userId: string, selectedRosterId: string,
  commissioner = false) {
  const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
  const config = season.config as unknown as SGConfig
  const draft = readSGTribeDraftState(season.tribeDraftState)
  const gauntlet = draft?.phase === 'gauntlet'
  if (draft?.status !== 'active' || (gauntlet ? draft.period !== season.currentPeriod + 1 || !readSGPeriodState(season.periodState)?.ceremonyStarted
    : config.tribeFormation !== 'captain_draft' || season.currentPeriod !== 0)) throw new Error('Captain draft is closed.')
  if (gauntlet && (!draft.deadlineAt || Date.now() >= Date.parse(draft.deadlineAt))) throw new Error('The Gauntlet draft deadline passed; review the season before resuming play.')
  const members = readSGTribes(season.tribes)
  const rosters = await prisma.roster.findMany({ where: { leagueId }, select: { id: true } })
  const eliminated = gauntlet ? new Set((await prisma.survivorGuillotineChop.findMany({ where: { leagueId, reversedAt: null }, select: { rosterId: true } })).map(r => r.rosterId)) : new Set<string>()
  if (!rosters.some(r => r.id === selectedRosterId) || eliminated.has(selectedRosterId) || members.some(m => m.rosterId === selectedRosterId)) throw new Error('Choose an undrafted, active league manager.')
  const total = gauntlet ? rosters.filter(r => !eliminated.has(r.id)).length : config.teamCount
  const tribeCount = gauntlet ? 2 : config.tribeCount
  const ceiling = Math.ceil(total / tribeCount)
  const turnFor = (index: number) => gauntlet && draft.pickMode !== 'snake' ? index % tribeCount : draftTurn(index, tribeCount)
  let turn = draft.pickIndex
  while (members.filter(m => m.tribeId === draft.leaders[turnFor(turn)].tribeId).length >= ceiling) turn++
  const leader = draft.leaders[turnFor(turn)]
  if (!commissioner) {
    if (draft.pickMode === 'commissioner') throw new Error('The commissioner controls this tribe draft.')
    if (draft.deadlineAt && Date.now() >= Date.parse(draft.deadlineAt)) throw new Error('Captain draft deadline passed; commissioner must resolve the pick.')
    const own = await getSGManagerRoster(leagueId, userId)
    if (own.id !== leader.rosterId) throw new Error(`It is ${leader.tribeId}'s captain pick.`)
  }
  const nextMembers = [...members, { rosterId: selectedRosterId, tribeId: leader.tribeId, captain: false }]
  const complete = nextMembers.length === total
  let nextTurn = turn + 1
  if (!complete) while (nextMembers.filter(m => m.tribeId === draft.leaders[turnFor(nextTurn)].tribeId).length >= ceiling) nextTurn++
  const nextDraft: SGTribeDraftState = { ...draft, pickIndex: nextTurn, status: complete ? 'complete' : 'active' }
  const saved = await prisma.survivorGuillotineLeague.updateMany({ where: { leagueId, revision: season.revision },
    data: { tribes: nextMembers as Prisma.InputJsonValue,
      ...(gauntlet && complete ? { periodCalendar: { ...readSGCalendar(season.periodCalendar),
        [draft.period!]: { ...readSGCalendar(season.periodCalendar)[draft.period!], tribes: nextMembers } } as Prisma.InputJsonValue } : {}),
      tribeDraftState: nextDraft as unknown as Prisma.InputJsonValue, revision: { increment: 1 } } })
  if (saved.count !== 1) throw new Error('Captain draft changed; reload and retry.')
  return { pickedRosterId: selectedRosterId, tribeId: leader.tribeId, complete,
    nextTribeId: complete ? null : draft.leaders[turnFor(nextTurn)].tribeId }
}

/** Captains actually choose managers; a score-sorted auto assignment is not a tribe draft. */
export async function startSGGauntletDraft(leagueId: string, captainRosterIds: string[] = [], deadlineAt?: string | null) {
  const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
  const config = season.config as unknown as SGConfig
  const period = buildSGSchedule(config).periods.find(p => p.mode === 'gauntlet')?.period
  if (!period || period !== season.currentPeriod + 1 || !readSGPeriodState(season.periodState)?.ceremonyStarted) throw new Error('Complete the last tribal ceremony before starting the Gauntlet draft.')
  if (readSGTribeDraftState(season.tribeDraftState)?.phase === 'gauntlet') throw new Error('The Gauntlet draft already exists.')
  const calendar = readSGCalendar(season.periodCalendar)
  if (!calendar[period]?.scoringStartsAt) throw new Error('Save the Gauntlet calendar before opening its draft.')
  const eliminated = new Set((await prisma.survivorGuillotineChop.findMany({ where: { leagueId, reversedAt: null }, select: { rosterId: true } })).map(r => r.rosterId))
  const rosters = (await prisma.roster.findMany({ where: { leagueId }, select: { id: true } })).filter(r => !eliminated.has(r.id))
  const expected = buildSGSchedule(config).periods.find(p => p.period === period)!.teamsEntering
  if (rosters.length !== expected || expected % 2) throw new Error('The Gauntlet needs its complete, even surviving field.')
  let ids = captainRosterIds
  if (config.gauntletCaptains === 'previous_period_top_two') {
    const history = season.scoreHistory as Record<string, Record<string, number>>
    const scores = history[String(season.currentPeriod)] ?? {}
    if (rosters.some(r => !Number.isFinite(scores[r.id]))) throw new Error('Finalized previous-period scores are required to select captains.')
    const ranked = [...rosters].sort((a, b) => scores[b.id] - scores[a.id])
    const tie = scores[ranked[0].id] === scores[ranked[1].id] || (ranked.length > 2 && scores[ranked[1].id] === scores[ranked[2].id])
    if (!tie) {
      const expectedIds = ranked.slice(0, 2).map(r => r.id)
      if (ids.length && ids.join('|') !== expectedIds.join('|')) throw new Error('The two highest scorers must captain in score order.')
      ids = expectedIds
    } else {
      if (ids.length !== 2 || ids.some(id => !Number.isFinite(scores[id])) ||
          scores[ids[0]] !== scores[ranked[0].id] || scores[ids[1]] < scores[ranked[1].id]) throw new Error('Captain scoring tie: select two eligible top scorers in order.')
    }
  }
  if (ids.length !== 2 || new Set(ids).size !== 2 || ids.some(id => !rosters.some(r => r.id === id))) throw new Error('Choose two distinct active captains.')
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { season: true } })
  const firstGame = await prisma.gameSchedule.findFirst({ where: { sportType: config.sport, season: league.season,
    ...sgGameWindow(config.sport, period, calendar[period].scoringStartsAt, calendar[period].scoringEndsAt) }, orderBy: { startTime: 'asc' }, select: { startTime: true } })
  if (!firstGame?.startTime) throw new Error('Verify the Gauntlet’s first game before opening its draft.')
  const deadline = deadlineAt ?? calendar[period].draftDeadlineAt ?? firstGame.startTime.toISOString()
  if (!Number.isFinite(Date.parse(deadline)) || Date.parse(deadline) <= Date.now()) throw new Error('Choose a future draft deadline before scoring starts.')
  if (Date.parse(deadline) > firstGame.startTime.getTime()) throw new Error('Finish the Gauntlet draft before the first game.')
  const leaders = ids.map((rosterId, i) => ({ rosterId, tribeId: `gauntlet-${i + 1}` }))
  const draft: SGTribeDraftState = { status: 'active', leaders, phase: 'gauntlet', period,
    pickMode: config.gauntletDraft, pickIndex: 0, deadlineAt: deadline }
  const saved = await prisma.survivorGuillotineLeague.updateMany({ where: { leagueId, revision: season.revision },
    data: { tribeDraftState: draft as unknown as Prisma.InputJsonValue,
      tribes: leaders.map(m => ({ ...m, captain: true })) as Prisma.InputJsonValue, revision: { increment: 1 } } })
  if (saved.count !== 1) throw new Error('The season changed; reload and retry the draft.')
  return { leaders, nextTribeId: leaders[0].tribeId }
}

export async function shuffleSGTribes(leagueId: string) {
  const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
  const config = season.config as unknown as SGConfig, period = season.currentPeriod + 1
  if (!config.shufflePeriods.includes(period) || !readSGPeriodState(season.periodState)?.ceremonyStarted) throw new Error('A shuffle is available only after the prior ceremony at a scheduled shuffle period.')
  const calendar = readSGCalendar(season.periodCalendar)
  if (!calendar[period]) throw new Error('Save the shuffle period calendar first.')
  if (calendar[period].tribes?.length) throw new Error('This shuffle already has saved assignments.')
  const eliminated = new Set((await prisma.survivorGuillotineChop.findMany({ where: { leagueId, reversedAt: null }, select: { rosterId: true } })).map(r => r.rosterId))
  const active = (await prisma.roster.findMany({ where: { leagueId }, select: { id: true } })).filter(r => !eliminated.has(r.id))
  for (let i = active.length - 1; i > 0; i--) { const j = randomInt(i + 1); [active[i], active[j]] = [active[j], active[i]] }
  const tribes = active.map((r, i) => ({ rosterId: r.id, tribeId: `tribe-${i % config.tribeCount}`, captain: false }))
  const saved = await prisma.survivorGuillotineLeague.updateMany({ where: { leagueId, revision: season.revision },
    data: { tribes: tribes as Prisma.InputJsonValue, periodCalendar: { ...calendar,
      [period]: { ...calendar[period], tribes } } as Prisma.InputJsonValue, revision: { increment: 1 } } })
  if (saved.count !== 1) throw new Error('Season changed; reload before shuffling.')
  return { period, tribes, captainVoteRequired: true }
}

export function readSGCalendar(value: unknown): Record<number, SGCalendarEntry> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<number, SGCalendarEntry>
}

export async function saveSGCalendar(leagueId: string, calendar: Record<number, SGCalendarEntry>, rewardPeriods: number[]) {
  const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
  const config = season.config as unknown as SGConfig
  const schedule = buildSGSchedule(config)
  if (schedule.errors.length) throw new Error(schedule.errors.join(' '))
  const periodIds = new Set(schedule.periods.map(p => p.period))
  const previousCalendar = readSGCalendar(season.periodCalendar)
  for (const [key, row] of Object.entries(calendar)) {
    const period = Number(key)
    if (period < season.currentPeriod && JSON.stringify(row) !== JSON.stringify(previousCalendar[period])) throw new Error(`Completed period ${period} cannot be rescheduled.`)
    if (!periodIds.has(period) || !row || !Number.isFinite(Date.parse(row.ceremonyAt))) throw new Error(`Invalid calendar entry for period ${key}.`)
    if (schedule.periods.find(p => p.period === period)?.mode !== 'off' &&
        (!row.scoringStartsAt || !row.scoringEndsAt || !Number.isFinite(Date.parse(row.scoringStartsAt)) ||
          !Number.isFinite(Date.parse(row.scoringEndsAt)) || Date.parse(row.scoringStartsAt) >= Date.parse(row.scoringEndsAt) ||
          Date.parse(row.ceremonyAt) < Date.parse(row.scoringEndsAt))) throw new Error(`Period ${period} needs scoring dates before its ceremony.`)
    if (row.selectionDeadlineAt && !Number.isFinite(Date.parse(row.selectionDeadlineAt))) throw new Error(`Invalid selection deadline in period ${period}.`)
    validateSGSelectionStages(row.selectionStages, schedule.periods.find(p => p.period === period)!.mode, row.selectionDeadlineAt)
    validateSGOrderChoice(row.orderChoice, row.selectionDeadlineAt)
    if (row.orderChoice && schedule.periods.find(p => p.period === period)?.mode !== 'match_play') throw new Error('Bookends/middle choices apply only to Match Play.')
    if (row.gauntletIdolPlayerId != null && (typeof row.gauntletIdolPlayerId !== 'string' || !row.gauntletIdolPlayerId.trim() || schedule.periods.find(p => p.period === period)?.mode !== 'gauntlet')) throw new Error('Retired-player idol IDs belong only to Gauntlet periods.')
    if (['match_play', 'tribe_champion'].includes(schedule.periods.find(p => p.period === period)?.mode ?? '') &&
        !row.selectionDeadlineAt) throw new Error(`Period ${period} needs a tribe selection cutoff.`)
    if (row.auctionClosesAt && !Number.isFinite(Date.parse(row.auctionClosesAt))) throw new Error(`Invalid auction deadline in period ${period}.`)
    if (row.auctionClosesAt && Date.parse(row.auctionClosesAt) >= Date.parse(row.ceremonyAt)) throw new Error(`Period ${period} auction must close before Chop Night.`)
    if (row.auctionClosesAt && row.scoringStartsAt && Date.parse(row.auctionClosesAt) <= Date.parse(row.scoringStartsAt)) throw new Error(`Period ${period} auction must close after scoring begins.`)
    if (row.auctionClosesAt && schedule.periods.find(p => p.period === period)?.mode !== 'gauntlet') throw new Error(`Period ${period} is not a Gauntlet auction period.`)
    if (config.gauntletIdolAuction && schedule.periods.find(p => p.period === period)?.mode === 'gauntlet' &&
        !row.auctionClosesAt) throw new Error(`Period ${period} needs a sealed auction deadline.`)
    if (row.selectionDeadlineAt && Date.parse(row.selectionDeadlineAt) >= Date.parse(row.ceremonyAt)) throw new Error(`Period ${period} selections must close before Chop Night.`)
  }
  for (const [key, row] of Object.entries(previousCalendar)) if (Number(key) < season.currentPeriod &&
      JSON.stringify(calendar[Number(key)]) !== JSON.stringify(row)) throw new Error(`Completed period ${key} must remain in the calendar.`)
  const dated = Object.entries(calendar).map(([period, row]) => ({ period: Number(period),
    start: row.scoringStartsAt ? Date.parse(row.scoringStartsAt) : null,
    end: row.scoringEndsAt ? Date.parse(row.scoringEndsAt) : null })).sort((a, b) => a.period - b.period)
  for (let i = 1; i < dated.length; i++) if (dated[i - 1].end !== null && dated[i].start !== null &&
      dated[i - 1].end! > dated[i].start!) throw new Error('Scoring periods cannot overlap.')
  const merge = schedule.periods.find(p => p.mode === 'merged')?.period ?? config.championshipPeriod
  const oldRewards = Array.isArray(season.rewardPeriods) ? season.rewardPeriods.filter((p): p is number => Number.isInteger(p)) : []
  if (new Set(rewardPeriods).size !== rewardPeriods.length || rewardPeriods.some(p => !Number.isInteger(p) || (p < season.currentPeriod && !oldRewards.includes(p)) || p < 1 || p >= merge - 1 ||
      schedule.periods.find(row => row.period === p)?.mode === 'off')) throw new Error('Choose distinct, active reward periods before the merge.')
  const effectiveRewards = [...new Set([...oldRewards, ...rewardPeriods])].sort((a, b) => a - b)
  const saved = await prisma.survivorGuillotineLeague.updateMany({ where: { leagueId, revision: season.revision },
    data: { periodCalendar: calendar as Prisma.InputJsonValue, rewardPeriods: effectiveRewards as Prisma.InputJsonValue,
      revision: { increment: 1 } } })
  if (saved.count !== 1) throw new Error('Calendar changed; reload and retry.')
  return { periods: Object.keys(calendar).length, rewardsAdded: rewardPeriods.length }
}

function selectionOrder(tribes: SGTribeMember[], random: boolean): string[] {
  const order = [...new Set(tribes.map(member => member.tribeId))]
  if (random) for (let i = order.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

/** Uses the saved commissioner calendar; the next period cannot silently invent dates. */
export async function advanceSGPeriod(leagueId: string, now = new Date()) {
  const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
  const config = season.config as unknown as SGConfig
  const schedule = buildSGSchedule(config)
  const nextPeriod = season.currentPeriod + 1
  const row = schedule.periods.find(p => p.period === nextPeriod)
  if (!row || season.status === 'completed') return { advanced: false, reason: 'season_complete' }
  const previous = readSGPeriodState(season.periodState)
  if (season.currentPeriod > 0 && !previous?.ceremonyStarted) return { advanced: false, reason: 'previous_ceremony_pending' }
  const priorHistory = (season.periodHistory as Record<string, { hostedCeremony?: { stage: number } }>)[String(season.currentPeriod)]
  if (priorHistory?.hostedCeremony && priorHistory.hostedCeremony.stage < 3) return { advanced: false, reason: 'hosted_ceremony_in_progress' }
  const calendar = readSGCalendar(season.periodCalendar)[nextPeriod]
  if (!calendar) return { advanced: false, reason: 'calendar_missing' }
  if (calendar.scoringStartsAt && Date.parse(calendar.scoringStartsAt) > now.getTime()) return { advanced: false, reason: 'not_started' }
  const pastChops = await prisma.survivorGuillotineChop.findMany({ where: { leagueId, reversedAt: null }, select: { rosterId: true } })
  const eliminated = new Set(pastChops.map(c => c.rosterId))
  const rosters = await prisma.roster.findMany({ where: { leagueId }, select: { id: true } })
  const active = rosters.map(r => r.id).filter(id => !eliminated.has(id))
  if (active.length !== row.teamsEntering) throw new Error('Active manager count does not match the next period.')
  const oldTribes = readSGTribes(season.tribes).filter(m => active.includes(m.rosterId))
  let tribes: SGTribeMember[]
  if (calendar.tribes?.length) {
    tribes = calendar.tribes.map(member => ({ ...member }))
    if (row.mode === 'gauntlet' && config.gauntletCaptains === 'previous_period_top_two' &&
        !tribes.some(member => member.captain)) {
      const history = season.scoreHistory as Record<string, Record<string, number>>
      const prior = history[String(nextPeriod - 1)] ?? {}
      const top = [...active].sort((a, b) => (prior[b] ?? 0) - (prior[a] ?? 0) || a.localeCompare(b)).slice(0, 2)
      if (tribes.find(m => m.rosterId === top[0])?.tribeId !== tribes.find(m => m.rosterId === top[1])?.tribeId) {
        tribes = tribes.map(m => ({ ...m, captain: top.includes(m.rosterId) }))
      }
    } else if (row.mode === 'match_play' || row.mode === 'tribe_champion') {
      const oldCaptains = new Set(oldTribes.filter(m => m.captain).map(m => m.rosterId))
      tribes = tribes.map(m => ({ ...m, captain: m.captain || oldCaptains.has(m.rosterId) }))
    }
  }
  else if (row.mode === 'merged' || row.mode === 'final_three') tribes = active.map(rosterId => ({ rosterId, tribeId: 'merged' }))
  else if (row.mode === 'gauntlet' && schedule.periods.find(p => p.mode === 'gauntlet')?.period === nextPeriod) {
    return { advanced: false, reason: 'gauntlet_draft_pending' }
  } else tribes = oldTribes
  if (tribes.length !== active.length || new Set(tribes.map(m => m.rosterId)).size !== active.length ||
      tribes.some(m => !active.includes(m.rosterId))) throw new Error('Next period tribe assignments are incomplete.')
  if (row.mode === 'gauntlet') {
    const ids = [...new Set(tribes.map(m => m.tribeId))]
    if (ids.length !== 2 || ids.some(id => tribes.filter(m => m.tribeId === id).length !== active.length / 2)) {
      throw new Error('The Gauntlet needs two equal tribes.')
    }
  }
  if (config.shufflePeriods.includes(nextPeriod) && !calendar.tribes?.length) return { advanced: false, reason: 'shuffle_pending' }
  if ((row.mode === 'match_play' || row.mode === 'tribe_champion') &&
      [...new Set(tribes.map(m => m.tribeId))].some(id => tribes.filter(m => m.tribeId === id && m.captain).length !== 1)) {
    return { advanced: false, reason: 'captain_vote_pending' }
  }
  const state: SGLivePeriod = { period: nextPeriod, matchups: [], champions: [], sitOuts: [],
    priorSitOuts: previous?.sitOuts ?? [], ceremonyAt: calendar.ceremonyAt,
    scoringStartsAt: calendar.scoringStartsAt ?? null, scoringEndsAt: calendar.scoringEndsAt ?? null,
    selectionDeadlineAt: calendar.selectionDeadlineAt ?? null,
    selectionOrder: selectionOrder(tribes, config.matchupOrder === 'random'),
    selectionStages: calendar.selectionStages,
    orderChoice: calendar.orderChoice,
    gauntletIdolPlayerId: calendar.gauntletIdolPlayerId ?? null,
    immunityDeadlineAt: config.immunityDeadline === 'custom' ? config.customImmunityDeadline : calendar.ceremonyAt,
    playerPowerDeadlineAt: config.playerPowerDeadline === 'custom' ? config.customPlayerPowerDeadline : null,
    ceremonyStarted: false }
  await configureSGLivePeriod(leagueId, tribes, state, season.revision)
  return { advanced: true, period: nextPeriod }
}

export async function submitSGGauntletBid(leagueId: string, userId: string, amount: number, now = new Date()) {
  const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
  const config = season.config as unknown as SGConfig
  const period = buildSGSchedule(config).periods.find(p => p.period === season.currentPeriod)
  const close = readSGCalendar(season.periodCalendar)[season.currentPeriod]?.auctionClosesAt
    if (config.gauntletIdolMode === 'retired_player' || !config.gauntletIdolAuction || period?.mode !== 'gauntlet' || !close || now >= new Date(close)) {
    throw new Error('No open Gauntlet idol auction.')
  }
  if (!Number.isInteger(amount) || amount < 1) throw new Error('Bid a positive whole FAAB amount.')
  if (await prisma.survivorGuillotinePower.count({ where: { leagueId, source: 'gauntlet_auction',
    status: { in: ['held', 'sealed'] } } })) throw new Error('A Gauntlet idol is already in circulation.')
  const roster = await getSGManagerRoster(leagueId, userId)
  if (amount > (roster.faabRemaining ?? 0)) throw new Error('Bid exceeds your available FAAB.')
  await prisma.survivorGuillotineAuctionBid.upsert({ where: { leagueId_period_rosterId: {
    leagueId, period: season.currentPeriod, rosterId: roster.id } },
    create: { leagueId, period: season.currentPeriod, rosterId: roster.id, amount },
    update: { amount, status: 'sealed' } })
  return { submitted: true, period: season.currentPeriod, amount }
}

/** Highest sealed bid wins; earliest original bid breaks ties. Deduct both roster stores atomically. */
export async function settleSGGauntletAuction(leagueId: string, now = new Date()) {
  const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
  const config = season.config as unknown as SGConfig
  const period = buildSGSchedule(config).periods.find(p => p.period === season.currentPeriod)
  const close = readSGCalendar(season.periodCalendar)[season.currentPeriod]?.auctionClosesAt
  if (config.gauntletIdolMode === 'retired_player' || !config.gauntletIdolAuction || period?.mode !== 'gauntlet' || !close || now < new Date(close)) return { settled: false, reason: 'not_due' }
  const bids = await prisma.survivorGuillotineAuctionBid.findMany({ where: { leagueId, period: season.currentPeriod, status: 'sealed' },
    orderBy: [{ amount: 'desc' }, { createdAt: 'asc' }, { rosterId: 'asc' }] })
  if (!bids.length) return { settled: false, reason: 'no_bids' }
  if (await prisma.survivorGuillotinePower.count({ where: { leagueId, source: 'gauntlet_auction',
    status: { in: ['held', 'sealed'] } } })) return { settled: false, reason: 'idol_in_circulation' }
  let winner: (typeof bids)[number] | undefined
  let owner: { claimedByUserId: string | null } | null = null
  let roster: { redraftRosterId: string | null; faabRemaining: number | null } | null = null
  for (const bid of bids) {
    const [candidateOwner, candidateRoster] = await Promise.all([
      prisma.leagueTeam.findFirst({ where: { leagueId, externalId: bid.rosterId,
        eliminatedAt: null }, select: { claimedByUserId: true } }),
      prisma.roster.findUnique({ where: { id: bid.rosterId }, select: { redraftRosterId: true, faabRemaining: true } }),
    ])
    if (candidateOwner?.claimedByUserId && candidateRoster && (candidateRoster.faabRemaining ?? 0) >= bid.amount) {
      winner = bid; owner = candidateOwner; roster = candidateRoster; break
    }
  }
  if (!winner || !owner?.claimedByUserId || !roster) throw new Error('No active bidder has enough FAAB; commissioner review required.')
  const lastGauntlet = Math.max(...buildSGSchedule(config).periods.filter(p => p.mode === 'gauntlet').map(p => p.period))
  const powerId = randomUUID()
  await prisma.$transaction(async tx => {
    const claimed = await tx.survivorGuillotineLeague.updateMany({ where: { leagueId, revision: season.revision },
      data: { revision: { increment: 1 } } })
    if (claimed.count !== 1) throw new Error('Auction changed; retry.')
    const debit = await tx.roster.updateMany({ where: { id: winner.rosterId, faabRemaining: { gte: winner.amount } },
      data: { faabRemaining: { decrement: winner.amount } } })
    if (debit.count !== 1) throw new Error('Winner has insufficient FAAB.')
    if (roster.redraftRosterId) {
      const mirrored = await tx.redraftRoster.updateMany({ where: { id: roster.redraftRosterId,
        faabBalance: { gte: winner.amount } }, data: { faabBalance: { decrement: winner.amount } } })
      if (mirrored.count !== 1) throw new Error('Winner has insufficient mirrored FAAB.')
    }
    await tx.survivorGuillotinePower.create({ data: { id: powerId, leagueId, kind: 'personal_immunity',
      binding: 'manager', ownerUserId: owner.claimedByUserId, activationPeriod: season.currentPeriod,
      expiresAfterPeriod: lastGauntlet, source: 'gauntlet_auction' } })
    await tx.survivorGuillotineAuctionBid.updateMany({ where: { leagueId, period: season.currentPeriod,
      status: 'sealed' }, data: { status: 'lost' } })
    await tx.survivorGuillotineAuctionBid.update({ where: { id: winner.id }, data: { status: 'won' } })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  await createPlatformNotification({ userId: owner.claimedByUserId, leagueId, type: 'survivor_guillotine_reward',
    title: 'Your sealed Gauntlet bid won', body: 'Your private idol is available in Survivor Guilly powers.',
    sourceKey: `survivor-guillotine:${leagueId}:auction:${season.currentPeriod}:${winner.rosterId}` })
  return { settled: true, period: season.currentPeriod }
}

/** Existing waiver heartbeat closes due sealed auctions without a separate cron slot. */
export async function runSGDueAuctions(now = new Date(), limit = 10) {
  const due: { leagueId: string }[] = []
  let scanned = 0
  let cursor: string | undefined
  while (due.length < limit && scanned < 5000) {
    const batch = await prisma.survivorGuillotineLeague.findMany({ where: { status: 'active' },
      select: { id: true, leagueId: true, currentPeriod: true, config: true, periodCalendar: true },
      orderBy: { id: 'asc' }, take: 250, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) })
    scanned += batch.length
    for (const season of batch) {
      const config = season.config as unknown as SGConfig
      const close = readSGCalendar(season.periodCalendar)[season.currentPeriod]?.auctionClosesAt
      if (config.gauntletIdolMode !== 'retired_player' && config.gauntletIdolAuction && close && Date.parse(close) <= now.getTime() &&
          buildSGSchedule(config).periods.some(p => p.period === season.currentPeriod && p.mode === 'gauntlet') && await sgAutomationAllowed(season.leagueId,'auctions')) due.push(season)
      if (due.length >= limit) break
    }
    if (batch.length < 250) break
    cursor = batch.at(-1)!.id
  }
  const results: { leagueId: string; status: string; error?: string }[] = []
  for (const season of due) {
    try { if(!await sgAutomationAllowed(season.leagueId,'auctions'))continue
      const result = await settleSGGauntletAuction(season.leagueId, now)
      await recordSGAutomation(season.leagueId,'auctions','completed')
      results.push({ leagueId: season.leagueId, status: 'reason' in result ? String(result.reason) : 'settled' }) }
    catch (error) { await recordSGAutomation(season.leagueId,'auctions','held').catch(()=>{}); results.push({ leagueId: season.leagueId, status: 'failed',
      error: error instanceof Error ? error.message : 'Auction settlement failed' }) }
  }
  return { scanned, due: due.length, results }
}

/** At the saved cutoff, leagues that opted into random fallback fill only missing legal choices. */
export async function runSGSelectionDeadlines(now = new Date(), limit = 10) {
  const due: { leagueId: string; currentPeriod: number; config: Prisma.JsonValue; tribes: Prisma.JsonValue;
    periodState: Prisma.JsonValue; periodHistory: Prisma.JsonValue; revision: number }[] = []
  let scanned = 0
  let cursor: string | undefined
  while (due.length < limit && scanned < 5000) {
    const batch = await prisma.survivorGuillotineLeague.findMany({ where: { status: 'active' },
      select: { id: true, leagueId: true, currentPeriod: true, config: true, tribes: true, periodState: true,
        periodHistory: true, revision: true }, orderBy: { id: 'asc' }, take: 250,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) })
    scanned += batch.length
    for (const season of batch) {
      const config = season.config as unknown as SGConfig
      const state = readSGPeriodState(season.periodState)
      const mode = buildSGSchedule(config).periods.find(p => p.period === season.currentPeriod)?.mode
      const members = readSGTribes(season.tribes)
      const pendingStage = mode === 'match_play' ? sgMatchupStage(state?.selectionStages, state?.matchups.length ?? 0)
        : state?.selectionStages?.find(stage => !state.champions.some(id => members.some(m => m.rosterId === id && m.tribeId === stage.tribeId)))
      const dueAt = state?.orderChoice && !state.orderChoice.selected ? state.orderChoice.deadlineAt : pendingStage?.deadlineAt ?? state?.selectionDeadlineAt
      if (config.missingSubmission === 'random' && state && dueAt &&
          Date.parse(dueAt) <= now.getTime() && !state.ceremonyStarted &&
          !state.selectionFallbackAppliedAt &&
          ['match_play', 'tribe_champion'].includes(buildSGSchedule(config).periods.find(p => p.period === season.currentPeriod)?.mode ?? '') && await sgAutomationAllowed(season.leagueId,'selections')) due.push(season)
      if (due.length >= limit) break
    }
    if (batch.length < 250) break
    cursor = batch.at(-1)!.id
  }
  const results: { leagueId: string; status: string; error?: string }[] = []
  for (const season of due) {
    try {
      if(!await sgAutomationAllowed(season.leagueId,'selections'))continue
      const config = season.config as unknown as SGConfig
      const state = readSGPeriodState(season.periodState)!
      const members = readSGTribes(season.tribes)
      const tribeIds = [...new Set(members.map(m => m.tribeId))]
      const mode = buildSGSchedule(config).periods.find(p => p.period === season.currentPeriod)?.mode
      const next = { ...state, champions: [...state.champions], sitOuts: [...state.sitOuts],
        matchups: [...state.matchups] }
      if (next.orderChoice && !next.orderChoice.selected) {
        const selected = randomInt(2) ? 'bookends' as const : 'middle' as const
        next.selectionStages = sgOrderStages(next.orderChoice, tribeIds, selected)
        next.orderChoice = { ...next.orderChoice, selected }
      }
      if (mode === 'tribe_champion') {
        for (const id of tribeIds) if (!next.champions.some(rosterId => members.some(m => m.rosterId === rosterId && m.tribeId === id))) {
          const deadline = state.selectionStages?.find(stage => stage.tribeId === id)?.deadlineAt ?? state.selectionDeadlineAt
          if (deadline && Date.parse(deadline) > now.getTime()) continue
          const eligible = sgEligibleChampions(config, state.period, members, id, season.periodHistory)
          const options = members.filter(m => eligible.includes(m.rosterId))
          if (!options.length) throw new Error('No eligible champion remains; commissioner review required.')
          next.champions.push(options[randomInt(options.length)].rosterId)
        }
      } else if (!sgMatchupStage(next.selectionStages, next.matchups.length) || Date.parse(sgMatchupStage(next.selectionStages, next.matchups.length)!.deadlineAt) <= now.getTime()) {
        const targetSize = Math.min(...tribeIds.map(id => members.filter(m => m.tribeId === id).length))
        for (const id of tribeIds) {
          const needed = members.filter(m => m.tribeId === id).length - targetSize -
            next.sitOuts.filter(rosterId => members.some(m => m.rosterId === rosterId && m.tribeId === id)).length
          const choices = members.filter(m => m.tribeId === id && !next.sitOuts.includes(m.rosterId) &&
            !state.priorSitOuts.includes(m.rosterId) && !next.matchups.some(pair => pair.team1 === m.rosterId || pair.team2 === m.rosterId))
          if (needed > choices.length) throw new Error(`No eligible sit-out for ${id}; commissioner resolution needed.`)
          for (let count = 0; count < needed; count++) next.sitOuts.push(choices.splice(randomInt(choices.length), 1)[0].rosterId)
        }
        const used = new Set([...next.sitOuts, ...next.matchups.flatMap(pair => [pair.team1, pair.team2])])
        const groups = new Map(tribeIds.map(id => [id, members.filter(m => m.tribeId === id && !used.has(m.rosterId)).map(m => m.rosterId)]))
        while ([...groups.values()].some(list => list.length)) {
          const stage = sgMatchupStage(next.selectionStages, next.matchups.length)
          if (stage && Date.parse(stage.deadlineAt) > now.getTime()) break
          if (next.selectionStages?.length && !stage) throw new Error('The staged matchup counts do not cover the active field.')
          const ordered = [...groups].filter(([, list]) => list.length).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
          if (ordered.length < 2) throw new Error('Unpairable Match Play field needs commissioner resolution.')
          const firstGroup = stage ? ordered.find(([id]) => id === stage.tribeId) : ordered[0]
          const secondGroup = ordered.find(([id]) => id !== firstGroup?.[0])
          if (!firstGroup || !secondGroup) throw new Error('This selection stage has no legal cross-tribe matchup.')
          const first = firstGroup[1].splice(randomInt(firstGroup[1].length), 1)[0]
          const second = secondGroup[1].splice(randomInt(secondGroup[1].length), 1)[0]
          next.matchups.push({ team1: first, team2: second })
        }
      }
      const complete = mode === 'tribe_champion' ? next.champions.length === tribeIds.length
        : new Set([...next.sitOuts, ...next.matchups.flatMap(pair => [pair.team1, pair.team2])]).size === members.length
      if (complete) next.selectionFallbackAppliedAt = now.toISOString()
      const saved = await prisma.survivorGuillotineLeague.updateMany({ where: { leagueId: season.leagueId,
        revision: season.revision }, data: { periodState: next as unknown as Prisma.InputJsonValue,
          revision: { increment: 1 } } })
      await recordSGAutomation(season.leagueId,'selections',saved.count===1?'completed':'held')
      results.push({ leagueId: season.leagueId, status: saved.count === 1 ? 'resolved' : 'stale' })
    } catch (error) { await recordSGAutomation(season.leagueId,'selections','held').catch(()=>{}); results.push({ leagueId: season.leagueId, status: 'failed',
      error: error instanceof Error ? error.message : 'Selection fallback failed' }) }
  }
  return { scanned, due: due.length, results }
}

/** Persist the host's reveal step so every viewer sees the same ceremony. */
export async function advanceSGHostedCeremony(leagueId: string, actorUserId: string, period: number) {
  const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
  const config = season.config as unknown as SGConfig
  if (config.ceremonyMode !== 'hosted' || !config.ceremonyPresentation || season.currentPeriod !== period) {
    throw new Error('There is no active hosted ceremony for this period.')
  }
  const state = readSGPeriodState(season.periodState)
  if (!state?.ceremonyStarted || state.period !== period) throw new Error('Complete Chop Night before revealing stages.')
  const history = season.periodHistory as Record<string, Record<string, unknown>>
  const entry = history[String(period)]
  const hosted = entry?.hostedCeremony as { stage?: number; updatedAt?: string } | null | undefined
  if (!hosted || !Number.isInteger(hosted.stage) || hosted.stage! < 0 || hosted.stage! >= 3) {
    throw new Error('The hosted ceremony is already complete or unavailable.')
  }
  const stage = hosted.stage! + 1
  if (stage === 3) {
    if (entry.pendingCommit !== true) throw new Error('Hosted chop preparation is missing; restart Chop Night.')
    const result = await executeSGLiveChop(leagueId, period)
    return { period, stage: 'hostedRestarted' in result ? 0 : 3,
      ...('hostedRestarted' in result ? { restarted: true } : {}) }
  }
  await prisma.$transaction(async tx => {
    const saved = await tx.survivorGuillotineLeague.updateMany({ where: { leagueId, revision: season.revision },
      data: { revision: { increment: 1 }, periodHistory: { ...history,
        [String(period)]: { ...entry, hostedCeremony: { stage, updatedAt: new Date().toISOString() } } } as Prisma.InputJsonValue } })
    if (saved.count !== 1) throw new Error('The ceremony changed. Reload and try again.')
    const immuneTribeId = entry.immuneTribeId as string | null
    const savedTeamIds = Array.isArray(entry.savedTeamIds) ? entry.savedTeamIds as string[] : []
    const protectedTeamIds = Array.isArray(entry.protectedTeamIds) ? entry.protectedTeamIds as string[] : []
    const choppedTeamIds = Array.isArray(entry.choppedTeamIds) ? entry.choppedTeamIds as string[] : []
    const message = stage === 1 ? (immuneTribeId
      ? `Survivor Guilly period ${period}: ${immuneTribeId} won tribe immunity.`
      : `Survivor Guilly period ${period}: no tribe won immunity.`)
      : stage === 2 ? (protectedTeamIds.length
        ? `Survivor Guilly period ${period}: immunity idols were played for ${protectedTeamIds.join(', ')}. ${savedTeamIds.length ? `Saved: ${savedTeamIds.join(', ')}.` : 'No idol changed the chop.'}`
        : `Survivor Guilly period ${period}: no immunity idol was played.`)
        : `Survivor Guilly period ${period} chop: ${choppedTeamIds.join(', ')} eliminated. Their players enter waivers.`
    await tx.leagueChatMessage.create({ data: { leagueId, userId: actorUserId, type: 'system',
      message,
      metadata: { survivorGuillotine: true, event: 'hosted_ceremony_advanced', period, stage } } })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  return { period, stage }
}

/** Clear an uncommitted reveal after corrected scores or a commissioner tie decision. */
export async function restartSGHostedCeremony(leagueId: string, actorUserId: string, period: number) {
  const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
  const state = readSGPeriodState(season.periodState)
  const history = season.periodHistory as Record<string, Record<string, unknown>>
  const entry = history[String(period)]
  if (season.currentPeriod !== period || state?.period !== period || !state.ceremonyStarted ||
      entry?.pendingCommit !== true ||
      await prisma.survivorGuillotineChop.count({ where: { leagueId, period, reversedAt: null } })) {
    throw new Error('Only an uncommitted hosted ceremony can be restarted.')
  }
  const nextHistory = { ...history }
  delete nextHistory[String(period)]
  const { commissionerTie: _supersededTie, ...resetState } = state
  await prisma.$transaction(async tx => {
    const saved = await tx.survivorGuillotineLeague.updateMany({ where: { leagueId, revision: season.revision },
      data: { revision: { increment: 1 }, periodHistory: nextHistory as Prisma.InputJsonValue,
        periodState: { ...resetState, ceremonyStarted: false } as unknown as Prisma.InputJsonValue } })
    if (saved.count !== 1) throw new Error('Ceremony changed; reload and retry.')
    await tx.leagueChatMessage.create({ data: { leagueId, userId: actorUserId, type: 'system',
      message: `Survivor Guilly period ${period} hosted ceremony was restarted. Earlier reveal stages are superseded; no roster was chopped.`,
      metadata: { survivorGuillotine: true, event: 'hosted_ceremony_restarted', period } } })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  return { period, restarted: true }
}

/** Earlier-period corrections are reviewed without silently rewriting later drafts, waivers, or chops. */
export async function auditSGHistoricalCorrections(leagueId: string) {
  const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
  const config = season.config as unknown as SGConfig
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { season: true } })
  const history = season.periodHistory as Record<string, {
    scores?: Record<string, number>; teams?: { id: string; tribeId: string; points: number; previousPoints: number | null }[];
    matchups?: { team1: string; team2: string }[]; protectedTeamIds?: string[];
    gauntletImmuneTribeId?: string | null; choppedTeamIds?: string[]; placements?: string[] }>
  const calendar = readSGCalendar(season.periodCalendar)
  const schedule = buildSGSchedule(config).periods
  const changes: { period: number; changedRosterIds: string[]; result: string; proposedChops?: string[];
    originalChops?: string[]; correctedScores?: Record<string, number>;
    review?: { decision: string; reason: string; reviewedAt: string; scoreFingerprint: string;
      originalScores?: Record<string, number>; originalChops?: string[]; proposedChops?: string[] | null;
      scoresApplied?: boolean; compensations?: { recipientRosterId: string; kind: string; amount: number;
        reason: string; awardedAt: string; awardedByUserId: string }[] } | null }[] = []
  for (const [key, entry] of Object.entries(history)) {
    const periodNumber = Number(key)
    if (!Number.isInteger(periodNumber) || periodNumber >= season.currentPeriod || !entry.scores || !entry.teams) continue
    const period = schedule.find(row => row.period === periodNumber)
    if (!period || period.mode === 'off') continue
    const ids = entry.teams.map(team => team.id)
    const final = await prisma.teamWeekResult.findMany({ where: { leagueId, season: league.season,
      week: periodNumber, status: 'final', rosterId: { in: ids } }, select: { rosterId: true, totalPoints: true } })
    if (final.length !== ids.length) { changes.push({ period: periodNumber, changedRosterIds: [], result: 'awaiting_final_scores' }); continue }
    const row = calendar[periodNumber]
    // Survivor scoring has already applied the game cap to these finalized historical totals.
    const scores = new Map(final.map(s => [s.rosterId, s.totalPoints]))
    const correctedScores = Object.fromEntries([...scores].sort(([a], [b]) => a.localeCompare(b)))
    const review = (entry as typeof entry & { correctionReview?: { decision: string; reason: string;
      reviewedAt: string; scoreFingerprint: string; originalScores?: Record<string, number>;
      originalChops?: string[]; proposedChops?: string[] | null; scoresApplied?: boolean;
      compensations?: { recipientRosterId: string; kind: string; amount: number; reason: string;
        awardedAt: string; awardedByUserId: string }[] } }).correctionReview
    const changedRosterIds = ids.filter(id => scores.get(id) !== entry.scores![id])
    if (!changedRosterIds.length) {
      const originallyChanged = ids.filter(id => review?.originalScores?.[id] !== undefined &&
        review.originalScores[id] !== entry.scores![id])
      if (review?.scoresApplied && originallyChanged.length &&
          review.scoreFingerprint === JSON.stringify(correctedScores)) changes.push({
        period: periodNumber, changedRosterIds: originallyChanged, result: 'reviewed_played_result',
        proposedChops: review.proposedChops ?? undefined, originalChops: review.originalChops ?? entry.choppedTeamIds ?? [],
        correctedScores, review,
      })
      continue
    }
    const teams = entry.teams.map(team => ({ ...team, points: scores.get(team.id)! }))
    const resolution = resolveSGPeriod({ config, period, teams, matchups: entry.matchups ?? [],
      protectedTeamIds: entry.protectedTeamIds ?? [],
      gauntletImmuneTribeId: entry.gauntletImmuneTribeId ?? undefined })
    changes.push({ period: periodNumber, changedRosterIds,
      result: resolution.status === 'resolved' && JSON.stringify([...resolution.choppedTeamIds].sort()) ===
        JSON.stringify([...(entry.choppedTeamIds ?? [])].sort()) ? 'scores_changed_chop_same' : 'commissioner_reconciliation_required',
      proposedChops: resolution.status === 'resolved' ? resolution.choppedTeamIds : undefined,
      originalChops: entry.choppedTeamIds ?? [], correctedScores,
      review: review?.scoreFingerprint === JSON.stringify(correctedScores) ? review : null })
  }
  return { reviewed: Object.keys(history).length, changes }
}

/** A previous chop may have downstream claims and drafts. Record a commissioner decision without rewriting those transactions. */
export async function reviewSGHistoricalCorrection(leagueId: string, actorUserId: string, period: number,
  decision: 'keep_played_result' | 'manual_followup', reason: string) {
  if (!Number.isInteger(period) || period < 1 || !['keep_played_result', 'manual_followup'].includes(decision) ||
      reason.trim().length < 10) throw new Error('Choose an earlier period, decision, and a reason of at least 10 characters.')
  const audit = await auditSGHistoricalCorrections(leagueId)
  const change = audit.changes.find(row => row.period === period && row.changedRosterIds.length > 0)
  if (!change?.correctedScores) throw new Error('No finalized historical correction is available for this period.')
  if (change.review?.scoresApplied) throw new Error('This correction was already reviewed and applied.')
  const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
  const activeState = readSGPeriodState(season.periodState)
  if (activeState?.ceremonyStarted && activeState.period === period) {
    throw new Error('Use automatic latest-chop reconciliation before advancing the period.')
  }
  const history = season.periodHistory as Record<string, Record<string, unknown>>
  const review = { decision, reason: reason.trim(), reviewedAt: new Date().toISOString(),
    reviewedByUserId: actorUserId, scoreFingerprint: JSON.stringify(change.correctedScores),
    originalChops: change.originalChops ?? [],
    proposedChops: change.proposedChops ?? null }
  const entry = history[String(period)]
  const priorReview = entry.correctionReview as { originalScores?: Record<string, number>;
    compensations?: unknown[] } | undefined
  const originalScores = priorReview?.originalScores ?? entry.scores as Record<string, number>
  const scoreHistory = season.scoreHistory && typeof season.scoreHistory === 'object' && !Array.isArray(season.scoreHistory)
    ? season.scoreHistory as Record<string, Record<string, number>> : {}
  const correctedEntry = decision === 'keep_played_result' ? {
    ...entry, scores: change.correctedScores,
    teams: (entry.teams as { id: string; points: number }[]).map(team => ({ ...team,
      points: change.correctedScores![team.id] ?? team.points })),
    correctionReview: { ...review, originalScores, scoresApplied: true,
      compensations: priorReview?.compensations ?? [] },
  } : { ...entry, correctionReview: review }
  await prisma.$transaction(async tx => {
    const saved = await tx.survivorGuillotineLeague.updateMany({ where: { leagueId, revision: season.revision },
      data: { revision: { increment: 1 }, periodHistory: { ...history,
        [String(period)]: correctedEntry } as Prisma.InputJsonValue,
      ...(decision === 'keep_played_result' ? { scoreHistory: { ...scoreHistory,
        [String(period)]: change.correctedScores } as Prisma.InputJsonValue } : {}) } })
    if (saved.count !== 1) throw new Error('Season changed during correction review; reload and retry.')
    if (decision === 'keep_played_result') {
      for (const rosterId of change.originalChops ?? []) {
        const score = change.correctedScores?.[rosterId]
        if (score !== undefined) await tx.survivorGuillotineChop.updateMany({ where: {
          leagueId, period, rosterId, reversedAt: null }, data: { score } })
      }
    }
    await tx.leagueChatMessage.create({ data: { leagueId, userId: actorUserId, type: 'system',
      message: `The commissioner reviewed a period ${period} stat correction. ${decision === 'keep_played_result'
        ? 'Corrected scores are official; the played elimination and later transactions remain in place.' : 'Manual follow-up is required.'}`,
      metadata: { survivorGuillotine: true, event: 'historical_correction_review', period, decision } } })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  return { period, ...review }
}

/** A reviewed earlier chop stays played; commissioners can record a remedy and optionally credit live FAAB. */
export async function awardSGHistoricalCompensation(leagueId: string, actorUserId: string, period: number,
  recipientRosterId: string, amount: number, reason: string) {
  if (!Number.isInteger(period) || period < 1 || !recipientRosterId || !Number.isInteger(amount) || amount < 0 ||
      reason.trim().length < 10) throw new Error('Choose a recipient, whole-number FAAB amount, and a reason of at least 10 characters.')
  const audit = await auditSGHistoricalCorrections(leagueId)
  const change = audit.changes.find(row => row.period === period)
  if (change?.review?.decision !== 'keep_played_result' || !change.review.scoresApplied) {
    throw new Error('Apply the corrected scores and keep the played result before recording compensation.')
  }
  const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
  const config = season.config as unknown as SGConfig
  if (amount > config.faabBudget) throw new Error('Compensation cannot exceed the league starting FAAB budget.')
  const history = season.periodHistory as Record<string, Record<string, unknown>>
  const entry = history[String(period)]
  const review = entry.correctionReview as NonNullable<typeof change.review>
  const prior = review.compensations ?? []
  if (prior.some(item => item.recipientRosterId === recipientRosterId)) {
    throw new Error('This manager already has a compensation decision for this correction.')
  }
  const team = await prisma.leagueTeam.findFirst({ where: { leagueId, externalId: recipientRosterId },
    select: { eliminatedAt: true, teamName: true, ownerName: true } })
  if (!team) throw new Error('Recipient is not a member of this league.')
  if (amount > 0 && team.eliminatedAt) throw new Error('FAAB can only be credited to an active manager; use zero for a recorded external remedy.')
  const roster = amount > 0 ? await prisma.roster.findFirst({ where: { id: recipientRosterId, leagueId },
    select: { id: true, redraftRosterId: true, faabRemaining: true, updatedAt: true } }) : null
  if (amount > 0 && !roster) throw new Error('Active recipient roster is unavailable.')
  const compensation = { recipientRosterId, kind: amount > 0 ? 'faab' : 'record_only', amount,
    reason: reason.trim(), awardedAt: new Date().toISOString(), awardedByUserId: actorUserId,
    ...(amount > 0 ? { balanceBefore: roster!.faabRemaining ?? 0,
      balanceAfter: (roster!.faabRemaining ?? 0) + amount } : {}) }
  await prisma.$transaction(async tx => {
    const saved = await tx.survivorGuillotineLeague.updateMany({ where: { leagueId, revision: season.revision },
      data: { revision: { increment: 1 }, periodHistory: { ...history, [String(period)]: {
        ...entry, correctionReview: { ...review, compensations: [...prior, compensation] },
      } } as Prisma.InputJsonValue } })
    if (saved.count !== 1) throw new Error('Correction review changed; reload and retry.')
    if (amount > 0 && roster) {
      const credited = await tx.roster.updateMany({ where: { id: roster.id, leagueId, updatedAt: roster.updatedAt },
        data: { faabRemaining: compensation.balanceAfter } })
      if (credited.count !== 1) throw new Error('Recipient FAAB changed; reload and retry.')
      if (roster.redraftRosterId) await tx.redraftRoster.update({ where: { id: roster.redraftRosterId },
        data: { faabBalance: { increment: amount } } })
    }
    await tx.leagueChatMessage.create({ data: { leagueId, userId: actorUserId, type: 'system',
      message: amount > 0
        ? `The commissioner awarded ${amount} FAAB to ${team.teamName || team.ownerName} for a period ${period} stat correction. Reason: ${reason.trim()}`
        : `The commissioner recorded a non-FAAB remedy for ${team.teamName || team.ownerName} after the period ${period} stat correction. Reason: ${reason.trim()}`,
      metadata: { survivorGuillotine: true, event: 'historical_correction_compensation', period,
        recipientRosterId, amount } } })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  return { period, compensation }
}
