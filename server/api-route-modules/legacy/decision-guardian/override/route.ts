import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { validateRequestOrigin, forbiddenResponse } from '@/lib/api-auth'
import { resolveGuardianIntervention, getGuardianStats } from '@/lib/analytics/decision-guardian'
import { prisma } from '@/lib/prisma'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'

const resolveSchema = z.object({
  action: z.literal('resolve'),
  interventionId: z.string().uuid(),
  userDecision: z.enum(['proceed', 'cancel']),
  overrideReason: z.string().max(500).optional(),
})

const statsSchema = z.object({
  action: z.literal('stats'),
  userId: z.string(),
  leagueId: z.string().optional(),
})

const requestSchema = z.discriminatedUnion('action', [resolveSchema, statsSchema])

export const POST = withApiUsage({ endpoint: "/api/legacy/decision-guardian/override", tool: "LegacyDecisionGuardianOverride" })(async (req: NextRequest) => {
  /*
   * Was `requireAuthOrOrigin` alone — it passes an anonymous caller with a matching `Origin`
   * header — so anyone could resolve anyone's intervention by id and read anyone's guardian
   * stats by naming them. The origin check stays as CSRF protection; identity now comes from
   * the shared legacy gate, and `GuardianIntervention.userId` is the Sleeper username the
   * evaluate route logged it under.
   */
  if (!validateRequestOrigin(req)) return forbiddenResponse('Invalid request origin')

  try {
    const body = await req.json()
    const parsed = requestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    if (parsed.data.action === 'resolve') {
      const gate = await requireLegacySleeperIdentity(req, { allowGuest: true })
      if (!gate.ok) return gate.response
      const owned = await prisma.guardianIntervention.findUnique({
        where: { id: parsed.data.interventionId },
        select: { userId: true },
      })
      if (!owned || owned.userId.trim().toLowerCase() !== gate.identity.sleeperUsername.toLowerCase()) {
        // Someone else's intervention reads exactly like a missing one.
        return NextResponse.json({ error: 'Intervention not found' }, { status: 404 })
      }
      const result = await resolveGuardianIntervention(
        parsed.data.interventionId,
        parsed.data.userDecision,
        parsed.data.overrideReason
      )

      return NextResponse.json({
        success: true,
        intervention: {
          id: result.id,
          userDecision: result.userDecision,
          overrideReason: result.overrideReason,
        },
      })
    }

    if (parsed.data.action === 'stats') {
      const gate = await requireLegacySleeperIdentity(req, {
        allowGuest: true,
        requestedUsername: parsed.data.userId,
      })
      if (!gate.ok) return gate.response
      const stats = await getGuardianStats(gate.identity.sleeperUsername, parsed.data.leagueId)
      return NextResponse.json({ success: true, stats })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err: any) {
    console.error('[GUARDIAN] Override error:', err)
    return NextResponse.json(
      { error: 'Guardian override failed' },
      { status: 500 }
    )
  }
})
