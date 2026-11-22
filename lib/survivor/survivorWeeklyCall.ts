import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { planWeekWindow, type SurvivorPlanSport } from './survivorPlanCalendar'
import { verifiedSlateWinners } from './survivorVerifiedSlateChallenges'

/**
 * "Call the week": the weekly mini-game. Before the week's games, every manager in the cast (still
 * playing or not) predicts the week's top-scoring tribe, or after the merge the manager who wins
 * individual immunity. The answer is settled from the same finalized scores as the slate, then
 * everyone's calls are shown and a season leaderboard counts who called it.
 *
 * Bragging rights only: no immunity, tokens or advantage ride on it, so it can never tilt a vote.
 */

export const WEEKLY_CALL_TYPE = 'weekly_call'
const WEEKLY_CALL_NUMBER = 3

export type WeeklyCallKind = 'top_tribe' | 'top_scorer'
export type WeeklyCallOption = { id: string; label: string }
type CallConfig = { kind: WeeklyCallKind; options: WeeklyCallOption[] }

const HOUR_MS = 3_600_000

/**
 * When calls lock: before the week's first games. NFL weeks open Tuesday 06:00 Eastern and kick off
 * Thursday night, so Thursday 18:00 Eastern. Daily-sport windows start on a UTC-midnight date key,
 * so 18:00 Eastern on the first day. A week opened late locks six hours after it opens.
 */
export function weeklyCallLockAt(sport: SurvivorPlanSport, season: number, week: number, now: Date): Date | null {
  const window = planWeekWindow(sport, season, week)
  if (!window) return null
  const planned = new Date(window.start.getTime() + (sport === 'NFL' ? 60 : 22) * HOUR_MS)
  if (planned.getTime() > now.getTime()) return planned
  const late = new Date(now.getTime() + 6 * HOUR_MS)
  return late.getTime() < window.end.getTime() ? late : null
}

function readConfig(value: unknown): CallConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (row.kind !== 'top_tribe' && row.kind !== 'top_scorer') return null
  const options = Array.isArray(row.options)
    ? row.options.flatMap(option => {
      const { id, label } = (option ?? {}) as Record<string, unknown>
      return typeof id === 'string' && typeof label === 'string' ? [{ id, label }] : []
    })
    : []
  return { kind: row.kind, options }
}

/** Open the week's call once. The options are a snapshot of the tribes, or the cast after the merge. */
export async function ensureWeeklyCall(leagueId: string, week: number, input: { sport: SurvivorPlanSport; season: number; merged: boolean; now?: Date }): Promise<void> {
  const config = await prisma.survivorLeagueConfig.findUnique({ where: { leagueId }, select: { id: true } })
  if (!config) return
  const existing = await prisma.survivorChallenge.findFirst({ where: { leagueId, week, challengeType: WEEKLY_CALL_TYPE }, select: { id: true } })
  if (existing) return
  const now = input.now ?? new Date()
  const lockAt = weeklyCallLockAt(input.sport, input.season, week, now)
  if (!lockAt) return
  let call: CallConfig
  if (input.merged) {
    const cast = await prisma.survivorPlayer.findMany({ where: { leagueId, playerState: 'active' }, select: { userId: true, displayName: true }, orderBy: { displayName: 'asc' } })
    call = { kind: 'top_scorer', options: cast.map(player => ({ id: player.userId, label: player.displayName })) }
  } else {
    const tribes = await prisma.survivorTribe.findMany({ where: { leagueId, isActive: true, isMerged: false }, select: { id: true, name: true }, orderBy: { slotIndex: 'asc' } })
    call = { kind: 'top_tribe', options: tribes.map(tribe => ({ id: tribe.id, label: tribe.name })) }
  }
  if (call.options.length < 2) return
  await prisma.survivorChallenge.upsert({
    where: { configId_week_challengeNumber_challengeType: { configId: config.id, week, challengeNumber: WEEKLY_CALL_NUMBER, challengeType: WEEKLY_CALL_TYPE } },
    create: {
      leagueId, configId: config.id, week, challengeNumber: WEEKLY_CALL_NUMBER, challengeType: WEEKLY_CALL_TYPE, scope: 'individual',
      title: call.kind === 'top_tribe' ? 'Call the week: which tribe scores the most?' : 'Call the week: who wins individual immunity?',
      description: call.kind === 'top_tribe'
        ? 'Pick the tribe you think puts up the most points this week. Bragging rights only.'
        : 'Pick the manager you think posts the top score this week. Bragging rights only.',
      instructions: 'Make your call before it locks. Everyone’s calls are shown once it locks.',
      submissionMode: 'app', status: 'open', locksAt: lockAt, lockAt,
      configJson: call as unknown as Prisma.InputJsonValue,
    },
    update: {},
  })
}

