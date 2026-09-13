/**
 * POST: Zombie Universe AI (promotion/relegation outlook, level storylines, etc.). PROMPT 355.
 * Deterministic context first; AI narrates only. No promotion/relegation decisions.
 * Gated by zombie_ai when subscription is enforced.
 *
 * Restored. From 2026-04-09 (7840b87f7) until this change the file held a copy of
 * /api/zombie/whisperer, so the universe AI panel's POST never reached this handler.
 *
 * Available to universe members. Each league's Whisperer is disguised, in the context sent to the
 * model and in the response, for a viewer who may not know it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildZombieUniverseAIContext } from '@/lib/zombie/ai/ZombieAIContext'
import type { ZombieUniverseAIType } from '@/lib/zombie/ai/ZombieAIContext'
import { generateZombieUniverseAI } from '@/lib/zombie/ai/ZombieAIService'
import {
  FeatureGateService,
  isFeatureGateAccessError,
} from '@/lib/subscription/FeatureGateService'
import { resolveZombieUniverseAccess } from '@/lib/zombie/zombieUniverseAccess'
import { redactUniverseRowsForViewer } from '@/lib/zombie/zombieUniverseWhisperer'

export const dynamic = 'force-dynamic'

const VALID_TYPES: ZombieUniverseAIType[] = [
  'promotion_relegation_outlook',
  'level_storylines',
  'top_survivor_runs',
  'fastest_spread_analysis',
  'league_health_summary',
  'commissioner_anomaly_summary',
]

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ universeId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = new FeatureGateService()
  try {
    await gate.assertUserHasFeature(userId, 'zombie_ai')
  } catch (error) {
    if (isFeatureGateAccessError(error)) {
      return NextResponse.json(
        {
          error: 'Premium feature',
          message: error.message,
          code: error.code,
          requiredPlan: error.requiredPlan,
          upgradePath: error.upgradePath,
        },
        { status: error.statusCode }
      )
    }
    throw error
  }

  const { universeId } = await ctx.params
  if (!universeId) return NextResponse.json({ error: 'Missing universeId' }, { status: 400 })

  const access = await resolveZombieUniverseAccess(universeId, userId)
  if (!access.exists) return NextResponse.json({ error: 'Universe not found' }, { status: 404 })
  if (!access.isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const type = (typeof body.type === 'string' ? body.type : 'promotion_relegation_outlook') as ZombieUniverseAIType
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Invalid type', validTypes: VALID_TYPES }, { status: 400 })
  }

  const built = await buildZombieUniverseAIContext({ universeId, userId })
  if (!built) {
    return NextResponse.json({ error: 'Could not build context' }, { status: 500 })
  }
  const deterministic = {
    ...built,
    standings: await redactUniverseRowsForViewer(built.standings, { userId, isOwner: access.isOwner }),
  }

  try {
    const { narrative, model } = await generateZombieUniverseAI(deterministic, type, userId)
    return NextResponse.json({
      deterministic: {
        universeId: deterministic.universeId,
        sport: deterministic.sport,
        standings: deterministic.standings.slice(0, 50),
        movementProjections: deterministic.movementProjections.slice(0, 30),
        rosterDisplayNames: deterministic.rosterDisplayNames,
      },
      narrative,
      model,
      type,
    })
  } catch (e) {
    console.error('[zombie-universe/ai]', e)
    return NextResponse.json(
      { error: 'AI generation failed', message: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
