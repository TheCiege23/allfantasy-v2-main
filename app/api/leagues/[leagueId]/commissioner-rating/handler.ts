/**
 * GET: Fetch commissioner ratings for a league season.
 * POST: Submit a commissioner rating (one per user per season).
 * Stored in League.settings.commissioner_ratings JSON.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'

export const dynamic = 'force-dynamic'

interface RatingEntry {
  userId: string
  season: number
  ratings: Record<string, number> // questionId -> 1-5 star rating
  comment: string | null
  submittedAt: string
}

interface RatingsStore {
  entries: RatingEntry[]
}

const QUESTIONS = [
  { id: 'fairness', label: 'How fair was the commissioner in handling league decisions?' },
  { id: 'communication', label: 'How well did the commissioner communicate with league members?' },
  { id: 'responsiveness', label: 'How responsive was the commissioner to issues and questions?' },
  { id: 'organization', label: 'How well-organized was the league this season?' },
  { id: 'enjoyment', label: 'Overall, how much did you enjoy this league?' },
]

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true, season: true, userId: true, name: true },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const settings = (league.settings as Record<string, unknown>) ?? {}
  const store: RatingsStore = (settings.commissioner_ratings as RatingsStore) ?? { entries: [] }
  const season = league.season ?? new Date().getFullYear()

  // Get ratings for the just-completed season (current - 1 or current)
  const targetSeason = season
  const seasonEntries = store.entries.filter((e) => e.season === targetSeason)

  // Check if current user already submitted
  const userSubmitted = seasonEntries.some((e) => e.userId === session.user!.id)

  // Compute averages (only visible to commissioner or after user has rated)
  let averages: Record<string, number> | null = null
  let totalResponses = seasonEntries.length

  if (league.userId === session.user.id || userSubmitted) {
    averages = {}
    for (const q of QUESTIONS) {
      const vals = seasonEntries.map((e) => e.ratings[q.id]).filter((v) => typeof v === 'number')
      averages[q.id] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
    }
  }

  return NextResponse.json({
    questions: QUESTIONS,
    season: targetSeason,
    leagueName: league.name,
    userSubmitted,
    isCommissioner: league.userId === session.user.id,
    totalResponses,
    averages,
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true, season: true, userId: true },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Commissioner can't rate themselves
  if (league.userId === session.user.id) {
    return NextResponse.json({ error: 'Commissioners cannot rate themselves' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const ratings = body.ratings as Record<string, number> | undefined
  const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 500) : null

  if (!ratings || typeof ratings !== 'object') {
    return NextResponse.json({ error: 'Ratings required' }, { status: 400 })
  }

  // Validate all 5 questions have 1-5 ratings
  for (const q of QUESTIONS) {
    const val = ratings[q.id]
    if (typeof val !== 'number' || val < 1 || val > 5 || !Number.isInteger(val)) {
      return NextResponse.json({ error: `Invalid rating for ${q.id}` }, { status: 400 })
    }
  }

  const settings = (league.settings as Record<string, unknown>) ?? {}
  const store: RatingsStore = (settings.commissioner_ratings as RatingsStore) ?? { entries: [] }
  const season = league.season ?? new Date().getFullYear()

  // Check duplicate
  if (store.entries.some((e) => e.userId === session.user!.id && e.season === season)) {
    return NextResponse.json({ error: 'Already submitted for this season' }, { status: 409 })
  }

  const entry: RatingEntry = {
    userId: session.user.id,
    season,
    ratings,
    comment,
    submittedAt: new Date().toISOString(),
  }

  store.entries.push(entry)

  await prisma.league.update({
    where: { id: leagueId },
    data: { settings: toPrismaJsonInput({ ...settings, commissioner_ratings: store }) },
  })

  return NextResponse.json({ ok: true, message: 'Rating submitted successfully' })
}
