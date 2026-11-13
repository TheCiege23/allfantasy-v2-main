import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { validateRequestOrigin, forbiddenResponse } from '@/lib/api-auth'
import { consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { z } from 'zod'
import { evaluateOutcome, batchEvaluateOutcomes } from '@/lib/decision-log'
import { prisma } from '@/lib/prisma'
import { requireAdminOrBearer } from '@/lib/adminAuth'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'

/*
 * Was gated only by `requireAuthOrOrigin`, which passes any anonymous caller that sends a
 * matching `Origin` header. That let anyone grade (and so write an outcome row onto) any
 * decision log by id, and run the GLOBAL batch evaluator — which walks every user's pending
 * logs — on demand.
 *
 *  - batch: a cross-user maintenance job, so it is admin / cron-bearer only.
 *  - single: the log must belong to the caller. `DecisionLog.userId` is a Sleeper username
 *    or Sleeper user id (see decision-log/route.ts), so ownership is checked against both.
 *    A log that is not theirs answers 404, the same as one that does not exist.
 */
async function callerOwnsDecisionLog(decisionLogId: string, sleeperUsername: string): Promise<boolean> {
  const [log, linked] = await Promise.all([
    prisma.decisionLog.findUnique({ where: { id: decisionLogId }, select: { userId: true } }),
    prisma.legacyUser
      .findUnique({ where: { sleeperUsername }, select: { sleeperUserId: true } })
      .catch(() => null),
  ])
  if (!log) return false
  const key = String(log.userId || '').trim()
  return (
    key.toLowerCase() === sleeperUsername.trim().toLowerCase() ||
    (!!linked?.sleeperUserId && key === linked.sleeperUserId.trim())
  )
}

const SingleEvalSchema = z.object({
  decisionLogId: z.guid(),
  evaluationWeeks: z.number().int().min(1).max(16).optional(),
})

const BatchEvalSchema = z.object({
  batch: z.literal(true),
  minAgeWeeks: z.number().int().min(1).max(16).optional(),
  limit: z.number().int().min(1).max(50).optional(),
})

const EvalSchema = z.union([SingleEvalSchema, BatchEvalSchema])

export const POST = withApiUsage({ endpoint: "/api/legacy/decision-log/evaluate", tool: "LegacyDecisionLogEvaluate" })(async (req: NextRequest) => {
  // CSRF protection for a state-changing call — legitimate, but NOT authentication.
  if (!validateRequestOrigin(req)) return forbiddenResponse('Invalid request origin')

  const ip = getClientIp(req)
  const rl = consumeRateLimit({
    scope: 'legacy',
    action: 'decision_evaluate',
    ip,
    maxRequests: 5,
    windowMs: 60_000,
    includeIpInKey: true,
  })
  if (!rl.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    )
  }

  try {
    const body = await req.json()
    const parsed = EvalSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 })
    }

    if ('batch' in parsed.data && parsed.data.batch) {
      const admin = await requireAdminOrBearer(req)
      if (!admin.ok) return admin.res
      const result = await batchEvaluateOutcomes(
        parsed.data.minAgeWeeks ?? 3,
        parsed.data.limit ?? 20
      )
      return NextResponse.json({ ok: true, ...result })
    }

    if ('decisionLogId' in parsed.data) {
      const gate = await requireLegacySleeperIdentity(req)
      if (!gate.ok) return gate.response
      if (!(await callerOwnsDecisionLog(parsed.data.decisionLogId, gate.identity.sleeperUsername))) {
        return NextResponse.json({ error: 'Decision log not found' }, { status: 404 })
      }
      const outcome = await evaluateOutcome({
        decisionLogId: parsed.data.decisionLogId,
        evaluationWeeks: parsed.data.evaluationWeeks,
      })
      return NextResponse.json({ ok: true, outcome })
    }

    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  } catch (err: any) {
    console.error('[DECISION-LOG] Evaluate error:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
})
