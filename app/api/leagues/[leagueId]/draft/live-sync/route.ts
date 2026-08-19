/**
 * GET: Combined draft live sync — authoritative session (when changed) + optional queue + chat.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withTimedRoute } from '@/lib/logging/withTimedRoute'
import { logStructured } from '@/lib/logging/structured'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { runAutomationTicksThrottled } from '@/lib/live-draft-engine/draftAutomationTicks'
import { buildDraftLiveSyncPayload } from '@/lib/draft-room/buildDraftLiveSyncPayload'

export const dynamic = 'force-dynamic'

export const GET = withTimedRoute('draft_live_sync', async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = req.nextUrl
  const since = url.searchParams.get('since') ?? undefined
  const includeQueue = url.searchParams.get('queue') !== '0'
  const includeChat = url.searchParams.get('chat') !== '0'
  const chatLimit = Math.min(Number(url.searchParams.get('chatLimit') || '80'), 100)

  try {
    await runAutomationTicksThrottled(leagueId)

    const payload = await buildDraftLiveSyncPayload(leagueId, userId, {
      since,
      includeQueue,
      includeChat,
      chatLimit,
    })

    return NextResponse.json(payload)
  } catch (error) {
    logStructured('error', 'draft_live_sync', 'request_failed', {
      leagueId,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({
      leagueId,
      updated: false,
      updatedAt: null,
      session: null,
      ...(includeQueue ? { queue: [] } : {}),
      ...(includeChat ? { messages: [], syncActive: false } : {}),
      degraded: true,
    })
  }
})
