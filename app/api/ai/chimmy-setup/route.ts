import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'
import { assertLeagueAccess } from '@/lib/ai/league-settings-ai/access'
import { callClaudeJson } from '@/lib/ai/league-settings-ai/claude'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Plan gate before the model call: `commissioner_ai_tools` — the key the League Settings panel already shows
  // its upgrade prompt for (LEAGUE_SETTINGS_AI_PANEL_FEATURE).
  const gate = await requireFeatureEntitlement({ userId: userId, userEmail: (session?.user as { email?: string | null } | undefined)?.email ?? null, featureId: 'commissioner_ai_tools' })
  if (!gate.ok) return gate.response

  let body: { leagueId?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : ''
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })
  }

  const league = await assertLeagueAccess(leagueId, userId)
  if (!league) {
    return NextResponse.json({ error: 'League not found or forbidden' }, { status: 403 })
  }

  try {
    const system = `You are Chimmy configuring AI assistance for a fantasy league. Summarize how Chimmy should behave in this league (tone, data sources, commissioner boundaries). Respond with ONLY valid JSON (no markdown):
{"summary":string,"checklist":string[]}`

    const userPayload = `League: ${league.name ?? leagueId}\nSport: ${league.sport}\nPlatform: ${league.platform}\nSettings snapshot:\n${JSON.stringify(league.settings ?? {}, null, 2).slice(0, 8000)}`

    const raw = await callClaudeJson({ system, user: userPayload, userId })
    return NextResponse.json(raw)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Chimmy setup failed'
    console.error('[api/ai/chimmy-setup]', e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
