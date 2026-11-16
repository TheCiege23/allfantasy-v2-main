/**
 * GET: IDP settings audit log for the league. Commissioner only.
 */

import { commissionerAccessResponse } from '@/lib/league/commissionerAccess'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isIdpLeague } from '@/lib/idp'
import { getIdpSettingsAuditLog } from '@/lib/idp/IdpSettingsAudit'

export async function GET(
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

  const { searchParams } = new URL(req.url)
  const limit = Math.min(Number(searchParams?.get('limit')) || 50, 100)
  const sinceParam = searchParams?.get('since')
  const since = sinceParam ? new Date(sinceParam) : undefined

  const entries = await getIdpSettingsAuditLog(leagueId, { limit, since })
  return NextResponse.json({
    auditLog: entries.map((e) => ({
      action: e.action,
      actorId: e.actorId,
      before: e.before,
      after: e.after,
      createdAt: e.createdAt.toISOString(),
    })),
  })
}