export type WeeklyCallSubmitResult = { ok: true; pick: WeeklyCallOption } | { ok: false; status: 400 | 403 | 404 | 409; error: string }

/** Make or change a call before it locks. Anyone in the cast may play, including managers who are out. */
export async function submitWeeklyCall(leagueId: string, userId: string, challengeId: string, optionId: string, now = new Date()): Promise<WeeklyCallSubmitResult> {
  const challenge = await prisma.survivorChallenge.findFirst({ where: { id: challengeId, leagueId, challengeType: WEEKLY_CALL_TYPE } })
  if (!challenge) return { ok: false, status: 404, error: 'That call was not found.' }
  const config = readConfig(challenge.configJson)
  const pick = config?.options.find(option => option.id === optionId)
  if (!config || !pick) return { ok: false, status: 400, error: 'Pick one of the listed options.' }
  const lock = challenge.locksAt ?? challenge.lockAt
  if (challenge.status !== 'open' || (lock && lock.getTime() <= now.getTime())) return { ok: false, status: 409, error: 'Calls are locked for this week.' }
  const player = await prisma.survivorPlayer.findFirst({ where: { leagueId, userId }, select: { userId: true } })
  if (!player) return { ok: false, status: 403, error: 'Only managers in this season can make a call.' }
  await prisma.survivorChallengeSubmission.upsert({
    where: { uniq_challenge_user: { challengeId, userId } },
    create: { challengeId, leagueId, userId, submission: { optionId } },
    update: { submission: { optionId }, submittedAt: now },
  })
  return { ok: true, pick }
}

/** Settle the week's call from the finalized scores. Idempotent; a missing call is a no-op. */
export async function settleWeeklyCall(leagueId: string, week: number): Promise<void> {
  const challenge = await prisma.survivorChallenge.findFirst({ where: { leagueId, week, challengeType: WEEKLY_CALL_TYPE } })
  if (!challenge || challenge.status === 'complete') return
  const config = readConfig(challenge.configJson)
  if (!config) return
  const active = await prisma.survivorPlayer.findMany({ where: { leagueId, playerState: 'active' }, select: { userId: true } })
  const scores = await prisma.survivorWeeklyScore.findMany({
    where: { leagueId, week, userId: { in: active.map(player => player.userId) } },
    select: { userId: true, tribeId: true, finalScore: true, isFinalized: true, countedTowardTribeTotal: true },
  })
  const winners = verifiedSlateWinners(scores)
  if (!winners) return
  const answerId = config.kind === 'top_tribe' ? winners.tribeId : winners.individualUserId
  if (!answerId) return
  const submissions = await prisma.survivorChallengeSubmission.findMany({ where: { challengeId: challenge.id }, select: { id: true, userId: true, submission: true } })
  const pickOf = (value: unknown) => (value && typeof value === 'object' ? (value as Record<string, unknown>).optionId : null)
  const correctUserIds = submissions.filter(row => pickOf(row.submission) === answerId).flatMap(row => row.userId ? [row.userId] : [])
  const answerLabel = config.options.find(option => option.id === answerId)?.label ?? null
  const now = new Date()
  await prisma.$transaction([
    ...submissions.map(row => prisma.survivorChallengeSubmission.update({
      where: { id: row.id },
      data: { isLocked: true, isCorrect: pickOf(row.submission) === answerId, pointsEarned: pickOf(row.submission) === answerId ? 1 : 0 },
    })),
    prisma.survivorChallenge.update({
      where: { id: challenge.id },
      data: {
        status: 'complete', closesAt: now,
        winnerUserIds: correctUserIds,
        resultJson: { answerId, answerLabel, callCount: submissions.length, correctCount: correctUserIds.length, settledAt: now.toISOString() } as Prisma.InputJsonValue,
        resultSummary: answerLabel
          ? `${answerLabel} ${config.kind === 'top_tribe' ? 'scored the most' : 'posted the top score'}. ${correctUserIds.length} of ${submissions.length} called it.`
          : `${correctUserIds.length} of ${submissions.length} called it.`,
      },
    }),
  ])
}

