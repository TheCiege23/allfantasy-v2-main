/**
 * Deadline autopilot (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3.5) — commissioner / co-commissioner only.
 *
 *   GET   the league's upcoming deadlines, who each one would remind, and the switch state
 *   PUT   { enabled?, custom? }  save the switch and the commissioner's own deadlines.
 *         Turning the switch ON needs the Commissioner plan (402); the list and OFF are free.
 *   POST  { action: 'remind_now', key }  Free: send one reminder by hand (once per 6 h per deadline)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getLeagueRole } from '@/lib/league/permissions'
import { readAutopilotView, saveAutopilotSettings, sendManualReminder } from '@/lib/deadline-autopilot/autopilotService'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> }

async function gate(ctx: Ctx) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  const { leagueId } = await ctx.params
  const role = await getLeagueRole(leagueId, userId)
  if (role === null) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) } as const
  if (role !== 'commissioner' && role !== 'co_commissioner') {
    return { error: NextResponse.json({ error: 'Commissioner only' }, { status: 403 }) } as const
  }
  return { leagueId } as const
}

const SAVE_STATUS = { too_many: 400, label_required: 400, invalid_time: 400, not_entitled: 402, not_found: 404 } as const
const MANUAL_STATUS = { not_found: 404, cooldown: 429, no_recipients: 409 } as const

export async function GET(_req: NextRequest, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const view = await readAutopilotView(g.leagueId)
  if (!view) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(view)
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const result = await saveAutopilotSettings(g.leagueId, { enabled: body.enabled, custom: body.custom })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: SAVE_STATUS[result.error] })
  return NextResponse.json(await readAutopilotView(g.leagueId))
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  if (body.action !== 'remind_now' || typeof body.key !== 'string') {
    return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
  }
  const result = await sendManualReminder(g.leagueId, body.key)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: MANUAL_STATUS[result.error] })
  return NextResponse.json({ sent: result.recipients })
}
