/**
 * Automation presets (lib/commissioner-hub/automationPreset.ts) — commissioner / co-commissioner.
 *
 *   GET   ?preset=recommended|run_it|hands_on   what saving it would change, and what needs AF Commissioner
 *   POST  { preset }                            apply it
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isAutomationPreset } from '@/lib/commissioner-hub/automationPreset'
import { applyAutomationPreset, previewAutomationPreset } from '@/lib/commissioner-hub/automationPresetService'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }

async function sessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const preset = new URL(req.url).searchParams.get('preset')
  if (!isAutomationPreset(preset)) return NextResponse.json({ error: 'preset: recommended, run_it or hands_on' }, { status: 400 })
  const r = await previewAutomationPreset(leagueId, userId, preset)
  return r.ok ? NextResponse.json(r.plan, { headers: { 'Cache-Control': 'private, no-store' } }) : NextResponse.json({ error: r.error }, { status: r.status })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { preset?: unknown } | null
  if (!isAutomationPreset(body?.preset)) return NextResponse.json({ error: 'preset: recommended, run_it or hands_on' }, { status: 400 })
  const r = await applyAutomationPreset(leagueId, userId, body.preset)
  return r.ok ? NextResponse.json(r.plan) : NextResponse.json({ error: r.error }, { status: r.status })
}
