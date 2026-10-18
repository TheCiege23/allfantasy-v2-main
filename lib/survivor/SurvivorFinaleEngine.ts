import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { appendSurvivorAudit } from './SurvivorAuditLog'
import { getActiveEffectsForRoster } from './SurvivorEffectEngine'
import { getJuryMembers } from './SurvivorJuryEngine'
import { getSurvivorConfig } from './SurvivorLeagueConfig'
import { isMergeTriggered } from './SurvivorMergeEngine'
import { getActiveRosterIdsForLeague } from './SurvivorRosterState'
import { getSeasonPointsFromRosterPerformance } from './SurvivorVoteEngine'
import { readSurvivorLateSeasonSettings } from './lateSeasonSettings'
import { isFinaleVoteComplete } from './finaleReveal'

export interface SurvivorFinaleVote {
  jurorRosterId: string
  finalistRosterId: string
  submittedAt: Date
  weight: number
}

export interface SurvivorFinaleState {
  open: boolean
  closed: boolean
  finalists: string[]
  juryRosterIds: string[]
  votes: SurvivorFinaleVote[]
  votesSubmitted: number
  votesRequired: number
  pendingJuryRosterIds: string[]
  voteCount: Record<string, number>
  bonusVotesByFinalist: Record<string, number>
  winnerRosterId: string | null
  crownedAt: Date | null
  tieBreakSeasonPoints: Record<string, number> | null
  /** finalistCount setting (2 or 3). */
  finalistCount: 2 | 3
  /** Commissioner's jury deadline (JurySession.votingDeadline). */
  votingDeadline: Date | null
  /** Every juror has voted, or the deadline has passed: the result may be revealed. */
  votingComplete: boolean
}

function asJsonObject(value: unknown): Prisma.JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Prisma.JsonObject
}

