import { isAcceptedCoOwnerForRedraftRoster } from '@/lib/team-coowners/access'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { legacyRedraftWaiverClaimsRetiredResponse } from '@/lib/redraft/legacyWaiverClaimsRetired'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const seasonId = req.nextUrl.searchParams?.get('seasonId')?.trim()
  const rosterId = req.nextUrl.searchParams?.get('rosterId')?.trim()
  if (!seasonId || !rosterId) {
    return NextResponse.json({ error: 'seasonId and rosterId required' }, { status: 400 })
  }

  const season = await prisma.redraftSeason.findFirst({ where: { id: seasonId } })
  if (!season) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const gate = await assertLeagueMember(season.leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const roster = await prisma.redraftRoster.findFirst({
    where: { id: rosterId, seasonId, leagueId: season.leagueId },
    select: { ownerId: true },
  })
  if (!roster) return NextResponse.json({ error: 'Roster not found' }, { status: 404 })
  if (roster.ownerId !== userId && !await isAcceptedCoOwnerForRedraftRoster(season.leagueId, rosterId, userId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const claims = await prisma.redraftWaiverClaim.findMany({
    where: { seasonId, rosterId },
    orderBy: { submittedAt: 'desc' },
  })

  return NextResponse.json({ claims })
}

/**
 * Retired 2026-11-26: claims go through the main waiver system now (lib/redraft/legacyWaiverClaimsRetired.ts).
 * GET still lists a roster's old claims and DELETE still cancels a pending one, so nothing already queued is stuck.
 */
export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { leagueId?: string } | null
  return legacyRedraftWaiverClaimsRetiredResponse(body?.leagueId ?? null)
}

export async function DELETE(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { claimId?: string; rosterId?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const claimId = body.claimId?.trim()
  const rosterId = body.rosterId?.trim()
  if (!claimId || !rosterId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const c = await prisma.redraftWaiverClaim.findFirst({ where: { id: claimId, rosterId } })
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const roster = await prisma.redraftRoster.findFirst({
    where: { id: rosterId, seasonId: c.seasonId, leagueId: c.leagueId },
    select: { ownerId: true },
  })
  if (!roster) return NextResponse.json({ error: 'Roster not found' }, { status: 404 })
  if (roster.ownerId !== userId && !await isAcceptedCoOwnerForRedraftRoster(c.leagueId, rosterId, userId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (c.status !== 'pending') return NextResponse.json({ error: 'Only pending claims can be cancelled' }, { status: 409 })

  await prisma.redraftWaiverClaim.update({
    where: { id: claimId },
    data: { status: 'cancelled' },
  })

  return NextResponse.json({ ok: true })
}
