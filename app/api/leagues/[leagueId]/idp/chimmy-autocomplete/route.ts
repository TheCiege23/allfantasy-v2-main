import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isIdpLeague } from '@/lib/idp'

export const dynamic = 'force-dynamic'

const IDP_CHIMMY_OPTIONS = [
  '@chimmy idp rankings',
  '@chimmy start sit defense',
  '@chimmy waiver targets defense',
  '@chimmy matchup analysis',
  '@chimmy snap analysis',
  '@chimmy idp sleepers',
  '@chimmy idp scarcity',
  '@chimmy idp power rankings',
  '@chimmy cap',
  '@chimmy contracts',
  '@chimmy cut ',
  '@chimmy extend ',
  '@chimmy simulate defense cap',
  '@chimmy cap advice',
  '@chimmy defender value ',
  '@chimmy contract eval ',
  '@chimmy cap efficiency',
  '@chimmy cap burden',
  '@chimmy trade targets cap',
  '@chimmy contender rebuild',
  '@chimmy weekly recap',
  '@chimmy help idp',
]

export async function GET(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isIdp = await isIdpLeague(leagueId)
  if (!isIdp) return NextResponse.json({ error: 'Not an IDP league' }, { status: 404 })

  const draft = req.nextUrl.searchParams?.get('draft') ?? ''
  const low = draft.toLowerCase()
  if (!low.includes('@chimmy')) {
    return NextResponse.json({ type: 'command', options: [] as string[] })
  }

  const tail = draft
    .slice(Math.max(0, low.indexOf('@chimmy')))
    .replace(/^@chimmy\s*/i, '')
    .trim()
    .toLowerCase()

  const options =
    tail.length === 0
      ? IDP_CHIMMY_OPTIONS
      : IDP_CHIMMY_OPTIONS.filter((o) => {
          const ol = o.toLowerCase()
          return ol.includes(tail) || tail.split(/\s+/).every((w) => w.length > 0 && ol.includes(w));
        })

  return NextResponse.json({ type: 'command', options: options.slice(0, 12) })
}
