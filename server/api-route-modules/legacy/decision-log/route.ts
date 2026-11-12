import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { validateRequestOrigin, forbiddenResponse } from '@/lib/api-auth'
import { consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { z } from 'zod'
import {
  logDecision,
  getDecisionSummary,
  getDecisionLogsForCoach,
  getUnresolvedDecisions,
  DecisionType,
  RiskProfile,
} from '@/lib/decision-log'
import { prisma } from '@/lib/prisma'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'

/*
 * 🛑 THIS ROUTE USED `requireAuthOrOrigin` AS ITS ONLY GATE and then read or wrote the
 * decision log of whatever `userId` the caller named. That helper returns
 * `{ authenticated: true }` for an anonymous caller whose `Origin` header matches — a header
 * curl sets in one flag — so `GET ?userId=<victim>&view=coach` returned anyone's history and
 * POST wrote into anyone's log.
 *
 * `DecisionLog.userId` is a Sleeper identity, not an AppUser id: the writers key it on the
 * Sleeper USERNAME (trade/analyze, proposal-generator, ai-coach) or, from waiver/analyze, the
 * Sleeper USER ID when the client supplied one. So identity resolves through the shared
 * legacy gate, and the caller's `userId` is accepted only when it is one of the caller's OWN
 * two keys — anything else is a visible 403, never a silent swap to someone else's view.
 */
async function ownDecisionKeyMatcher(sleeperUsername: string): Promise<(key: string) => boolean> {
  const linked = await prisma.legacyUser
    .findUnique({ where: { sleeperUsername }, select: { sleeperUserId: true } })
    .catch(() => null)
  const username = sleeperUsername.trim().toLowerCase()
  const sleeperUserId = linked?.sleeperUserId?.trim() || null
  return (key: string) => {
    const k = key.trim()
    return k.toLowerCase() === username || (sleeperUserId != null && k === sleeperUserId)
  }
}

function notYourDecisionLog() {
  return NextResponse.json(
    { error: 'You can only access your own decision log.', code: 'DECISION_LOG_USER_MISMATCH' },
    { status: 403 },
  )
}

const LogSchema = z.object({
  userId: z.string().min(1),
  leagueId: z.string().min(1),
  decisionType: z.enum(['trade', 'waiver', 'sit_start', 'trade_proposal', 'trade_finder']),
  aiRecommendation: z.record(z.unknown()),
  confidenceScore: z.number().min(0).max(1),
  riskProfile: z.enum(['low', 'moderate', 'high', 'extreme']),
  contextSnapshot: z.record(z.unknown()).optional(),
  expiresAt: z.string().datetime().optional(),
})

export const POST = withApiUsage({ endpoint: "/api/legacy/decision-log", tool: "LegacyDecisionLog" })(async (req: NextRequest) => {
  // CSRF protection for a state-changing call — legitimate here, but NOT authentication.
  if (!validateRequestOrigin(req)) return forbiddenResponse('Invalid request origin')

  const gate = await requireLegacySleeperIdentity(req)
  if (!gate.ok) return gate.response

  const ip = getClientIp(req)
  const rl = consumeRateLimit({
    scope: 'legacy',
    action: 'decision_log',
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
    const parsed = LogSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 })
    }

    const isOwnKey = await ownDecisionKeyMatcher(gate.identity.sleeperUsername)
    if (!isOwnKey(parsed.data.userId)) return notYourDecisionLog()

    const entry = await logDecision({
      userId: parsed.data.userId,
      leagueId: parsed.data.leagueId,
      decisionType: parsed.data.decisionType as DecisionType,
      aiRecommendation: parsed.data.aiRecommendation,
      confidenceScore: parsed.data.confidenceScore,
      riskProfile: parsed.data.riskProfile as RiskProfile,
      contextSnapshot: parsed.data.contextSnapshot,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined,
    })

    return NextResponse.json({ ok: true, id: entry.id })
  } catch (err: any) {
    console.error('[DECISION-LOG] POST error:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
})

export const GET = withApiUsage({ endpoint: "/api/legacy/decision-log", tool: "LegacyDecisionLog" })(async (req: NextRequest) => {
  const gate = await requireLegacySleeperIdentity(req)
  if (!gate.ok) return gate.response

  const { searchParams } = new URL(req.url)
  const userId = searchParams?.get('userId')
  const leagueId = searchParams?.get('leagueId') || undefined
  const view = searchParams?.get('view') || 'list'
  const limit = Math.min(100, Math.max(1, parseInt(searchParams?.get('limit') || '20', 10)))

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
  }

  // Compared, never trusted: the key must be one of the caller's own.
  const isOwnKey = await ownDecisionKeyMatcher(gate.identity.sleeperUsername)
  if (!isOwnKey(userId)) return notYourDecisionLog()

  try {
    if (view === 'summary') {
      const summary = await getDecisionSummary(userId, leagueId)
      return NextResponse.json({ ok: true, summary })
    }

    if (view === 'coach') {
      const coachData = await getDecisionLogsForCoach(userId, limit)
      return NextResponse.json({ ok: true, decisions: coachData })
    }

    if (view === 'unresolved') {
      const unresolved = await getUnresolvedDecisions(userId, leagueId)
      return NextResponse.json({ ok: true, decisions: unresolved })
    }

    const logs = await prisma.decisionLog.findMany({
      where: {
        userId,
        ...(leagueId ? { leagueId } : {}),
      },
      include: { outcome: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return NextResponse.json({ ok: true, decisions: logs })
  } catch (err: any) {
    console.error('[DECISION-LOG] GET error:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
})
