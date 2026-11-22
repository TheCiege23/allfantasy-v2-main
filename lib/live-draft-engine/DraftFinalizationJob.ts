import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

const JOB_TYPE = 'draft_finalization'
const MAX_ATTEMPTS = 8
const RETRY_MS = 60_000
const LEASE_MS = 120_000

function key(sessionId: string, completedAt: Date) {
  return `${JOB_TYPE}:${sessionId}:${completedAt.getTime()}`
}

function due(now: Date) {
  return {
    jobType: JOB_TYPE,
    status: { in: ['pending', 'running'] },
    scheduledFor: { lte: now },
    attemptCount: { lt: MAX_ATTEMPTS },
  }
}

export async function queueDraftFinalization(
  tx: Prisma.TransactionClient, leagueId: string, sessionId: string, completedAt: Date,
) {
  const idempotencyKey = key(sessionId, completedAt)
  await tx.automationJob.create({
    data: {
      leagueId,
      jobType: JOB_TYPE,
      idempotencyKey,
      metadata: { sessionId, completedAt: completedAt.toISOString() },
      scheduledFor: new Date(),
      maxAttempts: MAX_ATTEMPTS,
    },
  })
  return idempotencyKey
}

export async function hasPendingDraftFinalization(sessionId: string, completedAt: Date): Promise<boolean> {
  const job = await prisma.automationJob.findUnique({
    where: { idempotencyKey: key(sessionId, completedAt) },
    select: { status: true },
  })
  return job?.status === 'pending' || job?.status === 'running'
}

async function processJob(idempotencyKey: string) {
  const startedAt = new Date()
  const claim = await prisma.automationJob.updateMany({
    where: { idempotencyKey, ...due(startedAt) },
    data: {
      status: 'running',
      startedAt,
      scheduledFor: new Date(startedAt.getTime() + LEASE_MS),
      attemptCount: { increment: 1 },
    },
  })
  if (!claim.count) return

  const job = await prisma.automationJob.findUniqueOrThrow({ where: { idempotencyKey } })
  const [, sessionId, completedAt] = idempotencyKey.split(':')
  const lease = { id: job.id, status: 'running', startedAt }
  try {
    const session = job.leagueId && await prisma.draftSession.findFirst({
      where: { leagueId: job.leagueId },
      orderBy: CURRENT_DRAFT_SESSION_ORDER,
      select: { id: true, status: true, completedAt: true },
    })
    if (!job.leagueId || !session || session.id !== sessionId || session.status !== 'completed' ||
      session.completedAt?.getTime() !== Number(completedAt)) {
      await prisma.automationJob.updateMany({ where: lease, data: { status: 'cancelled', finishedAt: new Date() } })
      return
    }
    const { finishDraftCompletion } = await import('./DraftSessionService')
    await finishDraftCompletion(job.leagueId, sessionId, true, { requireSeason: true })
    await prisma.automationJob.updateMany({ where: lease, data: { status: 'completed', finishedAt: new Date(), lastError: null } })
  } catch (error) {
    const exhausted = job.attemptCount >= job.maxAttempts
    const message = error instanceof Error ? error.message : String(error)
    await prisma.automationJob.updateMany({
      where: lease,
      data: {
        status: exhausted ? 'failed' : 'pending',
        scheduledFor: new Date(Date.now() + RETRY_MS),
        finishedAt: exhausted ? new Date() : null,
        lastError: message.slice(0, 1000),
      },
    })
    console.error('[draft finalization] job failed', { leagueId: job.leagueId, sessionId, error: message })
  }
}

export function processDraftFinalizationJob(idempotencyKey: string) {
  return processJob(idempotencyKey)
}

export async function processDueDraftFinalizations() {
  const jobs = await prisma.automationJob.findMany({
    where: due(new Date()),
    orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
    select: { idempotencyKey: true },
    take: 3,
  })
  await Promise.all(jobs.map(job => processJob(job.idempotencyKey)))
}
