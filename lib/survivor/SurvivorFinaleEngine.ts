import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { appendSurvivorAudit } from './SurvivorAuditLog'
import { getActiveEffectsForRoster } from './SurvivorEffectEngine'
import { getJuryMembers } from './SurvivorJuryEngine'
import { getSurvivorConfig } from './SurvivorLeagueConfig'
import { isMergeTriggered } from './SurvivorMergeEngine'
import { getActiveRosterIdsForLeague } from './SurvivorRosterState'
import { getSeasonPointsFromRosterPerformance } from './SurvivorVoteEngine'

const MAX_FINALISTS = 3

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
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const { readSurvivorFullSeasonPlan } = await import('./survivorFullSeasonPlan')
  const plan = readSurvivorFullSeasonPlan(league?.settings)
  const plannedFinaleReady = !plan || (week >= plan.finaleWeek && Boolean((await prisma.survivorGameState.findUnique({ where: { leagueId }, select: { weekScoringFinalAt: true } }))?.weekScoringFinalAt))
  const [merged, activeRosterIds, jury, winnerEvent] = await Promise.all([
    isMergeTriggered(leagueId, week),
    getActiveRosterIdsForLeague(leagueId),
    getJuryMembers(leagueId),
    getLatestWinnerEvent(leagueId),
  ])

  const finalists = merged && plannedFinaleReady && activeRosterIds.length >= 2 && activeRosterIds.length <= MAX_FINALISTS
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
    }
  }

  const { votes, voteCount, bonusVotesByFinalist } = await computeWeightedVotes(leagueId, week, juryRosterIds, finalists)
  const pendingJuryRosterIds = juryRosterIds.filter(
    (jurorRosterId) => !votes.some((vote) => vote.jurorRosterId === jurorRosterId)
  )

  const computedWinner = pendingJuryRosterIds.length === 0
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
    await appendSurvivorAudit(leagueId, config.configId, 'winner_crowned', {
      week,
      winnerRosterId: updatedState.winnerRosterId,
      finalists: updatedState.finalists,
      voteCount: updatedState.voteCount,
      bonusVotesByFinalist: updatedState.bonusVotesByFinalist,
      tieBreakSeasonPoints: updatedState.tieBreakSeasonPoints,
      crownedAt: new Date().toISOString(),
    })
    return { ok: true, state: await getFinaleState(leagueId, week) }
  }

  return { ok: true, state: updatedState }
}