function readString(obj: Prisma.JsonObject | null, key: string): string | null {
  if (!obj) return null
  const value = obj[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readDate(obj: Prisma.JsonObject | null, key: string): Date | null {
  const raw = readString(obj, key)
  if (!raw) return null
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function readJsonRecord(obj: Prisma.JsonObject | null, key: string): Record<string, number> | null {
  if (!obj) return null
  const raw = obj[key]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record: Record<string, number> = {}
  for (const [recordKey, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      record[recordKey] = value
    }
  }
  return Object.keys(record).length > 0 ? record : null
}

async function getLatestWinnerEvent(leagueId: string): Promise<{
  winnerRosterId: string | null
  crownedAt: Date | null
  voteCount: Record<string, number> | null
  tieBreakSeasonPoints: Record<string, number> | null
} | null> {
  const row = await prisma.survivorAuditLog.findFirst({
    where: {
      leagueId,
      eventType: 'winner_crowned',
    },
    orderBy: { createdAt: 'desc' },
    select: { metadata: true, createdAt: true },
  })
  if (!row) return null

  const metadata = asJsonObject(row.metadata)
  return {
    winnerRosterId: readString(metadata, 'winnerRosterId'),
    crownedAt: readDate(metadata, 'crownedAt') ?? row.createdAt,
    voteCount: readJsonRecord(metadata, 'voteCount'),
    tieBreakSeasonPoints: readJsonRecord(metadata, 'tieBreakSeasonPoints'),
  }
}

async function computeWeightedVotes(
  leagueId: string,
  week: number,
  juryRosterIds: string[],
  finalists: string[]
): Promise<{
  votes: SurvivorFinaleVote[]
  voteCount: Record<string, number>
  bonusVotesByFinalist: Record<string, number>
}> {
  const rows = await prisma.survivorAuditLog.findMany({
    where: {
      leagueId,
      eventType: 'jury_vote_submitted',
    },
    orderBy: { createdAt: 'asc' },
    select: { metadata: true, createdAt: true },
  })

  const jurySet = new Set(juryRosterIds)
  const finalistSet = new Set(finalists)
  const latestByJuror = new Map<string, { finalistRosterId: string; submittedAt: Date }>()
  for (const row of rows) {
    const metadata = asJsonObject(row.metadata)
    const jurorRosterId = readString(metadata, 'jurorRosterId')
    const finalistRosterId = readString(metadata, 'finalistRosterId')
    if (!jurorRosterId || !finalistRosterId) continue
    if (!jurySet.has(jurorRosterId) || !finalistSet.has(finalistRosterId)) continue
    latestByJuror.set(jurorRosterId, {
      finalistRosterId,
      submittedAt: row.createdAt,
    })
  }

  const votes: SurvivorFinaleVote[] = []
  const voteCount: Record<string, number> = Object.fromEntries(finalists.map((finalistRosterId) => [finalistRosterId, 0]))
  const bonusVotesByFinalist: Record<string, number> = Object.fromEntries(finalists.map((finalistRosterId) => [finalistRosterId, 0]))

  for (const finalistRosterId of finalists) {
    const activeEffects = await getActiveEffectsForRoster(leagueId, finalistRosterId, week)
    bonusVotesByFinalist[finalistRosterId] = activeEffects.filter((effect) => effect.rewardType === 'finale_advantage').length
    voteCount[finalistRosterId] += bonusVotesByFinalist[finalistRosterId]
  }

  for (const [jurorRosterId, vote] of latestByJuror.entries()) {
    const activeEffects = await getActiveEffectsForRoster(leagueId, jurorRosterId, week)
    const weight = activeEffects.some((effect) => effect.rewardType === 'jury_influence') ? 2 : 1
    votes.push({
      jurorRosterId,
      finalistRosterId: vote.finalistRosterId,
      submittedAt: vote.submittedAt,
      weight,
    })
    voteCount[vote.finalistRosterId] = (voteCount[vote.finalistRosterId] ?? 0) + weight
  }

  return { votes, voteCount, bonusVotesByFinalist }
}

async function resolveWinnerFromVoteCount(
  leagueId: string,
  week: number,
  finalists: string[],
  voteCount: Record<string, number>
): Promise<{ winnerRosterId: string | null; tieBreakSeasonPoints: Record<string, number> | null }> {
  if (finalists.length === 0) {
    return { winnerRosterId: null, tieBreakSeasonPoints: null }
  }

  const maxVotes = Math.max(...finalists.map((finalistRosterId) => voteCount[finalistRosterId] ?? 0))
  const tiedFinalists = finalists.filter((finalistRosterId) => (voteCount[finalistRosterId] ?? 0) === maxVotes)
  if (tiedFinalists.length === 1) {
    return { winnerRosterId: tiedFinalists[0], tieBreakSeasonPoints: null }
  }

  const seasonPoints: Record<string, number> = {}
  for (const finalistRosterId of tiedFinalists) {
    seasonPoints[finalistRosterId] = await getSeasonPointsFromRosterPerformance(leagueId, finalistRosterId, week)
  }
  const maxSeasonPoints = Math.max(...Object.values(seasonPoints))
  const seasonWinners = tiedFinalists.filter((finalistRosterId) => seasonPoints[finalistRosterId] === maxSeasonPoints)
  return {
    winnerRosterId: [...seasonWinners].sort()[0] ?? null,
    tieBreakSeasonPoints: seasonPoints,
  }
}

export async function getFinaleState(
  leagueId: string,
  week: number
): Promise<SurvivorFinaleState> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, survivorFinal3: true } })
  const { finalistCount } = readSurvivorLateSeasonSettings(league?.settings, { survivorFinal3: league?.survivorFinal3 })
  const session = await prisma.jurySession.findUnique({ where: { leagueId }, select: { votingDeadline: true } }).catch(() => null)
  const votingDeadline = session?.votingDeadline ?? null
  const { readSurvivorFullSeasonPlan } = await import('./survivorFullSeasonPlan')
  const plan = readSurvivorFullSeasonPlan(league?.settings)
  const plannedFinaleReady = !plan || (week >= plan.finaleWeek && Boolean((await prisma.survivorGameState.findUnique({ where: { leagueId }, select: { weekScoringFinalAt: true } }))?.weekScoringFinalAt))
  const [merged, activeRosterIds, jury, winnerEvent] = await Promise.all([
    isMergeTriggered(leagueId, week),
    getActiveRosterIdsForLeague(leagueId),
    getJuryMembers(leagueId),
    getLatestWinnerEvent(leagueId),
  ])

  const finalists = merged && plannedFinaleReady && activeRosterIds.length >= 2 && activeRosterIds.length <= finalistCount
    ? [...activeRosterIds].sort()
    : []
  const juryRosterIds = jury.map((member) => member.rosterId)
  const open = finalists.length >= 2 && juryRosterIds.length > 0 && !winnerEvent

  if (!open && !winnerEvent) {
    return {
      open: false,
      closed: false,
      finalists,
      juryRosterIds,
      votes: [],
      votesSubmitted: 0,
      votesRequired: juryRosterIds.length,
      pendingJuryRosterIds: juryRosterIds,
      voteCount: {},
      bonusVotesByFinalist: {},
      winnerRosterId: null,
      crownedAt: null,
      tieBreakSeasonPoints: null,
      finalistCount,
      votingDeadline,
      votingComplete: false,
    }
  }

  const { votes, voteCount, bonusVotesByFinalist } = await computeWeightedVotes(leagueId, week, juryRosterIds, finalists)
  const pendingJuryRosterIds = juryRosterIds.filter(
    (jurorRosterId) => !votes.some((vote) => vote.jurorRosterId === jurorRosterId)
  )

  // The deadline closes voting: jurors who did not vote simply do not count.
  const votingComplete = isFinaleVoteComplete({ votesSubmitted: votes.length, votesRequired: juryRosterIds.length, deadline: votingDeadline, now: new Date(), crowned: Boolean(winnerEvent) })
  const computedWinner = votingComplete
    ? await resolveWinnerFromVoteCount(leagueId, week, finalists, voteCount)
    : { winnerRosterId: null, tieBreakSeasonPoints: null }

  return {
    open,
    closed: Boolean(winnerEvent),
    finalists,
    juryRosterIds,
    votes,
    votesSubmitted: votes.length,
    votesRequired: juryRosterIds.length,
    pendingJuryRosterIds,
    voteCount: winnerEvent?.voteCount ?? voteCount,
    bonusVotesByFinalist,
    winnerRosterId: winnerEvent?.winnerRosterId ?? computedWinner.winnerRosterId,
    crownedAt: winnerEvent?.crownedAt ?? null,
    tieBreakSeasonPoints: winnerEvent?.tieBreakSeasonPoints ?? computedWinner.tieBreakSeasonPoints,
    finalistCount,
    votingDeadline,
    votingComplete,
  }
}

