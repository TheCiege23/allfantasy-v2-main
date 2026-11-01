/**
 * List / unlist a league on public discovery ("League finder") with rank-matched tiers:
 * commissioner’s current career tier ±1 (stored as the league’s `requiredCareerTier`).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireCommissionerRole } from '@/lib/league/permissions'
import { ensureUserCareerTier, clampCareerTier, getCareerTierName } from '@/lib/ranking/tier-visibility'
import { RANK_LEVELS } from '@/lib/rank/levels'
import type { Prisma } from '@prisma/client'
import { countSeatsHeldByPeople } from '@/lib/league/leagueSeats'
import { isFantasyLeagueDiscoverable } from '@/lib/public-discovery/DiscoveryQueryLayer'

export const dynamic = 'force-dynamic'

const RECRUITMENT_ROSTER_ID = 'league_finder_invite'

function toSettingsRecord(settings: unknown): Record<string, unknown> {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {}
  return settings as Record<string, unknown>
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    await requireCommissionerRole(leagueId, userId)
  } catch (e) {
    if (e instanceof Response) return e
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [listing, league, seatsHeld] = await Promise.all([
    prisma.findLeagueListing.findFirst({
      where: { leagueId, rosterId: RECRUITMENT_ROSTER_ID, isActive: true },
      select: { id: true, updatedAt: true },
    }),
    prisma.league.findFirst({
      where: { id: leagueId },
      select: { settings: true, leagueSize: true },
    }),
    countSeatsHeldByPeople(prisma as unknown as Prisma.TransactionClient, leagueId),
  ])
  const leagueSize = Math.max(0, Number(league?.leagueSize ?? 0) || 0)

  const settings = toSettingsRecord(league?.settings)
  const inviteCode = String(settings.inviteCode ?? '').trim()
  const tierRaw = settings.requiredCareerTier
  const careerTier = typeof tierRaw === 'number' && Number.isFinite(tierRaw) ? clampCareerTier(tierRaw) : null

  return NextResponse.json({
    // What discovery actually shows, not whether a listing row exists: discovery reads the
    // league's own settings (isFantasyLeagueDiscoverable), and a league created Public in the
    // wizard is listed without ever having a row here.
    listed: isFantasyLeagueDiscoverable(settings),
    listingRowActive: Boolean(listing),
    careerTier,
    careerTierName: careerTier != null ? getCareerTierName(careerTier) : null,
    inviteReady: inviteCode.length > 0,
    updatedAt: listing?.updatedAt?.toISOString() ?? null,
    // What a commissioner needs to decide whether to list: seats held by real people (not
    // rosters — a native league has one roster per seat from creation) against the size.
    leagueSize,
    seatsHeld,
    openSeats: Math.max(0, leagueSize - seatsHeld),
  })
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    await requireCommissionerRole(leagueId, userId, 'league')
  } catch (e) {
    if (e instanceof Response) return e
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { id: true, name: true, sport: true, settings: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  const prev = toSettingsRecord(league.settings)
  const inviteCode = String(prev.inviteCode ?? '').trim()
  if (!inviteCode) {
    return NextResponse.json(
      { error: 'Add an invite link in league settings before listing in League finder.' },
      { status: 400 },
    )
  }

  const profile = await ensureUserCareerTier(prisma, userId)
  const careerTier = clampCareerTier(profile.careerTier)
  const maxTier = Math.max(1, RANK_LEVELS.length)
  const bandLow = Math.max(1, careerTier - 1)
  const bandHigh = Math.min(maxTier, careerTier + 1)

  const merged: Record<string, unknown> = {
    ...prev,
    league_privacy_visibility: 'public',
    publicDashboard: true,
    league_allow_invite_link:
      typeof prev.league_allow_invite_link === 'boolean' ? prev.league_allow_invite_link : true,
    allow_invite_link:
      typeof prev.allow_invite_link === 'boolean' ? prev.allow_invite_link : true,
    requiredCareerTier: careerTier,
    leagueFinderListedAt: new Date().toISOString(),
  }

  const headline = league.name?.trim() ? `Join ${league.name}` : 'League recruiting'
  const body = `Rank-matched listing: open to tiers ${bandLow}–${bandHigh} (center tier ${careerTier} — ${getCareerTierName(careerTier)}).`

  await prisma.$transaction([
    prisma.league.update({
      where: { id: leagueId },
      data: { settings: merged as Prisma.InputJsonValue },
    }),
    prisma.findLeagueListing.upsert({
      where: { leagueId_rosterId: { leagueId, rosterId: RECRUITMENT_ROSTER_ID } },
      create: {
        leagueId,
        rosterId: RECRUITMENT_ROSTER_ID,
        headline,
        body,
        sport: league.sport,
        isActive: true,
      },
      update: {
        headline,
        body,
        isActive: true,
        sport: league.sport,
      },
    }),
  ])

  return NextResponse.json({
    ok: true,
    careerTier,
    careerTierName: getCareerTierName(careerTier),
    tierBand: { low: bandLow, high: bandHigh, center: careerTier },
  })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    await requireCommissionerRole(leagueId, userId, 'league')
  } catch (e) {
    if (e instanceof Response) return e
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await prisma.findLeagueListing.updateMany({
    where: { leagueId, rosterId: RECRUITMENT_ROSTER_ID },
    data: { isActive: false },
  })

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { settings: true },
  })
  const prev = toSettingsRecord(league?.settings)
  /*
   * ⚠ UNLISTING USED TO LEAVE THE LEAGUE LISTED. It only deactivated the listing row, which
   * discovery never reads; discovery reads `league_privacy_visibility` / `publicDashboard`, and
   * POST had set both. So "Remove from league finder" changed nothing anyone could see.
   * Both are turned off here, because either one alone keeps the league discoverable.
   */
  const merged = {
    ...prev,
    league_privacy_visibility: 'private',
    publicDashboard: false,
    leagueFinderDelistedAt: new Date().toISOString(),
  }
  await prisma.league.update({
    where: { id: leagueId },
    data: { settings: merged as Prisma.InputJsonValue },
  })

  return NextResponse.json({ ok: true })
}
