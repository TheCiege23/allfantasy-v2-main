import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { runDraftWarRoom, WarRoomInputSchema } from '@/lib/draft-war-room'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'

// AF War Room is available to AF Pro (pro_draft_ai) or AF War Room subscribers
// (war_room_draft_strategy). Check both; grant access if either resolves.
// TODO: add a dedicated 'draft_war_room' SubscriptionFeatureId when the
// feature catalog is extended beyond pro_draft_ai / war_room_draft_strategy.
const WAR_ROOM_FEATURES = ['pro_draft_ai', 'war_room_draft_strategy'] as const

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

    const userId = session.user.id
    const resolver = new EntitlementResolver()
    const [proDraftAi, warRoomStrategy] = await Promise.all(
      WAR_ROOM_FEATURES.map((f) => resolver.resolveForUser(userId, f)),
    )
    if (!proDraftAi.hasAccess && !warRoomStrategy.hasAccess) {
      return NextResponse.json(
        {
          error: 'AF War Room access required. Upgrade to AF Pro or AF War Room to use Draft War Room.',
          locked: true,
        },
        { status: 403 },
      )
    }

    const body = await request.json()
    const parsed = WarRoomInputSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 })
    const result = runDraftWarRoom(parsed.data)
    return NextResponse.json({ data: result })
  } catch (err: any) {
    console.error('[draft-war-room] POST error:', err?.message)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
