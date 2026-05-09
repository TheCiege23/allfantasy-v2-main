/**
 * POST: Set the current user's personal auto-pick preference for this league's draft session.
 *
 * Writes to the canonical LiveDraftAutopickPreference table (not legacy DraftAutopickSetting).
 * A user can only read/write their own preference — no body userId accepted.
 * AF Pro gating: mode="ai_queue" requires the pro_draft_ai entitlement.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import {
  setViewerAutopickPreference,
} from '@/lib/live-draft-engine/LiveDraftAutopickPreferenceService'

export const dynamic = 'force-dynamic'

const VALID_MODES = new Set(['standard', 'ai_queue'])

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const draftSession = await prisma.draftSession.findUnique({
    where: { leagueId },
    select: { id: true },
  })
  if (!draftSession) return NextResponse.json({ error: 'No draft session found' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as Record<string, unknown>

  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: '"enabled" (boolean) is required' }, { status: 400 })
  }
  const enabled: boolean = body.enabled

  const rawMode = body.mode
  if (rawMode !== undefined && !VALID_MODES.has(rawMode as string)) {
    return NextResponse.json(
      { error: `Invalid mode "${rawMode}". Allowed values: standard, ai_queue` },
      { status: 400 }
    )
  }
  const mode = (rawMode as 'standard' | 'ai_queue' | undefined) ?? 'standard'

  // AF Pro gate: non-Pro users may not write mode="ai_queue" (no silent downgrade on write).
  if (enabled && mode === 'ai_queue') {
    const { hasAccess } = await new EntitlementResolver().resolveForUser(userId, 'pro_draft_ai')
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'AF Pro required to enable AI queue auto-pick.' },
        { status: 403 }
      )
    }
  }

  const viewerAutopick = await setViewerAutopickPreference({
    draftSessionId: draftSession.id,
    viewerUserId: userId,
    enabled,
    mode: enabled ? mode : undefined,
  })

  return NextResponse.json({ viewerAutopick })
}
