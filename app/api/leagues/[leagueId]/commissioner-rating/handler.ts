/**
 * Commissioner rating (and commish reputation, docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3, idea 10).
 *
 *   GET   the season's questions and averages; for the commissioner, their reputation across every
 *         league they run and whether this league shows it publicly
 *   POST  { ratings, comment? }  a league member rates the commissioner, once per season
 *   PUT   { public: boolean }    commissioner only: show the reputation on this league's public listings
 *
 * Stored in League.settings.commissioner_ratings; logic in lib/commish-reputation/.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readLeagueRatingView, setReputationPublic, submitRating, type SubmitError } from '@/lib/commish-reputation/reputationService'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> }

async function userIdOf(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

const SUBMIT_STATUS: Record<string, number> = { not_found: 404, not_member: 403, self: 400, duplicate: 409 }
const SUBMIT_MESSAGE: Record<string, string> = {
  not_member: 'Only managers in this league can rate its commissioner',
  self: 'Commissioners cannot rate themselves',
  duplicate: 'Already submitted for this season',
  ratings_required: 'Ratings required',
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const userId = await userIdOf()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  const view = await readLeagueRatingView(leagueId, userId)
  if (!view) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(view)
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const userId = await userIdOf()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const r = await submitRating(leagueId, userId, { ratings: body.ratings, comment: body.comment })
  if (!r.ok) {
    const e: SubmitError = r.error
    const message = SUBMIT_MESSAGE[e] ?? (e.startsWith('invalid_') ? `Invalid rating for ${e.slice('invalid_'.length)}` : e)
    return NextResponse.json({ error: message, code: e }, { status: SUBMIT_STATUS[e] ?? 400 })
  }
  return NextResponse.json({ ok: true, message: 'Rating submitted successfully' })
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const userId = await userIdOf()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true } })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // The reputation is the head commissioner's own; only they decide whether it is public.
  if (league.userId !== userId) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  if (typeof body.public !== 'boolean') return NextResponse.json({ error: 'public must be true or false' }, { status: 400 })
  if (!(await setReputationPublic(leagueId, body.public))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(await readLeagueRatingView(leagueId, userId))
}