export async function submitJuryVote(args: {
  leagueId: string
  jurorRosterId: string
  finalistRosterId: string
  week: number
  source?: string | null
  command?: string | null
}): Promise<{ ok: boolean; error?: string; state?: SurvivorFinaleState }> {
  const { leagueId, jurorRosterId, finalistRosterId, week } = args
  const config = await getSurvivorConfig(leagueId)
  if (!config) {
    return { ok: false, error: 'Not a Survivor league' }
  }

  const state = await getFinaleState(leagueId, week)
  if (!state.open) {
    return { ok: false, error: 'Final jury voting is not open right now' }
  }
  if (!state.juryRosterIds.includes(jurorRosterId)) {
    return { ok: false, error: 'Only jury members can cast final votes' }
  }
  if (!state.finalists.includes(finalistRosterId)) {
    return { ok: false, error: 'That finalist is not eligible for jury votes' }
  }
  if (jurorRosterId === finalistRosterId) {
    return { ok: false, error: 'Finalists cannot vote for themselves in the finale' }
  }
  if (state.votingDeadline && Date.now() >= state.votingDeadline.getTime()) {
    return { ok: false, error: 'The jury vote has closed' }
  }

  await appendSurvivorAudit(leagueId, config.configId, 'jury_vote_submitted', {
    week,
    jurorRosterId,
    finalistRosterId,
    source: args.source ?? null,
    command: args.command ?? null,
    submittedAt: new Date().toISOString(),
  })

  const updatedState = await getFinaleState(leagueId, week)
  if (!updatedState.closed && updatedState.open && updatedState.pendingJuryRosterIds.length === 0 && updatedState.winnerRosterId) {
    const crowned = await crownFinaleWinner(leagueId, config.configId, week, updatedState)
    return { ok: true, state: crowned }
  }

  return { ok: true, state: updatedState }
}

/** Writes the single winner_crowned record, then mirrors it (jury session, history, badge, chat). */
async function crownFinaleWinner(leagueId: string, configId: string, week: number, updatedState: SurvivorFinaleState): Promise<SurvivorFinaleState> {
  await appendSurvivorAudit(leagueId, configId, 'winner_crowned', {
    week,
    winnerRosterId: updatedState.winnerRosterId,
    finalists: updatedState.finalists,
    voteCount: updatedState.voteCount,
    bonusVotesByFinalist: updatedState.bonusVotesByFinalist,
    tieBreakSeasonPoints: updatedState.tieBreakSeasonPoints,
    crownedAt: new Date().toISOString(),
  })
  const crowned = await getFinaleState(leagueId, week)
  await recordCrownedWinner(leagueId, crowned)
  return crowned
}

/**
 * Settle the finale once the commissioner's jury deadline passes with ballots missing. Idempotent:
 * returns the existing state when already crowned, not open, or not yet due.
 */
export async function settleFinaleIfDue(leagueId: string, week: number): Promise<SurvivorFinaleState> {
  const state = await getFinaleState(leagueId, week)
  if (state.closed || !state.open || !state.votingComplete || !state.winnerRosterId) return state
  const config = await getSurvivorConfig(leagueId)
  if (!config) return state
  return crownFinaleWinner(leagueId, config.configId, week, state)
}

