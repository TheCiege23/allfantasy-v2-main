import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { acknowledgeExternalCorrection, applyZombieCorrection, prepareZombieCorrection, ZombieRecoveryError } from '@/lib/zombie/beta2025CorrectionService'
import { finishZombieCorrectionEffects } from '@/lib/zombie/correctionFollowup'
import type { CorrectionPlan } from '@/lib/zombie/beta2025CorrectionPlan'

export const dynamic = 'force-dynamic'
function publicReview(row: { id: string; fromWeek: number; sourceHash: string; status: string; plan: unknown; effectsPending: boolean; appliedAt: unknown }) {
  const p = row.plan as CorrectionPlan & { externalReviews?: Array<{ payoutId: string; week: number }>; liveWeeksToRefresh?: number[] }
  return { id: row.id, fromWeek: row.fromWeek, sourceHash: row.sourceHash, status: row.status, effectsPending: row.effectsPending,
    appliedAt: row.appliedAt, blockers: p.blockers, summary: p.summary, liveWeeksToRefresh: p.liveWeeksToRefresh, externalReviews: p.externalReviews?.map(r => ({ payoutId: r.payoutId, week: r.week })),
    changes: p.weeks.map((w, index) => {
      const old = p.original[index]
      const itemView = (i: typeof w.items[number] | undefined) => i ? { rosterId: w.teams.find(t => t.id === i.teamStatusId)?.rosterId, itemType: i.itemType, spent: i.isUsed } : null
      const itemIds = [...new Set([...(old?.items ?? []), ...w.items].map(i => i.id))]
      return { week: w.week, teams: w.teams.map(t => ({ rosterId: t.rosterId, beforeRole: old?.teams.find(o => o.id === t.id)?.status,
        afterRole: t.status, beforeWinnings: old?.totals[t.rosterId] ?? 0, afterWinnings: w.totals[t.rosterId] ?? 0 })),
        scores: w.matches.map(m => ({ homeRosterId: m.homeRosterId, awayRosterId: m.awayRosterId, beforeHome: old?.matches.find(o => o.matchupId === m.matchupId)?.homeScore, beforeAway: old?.matches.find(o => o.matchupId === m.matchupId)?.awayScore, afterHome: m.homeScore, afterAway: m.awayScore })),
        items: itemIds.map(id => ({ id, before: itemView(old?.items.find(i => i.id === id)), after: itemView(w.items.find(i => i.id === id)) })).filter(i => JSON.stringify(i.before) !== JSON.stringify(i.after)),
        choices: w.choices.map(c => ({ rosterId: c.winnerRosterId, decision: c.decision, retained: c.retained, remaining: c.remaining, deadlineAt: c.deadlineAt })) }
    }) }
}
async function gate(leagueId: string, userId: string) {
  const z = await prisma.zombieLeague.findUnique({ where: { leagueId }, select: { id: true, correctionHoldFromWeek: true, league: { select: { userId: true } } } })
  return z?.league.userId === userId ? z : null
}
export async function GET(req: Request) {
  const userId = ((await getServerSession(authOptions as never)) as { user?: { id?: string } } | null)?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = new URL(req.url).searchParams.get('leagueId')
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  const z = await gate(leagueId, userId)
  if (!z) return NextResponse.json({ error: 'Owner access required' }, { status: 403 })
  const [reviews, weeks, teams] = await Promise.all([
    prisma.zombieCorrectionReview.findMany({ where: { zombieLeagueId: z.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.zombieWeeklyResolution.findMany({ where: { zombieLeagueId: z.id }, orderBy: { week: 'asc' }, select: { week: true, status: true, requiresStatCorrection: true } }),
    prisma.zombieLeagueTeam.findMany({ where: { leagueId }, select: { rosterId: true, fantasyTeamName: true, displayName: true } }),
  ])
  return NextResponse.json({ holdFromWeek: z.correctionHoldFromWeek, weeks, teams: teams.map(t => ({ id: t.rosterId, name: t.fantasyTeamName || t.displayName || 'Manager' })), reviews: reviews.map(publicReview) })
}
export async function POST(req: Request) {
  const userId = ((await getServerSession(authOptions as never)) as { user?: { id?: string } } | null)?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body.leagueId !== 'string') return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  const z = await gate(body.leagueId, userId)
  if (!z) return NextResponse.json({ error: 'Owner access required' }, { status: 403 })
  try {
    if (body.action === 'preview' && typeof body.week === 'number' && Number.isInteger(body.week)) return NextResponse.json({ review: publicReview(await prepareZombieCorrection(body.leagueId, body.week, userId)) })
    if (typeof body.reviewId !== 'string') return NextResponse.json({ error: 'A reviewed correction is required' }, { status: 400 })
    const review = await prisma.zombieCorrectionReview.findUnique({ where: { id: body.reviewId }, select: { zombieLeagueId: true } })
    if (review?.zombieLeagueId !== z.id) return NextResponse.json({ error: 'Review not found in this league' }, { status: 404 })
    if (body.action === 'external_review' && typeof body.payoutId === 'string' && typeof body.reference === 'string' && typeof body.note === 'string') return NextResponse.json(await acknowledgeExternalCorrection(body.leagueId, body.reviewId, body.payoutId, userId, body.reference, body.note))
    if (body.action === 'approve' && typeof body.sourceHash === 'string' && typeof body.reason === 'string') {
      const result = await applyZombieCorrection(body.leagueId, body.reviewId, body.sourceHash, userId, body.reason)
      const effects = await finishZombieCorrectionEffects(result.reviewId).catch(() => ({ pending: true }))
      return NextResponse.json({ ...result, effectsPending: effects.pending })
    }
    if (body.action === 'retry_effects') return NextResponse.json(await finishZombieCorrectionEffects(body.reviewId))
    return NextResponse.json({ error: 'Choose a valid recovery action' }, { status: 400 })
  } catch (error) { return NextResponse.json({ error: error instanceof ZombieRecoveryError ? error.message : 'Recovery could not finish. Refresh the preview and retry; no partial correction was committed.' }, { status: 409 }) }
}
