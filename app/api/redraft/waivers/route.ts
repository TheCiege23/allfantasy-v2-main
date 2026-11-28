import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { legacyRedraftWaiverClaimsRetiredResponse } from '@/lib/redraft/legacyWaiverClaimsRetired'

export const dynamic = 'force-dynamic'

/**
 * Retired 2026-11-26. This listed, created and cancelled claims in `redraft_waiver_claims`, which a production
 * count found empty; claims go through the main waiver system (lib/redraft/legacyWaiverClaimsRetired.ts) and
 * the redraft Waivers screen no longer reads from here. Every method refuses with 410 and points there.
 */
async function refuse(leagueId: string | null) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return legacyRedraftWaiverClaimsRetiredResponse(leagueId)
}

async function leagueIdFromBody(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { leagueId?: string } | null
  return body?.leagueId ?? null
}

export async function GET(req: NextRequest) {
  return refuse(req.nextUrl.searchParams.get('leagueId'))
}

export async function POST(req: NextRequest) {
  return refuse(await leagueIdFromBody(req))
}

export async function DELETE(req: NextRequest) {
  return refuse(await leagueIdFromBody(req))
}
