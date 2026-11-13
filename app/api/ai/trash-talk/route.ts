import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'
import { callClaudeJson } from '@/lib/ai/league-settings-ai/claude'

export const dynamic = 'force-dynamic'

const INTENSITIES = new Set(['mild', 'medium', 'savage'])

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Plan gate before the model call: `pro_start_sit` — the key the League Settings panel already shows
  // its upgrade prompt for (LEAGUE_SETTINGS_AI_PANEL_FEATURE).
  const gate = await requireFeatureEntitlement({ userId: session.user.id, userEmail: (session?.user as { email?: string | null } | undefined)?.email ?? null, featureId: 'pro_start_sit' })
  if (!gate.ok) return gate.response

  let body: {
    targetDisplayName?: string
    recentPerformance?: string
    intensity?: string
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const name = typeof body.targetDisplayName === 'string' ? body.targetDisplayName.trim() : ''
  if (!name) {
    return NextResponse.json({ error: 'targetDisplayName is required' }, { status: 400 })
  }

  const intensity = typeof body.intensity === 'string' ? body.intensity.trim().toLowerCase() : 'medium'
  if (!INTENSITIES.has(intensity)) {
    return NextResponse.json({ error: 'intensity must be mild, medium, or savage' }, { status: 400 })
  }

  const perf = typeof body.recentPerformance === 'string' ? body.recentPerformance.trim() : ''

  try {
    const system = `You are Chimmy, AllFantasy's playful banter bot. Produce league-safe trash talk: no slurs, no harassment, no real-world protected traits, keep it fantasy-football/sports focused. Respond with ONLY valid JSON (no markdown):
{"lines":string[]}
Provide 2-4 short lines. Intensity guides tone: mild = light teasing; medium = sharper but still good-natured; savage = maximum edge while staying within platform rules.`

    const userPayload = `Target manager display name: ${name}\nRecent performance summary:\n${perf || '(not provided)'}\nIntensity: ${intensity}`

    const raw = await callClaudeJson({ system, user: userPayload, userId: session.user.id })
    return NextResponse.json(raw)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Trash talk failed'
    console.error('[api/ai/trash-talk]', e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
