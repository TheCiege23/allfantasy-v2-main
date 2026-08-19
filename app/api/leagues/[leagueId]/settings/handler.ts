import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'

export const dynamic = 'force-dynamic'

const SECTIONS = new Set([
  'general',
  'scoring',
  'roster',
  'draft',
  'waivers',
  'trades',
  'playoffs',
  'commissioner',
  'conceptRules',
  'ai',
])

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * PATCH /api/leagues/:leagueId/settings
 * Body: { section, updates } — merges `updates` with `leagueId` and runs the same patch pipeline as POST /api/league/settings.
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ leagueId: string }> },
) {
  const { leagueId: rawId } = await context.params
  const leagueId = rawId?.trim()
  if (!leagueId) return jsonError('leagueId required', 400)

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return jsonError('Unauthorized', 401)

  let payload: {
    section?: string
    updates?: Record<string, unknown>
    scoringOverrideInPlayoffs?: boolean
  }
  try {
    payload = (await req.json()) as {
      section?: string
      updates?: Record<string, unknown>
      scoringOverrideInPlayoffs?: boolean
    }
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const section = typeof payload.section === 'string' ? payload.section : ''
  const updates =
    payload.updates && typeof payload.updates === 'object' && !Array.isArray(payload.updates)
      ? payload.updates
      : null

  if (!section || !SECTIONS.has(section)) {
    return jsonError('Invalid or missing section', 400)
  }
  if (!updates || Object.keys(updates).length === 0) {
    return jsonError('updates required', 400)
  }

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    include: { teams: true },
  })
  if (!league) return jsonError('League not found', 404)

  const teamCount = league.leagueSize ?? league.teams.length

  if (section === 'playoffs' && updates.playoffTeams != null) {
    const pt = Number(updates.playoffTeams)
    if (Number.isFinite(pt) && pt > Math.max(1, teamCount)) {
      return jsonError(`playoffTeams cannot exceed league size (${teamCount})`, 400)
    }
  }

  if (section === 'roster' && updates.rosterSize != null) {
    const rs = Number(updates.rosterSize)
    if (Number.isFinite(rs) && (rs < 10 || rs > 60)) {
      return jsonError('rosterSize out of allowed range', 400)
    }
  }

  const body = { leagueId, ...updates } as Record<string, unknown> & { leagueId: string }

  const res = await executeLeagueSettingsPatch(userId, body, {
    section,
    scoringOverrideInPlayoffs: Boolean(payload.scoringOverrideInPlayoffs),
  })
  const data = await res.json().catch(() => ({}))
  return NextResponse.json({ ...data, section }, { status: res.status })
}
