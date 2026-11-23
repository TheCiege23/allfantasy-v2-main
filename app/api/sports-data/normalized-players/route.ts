/**
 * POST /api/sports-data/normalized-players
 * Body: { sport: string, playerNames: string[], leagueId?: string }
 * Returns the shared normalized sports data batch for AI tools (Rolling Insights → DB → ClearSports merge).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveNormalizedLeagueContext } from '@/lib/league-context-engine'
import type { NormalizedScoringRules } from '@/lib/league-context-engine/types'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { resolveNormalizedPlayerSportsProfiles } from '@/lib/sports-data-normalization'
import { afJson } from '@/lib/core-app/afIntelligenceGate'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { sport?: string; playerNames?: string[]; leagueId?: string | null }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const sport = normalizeToSupportedSport(String(body.sport ?? 'NFL'))
  const names = Array.isArray(body.playerNames)
    ? body.playerNames.map((n) => String(n).trim()).filter(Boolean).slice(0, 40)
    : []

  if (names.length === 0) {
    return NextResponse.json({ error: 'playerNames required' }, { status: 400 })
  }

  let leagueScoring: NormalizedScoringRules | null = null
  const leagueId = body.leagueId?.trim() || null
  if (leagueId) {
    const lc = await resolveNormalizedLeagueContext({ userId, leagueId })
    if (lc.ok) leagueScoring = lc.context.scoring
  }

  try {
    const batch = await resolveNormalizedPlayerSportsProfiles({
      prisma,
      sport,
      players: names.map((name) => ({ name })),
      leagueScoring,
    })
    return await afJson(userId, batch)
  } catch (e) {
    console.error('[sports-data/normalized-players]', e)
    return NextResponse.json({ error: 'Normalization failed' }, { status: 500 })
  }
}
