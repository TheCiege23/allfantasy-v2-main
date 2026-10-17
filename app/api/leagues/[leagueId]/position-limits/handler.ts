/**
 * GET /api/leagues/[leagueId]/position-limits — what the commish's Position Limits editor needs:
 * the positions this league's roster template uses, the current limits, and for each position the
 * most any one team rosters right now (so a commish sees who a new limit would leave over it).
 *
 * Saving is the shared settings patch (`{ positionLimits }` in the roster section). Enforcement is
 * lib/league/positionLimitsServer.ts, on AllFantasy-hosted leagues only: an imported league's rules
 * are its host's, so `enforced` is false there and the editor says so.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLeagueRole, isCommissionerRole } from '@/lib/league/permissions'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { getRosterTemplateForLeague } from '@/lib/multi-sport/MultiSportRosterService'
import { getFormatTypeForVariant } from '@/lib/sport-defaults/LeagueVariantRegistry'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { countPositions, normalizeLimitPosition, readPositionLimits } from '@/lib/league/positionLimits'
import { resolvePlayerPositions } from '@/lib/league/positionLimitsServer'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }

/** Real player positions named by the template, in template order; wildcards and flex groups add none. */
export function templatePositions(slots: Array<{ allowedPositions?: string[]; slotOrder?: number }>): string[] {
  const out: string[] = []
  for (const slot of [...slots].sort((a, b) => (a.slotOrder ?? 0) - (b.slotOrder ?? 0))) {
    for (const raw of slot.allowedPositions ?? []) {
      const p = normalizeLimitPosition(raw)
      if (p && p !== '*' && !out.includes(p)) out.push(p)
    }
  }
  return out
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = ((await ctx.params)?.leagueId ?? '').trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  if (!isCommissionerRole(await getLeagueRole(leagueId, userId))) {
    return NextResponse.json({ error: 'Only the commish or a co-commish can edit position limits.' }, { status: 403 })
  }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { platform: true, sport: true, leagueVariant: true, settings: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  const sport = String(league.sport ?? 'NFL')
  const limits = readPositionLimits(league.settings)

  let positions: string[] = []
  try {
    const template = await getRosterTemplateForLeague(sport as never, getFormatTypeForVariant(sport, league.leagueVariant ?? undefined), leagueId)
    positions = templatePositions(template.slots)
  } catch {
    positions = []
  }
  // A limit on a position the template no longer lists stays visible, so it can be cleared.
  for (const p of Object.keys(limits)) if (!positions.includes(p)) positions.push(p)

  const rosters = await prisma.roster.findMany({ where: { leagueId }, select: { playerData: true } })
  const ids = rosters.map((r) => getRosterPlayerIds(r.playerData))
  const positionOf = await resolvePlayerPositions({ leagueId, sport, playerIds: ids.flat() })
  const highest: Record<string, number> = {}
  for (const team of ids) {
    for (const [p, n] of countPositions(team.map((id) => positionOf.get(id) ?? null))) {
      highest[p] = Math.max(highest[p] ?? 0, n)
    }
  }

  return NextResponse.json({
    enforced: resolveWriteAuthority(league.platform) === 'NATIVE',
    positions,
    limits,
    highest,
  })
}
