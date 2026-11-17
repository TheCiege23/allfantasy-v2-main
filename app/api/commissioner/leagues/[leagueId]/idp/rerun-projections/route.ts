/**
 * POST: Trigger IDP player projection sync for the league (or global).
 * Commissioner only. Delegates to projection sync job if available.
 */

import { commissionerAccessResponse } from '@/lib/league/commissionerAccess'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isIdpLeague } from '@/lib/idp'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const refused = await commissionerAccessResponse(leagueId, session.user.id, 'league')
  if (refused) return refused
  const isIdp = await isIdpLeague(leagueId)
  if (!isIdp) return NextResponse.json({ error: 'Not an IDP league' }, { status: 404 })

  // Extension point: enqueue or run projection sync job for IDP players (e.g. DT, CB projection gaps).
  return NextResponse.json({
    message: 'IDP projection sync can be triggered by the league projection sync job. Pass leagueId to include IDP players.',
    leagueId,
  })
}
