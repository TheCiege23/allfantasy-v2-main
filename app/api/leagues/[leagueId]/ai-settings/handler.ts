/**
 * GET: League AI feature toggles (any member can read).
 * PATCH: Update AI feature toggles (commissioner only).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { assertCommissioner, isCommissioner } from '@/lib/commissioner/permissions'
import { getLeagueAISettings, updateLeagueAISettings } from '@/lib/ai-settings'
import type { LeagueAISettings } from '@/lib/ai-settings'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const [settings, commissioner] = await Promise.all([
      getLeagueAISettings(leagueId),
      isCommissioner(leagueId, userId),
    ])
    return NextResponse.json({
      settings,
      isCommissioner: !!commissioner,
    })
  } catch (e) {
    console.error('[ai-settings GET]', e)
    return NextResponse.json({ error: 'Failed to load AI settings' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    await assertCommissioner(leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const patch: Partial<LeagueAISettings> = {}
  const keys: (keyof LeagueAISettings)[] = [
    'tradeAnalyzerEnabled',
    'waiverAiEnabled',
    'draftAssistantEnabled',
    'playerComparisonEnabled',
    'matchupSimulatorEnabled',
    'fantasyCoachEnabled',
    'aiChatChimmyEnabled',
    'aiDraftManagerOrphanEnabled',
  ]
  for (const key of keys) {
    if (typeof body[key] === 'boolean') patch[key] = body[key]
  }
  if (Object.keys(patch).length === 0) {
    const current = await getLeagueAISettings(leagueId)
    return NextResponse.json({ settings: current, isCommissioner: true })
  }

  try {
    const settings = await updateLeagueAISettings(leagueId, patch)
    return NextResponse.json({ settings, isCommissioner: true })
  } catch (e) {
    console.error('[ai-settings PATCH]', e)
    return NextResponse.json({ error: (e as Error).message ?? 'Failed to update AI settings' }, { status: 500 })
  }
}