/**
 * This engine is the only place a winner is decided. Mirror the result onto the jury session and
 * cast that the season pages, snapshots and phase machine read, and announce it once.
 */
export async function recordCrownedWinner(leagueId: string, state: SurvivorFinaleState): Promise<{ winnerUserId: string | null }> {
  if (!state.closed || !state.winnerRosterId) return { winnerUserId: null }
  const rosters = await prisma.roster.findMany({
    where: { leagueId, id: { in: [...state.finalists, ...state.juryRosterIds] } },
    select: { id: true, platformUserId: true },
  })
  const userFor = new Map(rosters.map(row => [row.id, row.platformUserId]))
  const winnerUserId = userFor.get(state.winnerRosterId) ?? null
  if (!winnerUserId) return { winnerUserId: null }
  const existing = await prisma.jurySession.findUnique({ where: { leagueId }, select: { winnerId: true } })
  if (existing?.winnerId === winnerUserId) return { winnerUserId }
  const winner = await prisma.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId, userId: winnerUserId } }, select: { displayName: true } })
  const winnerName = winner?.displayName ?? 'The winner'
  const session = {
    status: 'winner_revealed',
    finalistUserIds: state.finalists.map(id => userFor.get(id)).filter((id): id is string => Boolean(id)),
    jurorUserIds: state.juryRosterIds.map(id => userFor.get(id)).filter((id): id is string => Boolean(id)),
    winnerId: winnerUserId,
    winnerName,
    revealedAt: state.crownedAt ? new Date(state.crownedAt) : new Date(),
  }
  await prisma.jurySession.upsert({ where: { leagueId }, create: { leagueId, ...session }, update: session })
  await prisma.survivorPlayer.updateMany({ where: { leagueId, userId: winnerUserId }, data: { playerState: 'survivor_winner' } })
  const channel = await prisma.survivorChatChannel.findFirst({ where: { leagueId, channelType: 'league', isArchived: false }, select: { id: true } })
  if (channel) await prisma.survivorChatMessage.create({ data: { leagueId, channelId: channel.id, channelType: 'league', senderUserId: 'survivor-host-chimmy', senderName: 'Chimmy', senderIsHost: true, isSystemMessage: true,
    contentType: 'host_announcement', content: `The jury has spoken. ${winnerName} is the last one standing.` } })
  await writeChampionToHistory(leagueId, { winnerUserId, winnerName, winnerRosterId: state.winnerRosterId, voteCount: state.voteCount, crownedAt: session.revealedAt }).catch(error => {
    console.error('[survivor-finale] champion history write failed', { leagueId, error: error instanceof Error ? error.message : String(error) })
  })
  return { winnerUserId }
}

/**
 * League history + profile badge for the champion. LeagueChampionship is the league-history table
 * the guillotine and playoff finishers write; AIBadge is the profile badge store (lib/badge-engine).
 * Both are upserts / existence-checked so a re-crown or retry never duplicates them.
 */
async function writeChampionToHistory(leagueId: string, input: { winnerUserId: string; winnerName: string; winnerRosterId: string; voteCount: Record<string, number>; crownedAt: Date }) {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { season: true, name: true, userId: true } })
  if (!league) return
  const season = Number(league.season)
  const seasonPoints = await getSeasonPointsFromRosterPerformance(leagueId, input.winnerRosterId, 99).catch(() => null)
  const record = { championUserId: input.winnerUserId, teamName: input.winnerName.slice(0, 128), pointsFor: seasonPoints, playoffRecord: 'Jury vote', recordedBy: league.userId }
  if (Number.isInteger(season)) {
    await prisma.leagueChampionship.upsert({ where: { leagueId_season: { leagueId, season } }, create: { leagueId, season, ...record }, update: record })
  }
  const existing = await prisma.aIBadge.findFirst({ where: { userId: input.winnerUserId, badgeType: 'survivor_champion', data: { path: ['leagueId'], equals: leagueId } }, select: { id: true } })
  if (!existing) {
    await prisma.aIBadge.create({ data: { userId: input.winnerUserId, badgeType: 'survivor_champion', badgeName: 'Survivor champion',
      description: `Last one standing in ${league.name ?? 'a Survivor league'} (${league.season}).`, tier: 'gold', xpReward: 250,
      data: { leagueId, season: league.season, icon: '/survivor/late/champion-icon.svg', voteCount: input.voteCount, crownedAt: input.crownedAt.toISOString() } } })
  }
}
