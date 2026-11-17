/**
 * GET: Zombie league config. PROMPT 353.
 *
 * 🛑 THERE IS NO PUT HERE ANY MORE (2026-11-15). It let any MEMBER of the league — `canAccessLeagueDraft` admits
 * every manager with a team — rewrite the competitive rules (serum, weapons, ambush, infection, no-waiver) with no
 * validation, past the season lock and the NFL 2025 locks. No screen called it. Commissioners edit the rules through
 * `PATCH /api/zombie/settings`, which checks the commissioner and enforces every lock. Reading stays open to members.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import {
  isZombieLeague,
  getZombieLeagueConfig,
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
