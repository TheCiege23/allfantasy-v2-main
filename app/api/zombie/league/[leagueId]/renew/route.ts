import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { previewStandaloneZombieRenewal, renewStandaloneZombieLeague, ZombieRenewalError } from '@/lib/zombie/renewZombieUniverse'
export const dynamic = 'force-dynamic'
export const maxDuration = 120
type Context = { params: Promise<{ leagueId: string }> }
async function run(req: Request, context: Context, execute: boolean) {
  const session = await getServerSession(authOptions as never) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId }=await context.params
  const body=execute ? await req.json().catch(()=>null) as { season?: unknown; previewHash?: unknown } | null : null
  const raw=execute ? body?.season : new URL(req.url).searchParams.get('season')
  const season=typeof raw==='number' || typeof raw==='string' && /^\d{4}$/.test(raw) ? Number(raw) : NaN
  if (!Number.isInteger(season) || season<2000 || season>=2200) return NextResponse.json({ error: 'Choose a valid completed season.' }, { status: 400 })
  if (execute && (typeof body?.previewHash!=='string' || !/^[a-f0-9]{64}$/.test(body.previewHash))) return NextResponse.json({ error: 'Review a fresh season preview first.' }, { status: 400 })
  try {
    return NextResponse.json(execute ?
      await renewStandaloneZombieLeague(leagueId,season,session.user.id,body!.previewHash as string) :
      await previewStandaloneZombieRenewal(leagueId,season,session.user.id))
  } catch(error) {
    if (error instanceof ZombieRenewalError) {
      const code=error.message
      const messages: Record<string,string>={
        RENEWAL_OWNER_REQUIRED: 'Only the league owner can renew its season.',
        RENEWAL_NOT_FOUND: 'Zombie league not found.',
        RENEWAL_UNIVERSE_REQUIRED: 'Renew this linked league from its universe controls.',
        RENEWAL_SEASON_INVALID: 'Choose this league’s saved season before preparing the next one.',
        RENEWAL_SEASONS_INCOMPLETE: 'This league must finish its native and Zombie seasons before renewal.',
        RENEWAL_RECONCILIATION_REQUIRED: 'Finish all weekly settlements and resolve stat corrections before renewal.',
        RENEWAL_CAPACITY_UNBALANCED: 'The movement rules do not leave exactly enough managers for each level. Review tier capacities and movement counts.',
        RENEWAL_MEMBERSHIP_AMBIGUOUS: 'Every seat needs a distinct registered manager across this universe before renewal.',
        RENEWAL_PREVIEW_CHANGED: 'The season changed after your preview. Review a fresh preview before creating next season.',
        RENEWAL_DRAFT_INCOMPLETE: 'Every previous-season draft must be completed.',
        RENEWAL_NEWER_SEASON_EXISTS: 'This universe already has a newer season. Open that season before renewing again.',
        RENEWAL_MANUAL_REVIEW_REQUIRED: 'This universe uses manual movement. Review its movement policy before automatic renewal.',
        RENEWAL_MOVEMENT_REVIEW_REQUIRED: 'Recorded movement differs from current results. Resolve movement history before renewal.',
      }
      return NextResponse.json({ error: messages[code] || 'The season is not ready for renewal. Review league configuration and standings.', code },
        { status: code==='RENEWAL_OWNER_REQUIRED'?403:code==='RENEWAL_NOT_FOUND'?404:409 })
    }
    console.error('[zombie-renewal] transaction failed', { code: 'RENEWAL_TRANSACTION_FAILED' })
    return NextResponse.json({ error: 'Season renewal failed. No partial season was saved.' }, { status: 500 })
  }
}
export function GET(req: Request, context: Context) { return run(req,context,false) }
export function POST(req: Request, context: Context) { return run(req,context,true) }