export type WeeklyCallView = {
  id: string
  week: number
  kind: WeeklyCallKind
  title: string
  description: string
  status: 'open' | 'locked' | 'complete'
  locksAt: string | null
  options: Array<WeeklyCallOption & { calls: number | null }>
  myPick: string | null
  answer: WeeklyCallOption | null
  /** Who called it right, named, once settled. */
  correct: string[]
  callCount: number
}

export type WeeklyCallBoard = { current: WeeklyCallView | null; past: WeeklyCallView[]; leaderboard: Array<{ userId: string; name: string; correct: number; calls: number }> }

/**
 * The calls for one viewer. Other managers' picks stay hidden until the call locks, then appear as
 * counts per option; names appear only for who called it right, once settled.
 */
export async function loadWeeklyCallBoard(leagueId: string, userId: string, now = new Date()): Promise<WeeklyCallBoard> {
  const challenges = await prisma.survivorChallenge.findMany({
    where: { leagueId, challengeType: WEEKLY_CALL_TYPE },
    orderBy: { week: 'desc' },
    take: 30,
    include: { submissions: { select: { userId: true, submission: true, isCorrect: true } } },
  })
  const players = await prisma.survivorPlayer.findMany({ where: { leagueId }, select: { userId: true, displayName: true } })
  const nameOf = new Map(players.map(player => [player.userId, player.displayName]))
  const pickOf = (value: unknown) => (value && typeof value === 'object' && typeof (value as Record<string, unknown>).optionId === 'string' ? (value as Record<string, string>).optionId : null)
  const views: WeeklyCallView[] = challenges.flatMap(challenge => {
    const config = readConfig(challenge.configJson)
    if (!config) return []
    const lock = challenge.locksAt ?? challenge.lockAt
    const status: WeeklyCallView['status'] = challenge.status === 'complete' ? 'complete' : lock && lock.getTime() <= now.getTime() ? 'locked' : 'open'
    const counts = new Map<string, number>()
    for (const row of challenge.submissions) { const pick = pickOf(row.submission); if (pick) counts.set(pick, (counts.get(pick) ?? 0) + 1) }
    const result = (challenge.resultJson ?? {}) as Record<string, unknown>
    const answerId = typeof result.answerId === 'string' ? result.answerId : null
    return [{
      id: challenge.id, week: challenge.week, kind: config.kind, title: challenge.title, description: challenge.description, status,
      locksAt: lock ? lock.toISOString() : null,
      options: config.options.map(option => ({ ...option, calls: status === 'open' ? null : counts.get(option.id) ?? 0 })),
      myPick: pickOf(challenge.submissions.find(row => row.userId === userId)?.submission),
      answer: status === 'complete' && answerId ? config.options.find(option => option.id === answerId) ?? { id: answerId, label: typeof result.answerLabel === 'string' ? result.answerLabel : 'Unknown' } : null,
      correct: status === 'complete' ? challenge.submissions.filter(row => row.isCorrect && row.userId).map(row => nameOf.get(row.userId!) ?? 'A manager') : [],
      callCount: challenge.submissions.length,
    }]
  })
  const tally = new Map<string, { correct: number; calls: number }>()
  for (const challenge of challenges) {
    if (challenge.status !== 'complete') continue
    for (const row of challenge.submissions) {
      if (!row.userId) continue
      const entry = tally.get(row.userId) ?? { correct: 0, calls: 0 }
      entry.calls += 1
      if (row.isCorrect) entry.correct += 1
      tally.set(row.userId, entry)
    }
  }
  const leaderboard = [...tally].map(([id, entry]) => ({ userId: id, name: nameOf.get(id) ?? 'A manager', ...entry }))
    .sort((a, b) => b.correct - a.correct || a.calls - b.calls || a.name.localeCompare(b.name))
  const current = views.find(view => view.status !== 'complete') ?? null
  return { current, past: views.filter(view => view !== current), leaderboard }
}
