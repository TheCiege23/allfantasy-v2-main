/**
 * POST: Preview roster legality impact of proposed IDP config (before saving).
 * Commissioner only. Returns totalIdpSlots, slotCounts, warnings, errors.
 */

import { commissionerAccessResponse } from '@/lib/league/commissionerAccess'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isIdpLeague } from '@/lib/idp'
import { previewRosterImpact } from '@/lib/idp/IdpValidationService'
import type { IdpPositionMode, IdpRosterPreset, IdpSlotOverrides } from '@/lib/idp/types'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const refused = await commissionerAccessResponse(leagueId, session.user.id, 'view')
  if (refused) return refused
  const isIdp = await isIdpLeague(leagueId)
  if (!isIdp) return NextResponse.json({ error: 'Not an IDP league' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const proposed = {
    positionMode: typeof body.positionMode === 'string' ? (body.positionMode as IdpPositionMode) : undefined,
    rosterPreset: typeof body.rosterPreset === 'string' ? (body.rosterPreset as IdpRosterPreset) : undefined,
    slotOverrides: body.slotOverrides != null ? (body.slotOverrides as IdpSlotOverrides) : undefined,
  }
  const preview = await previewRosterImpact(leagueId, proposed)
  return NextResponse.json(preview)
}
