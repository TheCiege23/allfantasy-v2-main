import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { validateRequestOrigin, forbiddenResponse } from '@/lib/api-auth'
import { consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { z } from 'zod'
import { resolveDecision } from '@/lib/decision-log'
import { prisma } from '@/lib/prisma'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'

/*
 * Was gated only by `requireAuthOrOrigin` — an anonymous caller with a matching `Origin`
 * header could mark anyone's decision as followed/ignored by id. Now the log must belong to
 * the caller's own Sleeper identity (username, or Sleeper user id — the two keys the writers
 * use). Someone else's log answers 404, exactly like a missing one.
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

const ResolveSchema = z.object({
  decisionLogId: z.string().uuid(),
  userFollowed: z.boolean(),
  userAction: z.record(z.unknown()).optional(),
})

export const POST = withApiUsage({ endpoint: "/api/legacy/decision-log/resolve", tool: "LegacyDecisionLogResolve" })(async (req: NextRequest) => {
  // CSRF protection for a state-changing call — legitimate, but NOT authentication.
  if (!validateRequestOrigin(req)) return forbiddenResponse('Invalid request origin')

  const gate = await requireLegacySleeperIdentity(req)
  if (!gate.ok) return gate.response

  const ip = getClientIp(req)
  const rl = consumeRateLimit({
    scope: 'legacy',
    action: 'decision_resolve',
    ip,
    maxRequests: 30,
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
    const parsed = ResolveSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 })
    }

    if (!(await callerOwnsDecisionLog(parsed.data.decisionLogId, gate.identity.sleeperUsername))) {
      return NextResponse.json({ error: 'Decision log not found' }, { status: 404 })
    }

    const updated = await resolveDecision({
      decisionLogId: parsed.data.decisionLogId,
      userFollowed: parsed.data.userFollowed,
      userAction: parsed.data.userAction,
    })

    return NextResponse.json({ ok: true, id: updated.id, resolvedAt: updated.resolvedAt })
  } catch (err: any) {
    console.error('[DECISION-LOG] Resolve error:', err)
    if (err.code === 'P2025') {
      return NextResponse.json({ error: 'Decision log not found' }, { status: 404 })
    }
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
})
