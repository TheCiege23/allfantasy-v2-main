import { ImageResponse } from 'next/og'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { getSeasonRecap } from '@/lib/season-recap/seasonRecapService'
import { isRecapCardKind, recapCardView } from '@/lib/season-recap/seasonRecapCards'
import { RECAP_CARD_SIZE, SeasonRecapShareCard } from '@/components/league/SeasonRecapShareCard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/share/season-recap-card?leagueId=…&season=…&card=champion|<award>&lang=en|es
 *
 * A season recap share card (1200×630 PNG): the champion, or one award. Same gate and same data as the
 * recap page (`/api/league/[leagueId]/season-history?view=recap`): a signed-in league member, the stored
 * recap or the one computed from the stored season. An award the recap does not have is a 404, never
 * a blank card. Free — no AI is involved.
 */
export async function GET(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = new URL(req.url).searchParams
  const leagueId = params.get('leagueId')?.trim()
  const season = Number.parseInt(params.get('season') ?? '', 10)
  const card = params.get('card')
  const lang = params.get('lang') === 'es' ? 'es' : 'en'
  if (!leagueId || !Number.isInteger(season) || !isRecapCardKind(card)) {
    return NextResponse.json({ error: 'leagueId, season and a valid card required' }, { status: 400 })
  }
  const access = await resolveLeagueAccess(leagueId, userId)
  if (!access?.isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const out = await getSeasonRecap(leagueId, season)
  const view = out ? recapCardView(out.recap, card, lang) : null
  if (!view) return NextResponse.json({ error: 'No such card for this season' }, { status: 404 })
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { name: true } })

  return new ImageResponse(<SeasonRecapShareCard view={view} leagueName={league?.name ?? 'AllFantasy'} />, {
    width: RECAP_CARD_SIZE.width,
    height: RECAP_CARD_SIZE.height,
  })
}
