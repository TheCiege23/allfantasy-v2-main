/**
 * GET/PUT: Zombie league config. PROMPT 353.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { specialtySettingsEditRefusal } from '@/lib/league/specialty-settings-access'
import {
  isZombieLeague,
  getZombieLeagueConfig,
  upsertZombieLeagueConfig,
} from '@/lib/zombie/ZombieLeagueConfig'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, session.user.id)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isZombie = await isZombieLeague(leagueId)
  if (!isZombie) return NextResponse.json({ error: 'Not a zombie league' }, { status: 404 })

  const config = await getZombieLeagueConfig(leagueId)
  if (!config) return NextResponse.json({ error: 'Config not found' }, { status: 500 })

  return NextResponse.json(config)
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  // Writes are commish / co-commish only, and specialty settings are AF Commish (or a token unlock).
  // This used to admit any league member via canAccessLeagueDraft — the READ rule, not a write rule.
  const refusal = await specialtySettingsEditRefusal(leagueId, session.user.id)
  if (refusal) return refusal

  const body = await req.json().catch(() => ({}))
  const config = await upsertZombieLeagueConfig(leagueId, body)
  if (!config) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  return NextResponse.json(config)
}
