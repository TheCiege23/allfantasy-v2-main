import { survivorHostGuard } from '@/lib/survivor/survivorHostGuard'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { assertLeagueCommissioner, assertLeagueMember } from '@/lib/league/league-access'
import {
  createWeeklyChallenge,
  lockChallengeSubmissions,
  submitChallengeAnswer,
  tallyChallengeResults,
} from '@/lib/survivor/challengeEngine'
import { applySurvivorSitOutToMiniGames } from '@/lib/survivor/SurvivorSitOutEngine'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (requireCronAuth(req)) {
    const due = await prisma.survivorChallenge.findMany({
      where: {
        status: 'open',
        locksAt: { lte: new Date() },
      },
    })
    for (const c of due) {
      await lockChallengeSubmissions(c.id).catch(() => {})
    }
    return NextResponse.json({ ok: true, locked: due.length })
  }

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  const week = req.nextUrl.searchParams?.get('week')
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
  const w = week != null && week !== '' ? Number(week) : undefined
  const list = await prisma.survivorChallenge.findMany({
    where: { leagueId, ...(w != null && Number.isFinite(w) ? { week: w } : {}) },
    orderBy: { week: 'desc' },
  })
  return NextResponse.json({ challenges: list })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const intent = typeof body.intent === 'string' ? body.intent : 'create'

  if (intent === 'create') {
    const leagueId = typeof body.leagueId === 'string' ? body.leagueId : ''
    if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
    const gate = await assertLeagueCommissioner(leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const denied = await survivorHostGuard(leagueId, userId)
    if (denied) return denied
    const week = typeof body.week === 'number' ? body.week : 1
    const mode = body.mode === 'manual' ? 'manual' : 'auto'
    const ch = await createWeeklyChallenge(leagueId, week, mode)
    return NextResponse.json(ch)
  }

  if (intent === 'submit') {
    const challengeId = typeof body.challengeId === 'string' ? body.challengeId : ''
    const rosterId = typeof body.rosterId === 'string' ? body.rosterId : null
    const tribeId = typeof body.tribeId === 'string' ? body.tribeId : null
    const submission = (typeof body.submission === 'object' && body.submission ? body.submission : {}) as Record<
      string,
      unknown
    >
    if (!challengeId) return NextResponse.json({ error: 'challengeId required' }, { status: 400 })
    const ch = await prisma.survivorChallenge.findUnique({ where: { id: challengeId } })
    if (!ch) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (ch.submissionMode === 'automatic') return NextResponse.json({ error: 'This challenge settles from finalized league scores; no submission is needed.' }, { status: 409 })
    const gate = await assertLeagueMember(ch.leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

    const myRoster = await prisma.roster.findFirst({
      where: { leagueId: ch.leagueId, platformUserId: userId },
      select: { id: true },
    })
    if (!myRoster) return NextResponse.json({ error: 'Roster not found' }, { status: 403 })

    if (rosterId && rosterId !== myRoster.id) {
      return NextResponse.json({ error: 'You can only submit as your own roster' }, { status: 403 })
    }

    const sitOutGuard = await applySurvivorSitOutToMiniGames({
      leagueId: ch.leagueId,
      week: ch.week,
      rosterId: myRoster.id,
    })
    if (sitOutGuard.blocked) {
      return NextResponse.json(
        { error: `${sitOutGuard.reason ?? 'Sit-out is active for this week.'} Eligibility reason: sit-out accepted and locked.` },
        { status: 403 },
      )
    }

    const r = await submitChallengeAnswer(challengeId, rosterId, tribeId, submission)
    if (!r.ok) return NextResponse.json(r, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  if (intent === 'lock') {
    const challengeId = typeof body.challengeId === 'string' ? body.challengeId : ''
    if (!challengeId) return NextResponse.json({ error: 'challengeId required' }, { status: 400 })
    const ch = await prisma.survivorChallenge.findUnique({ where: { id: challengeId } })
    if (!ch) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const gate = await assertLeagueCommissioner(ch.leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const denied = await survivorHostGuard(ch.leagueId, userId)
    if (denied) return denied
    await lockChallengeSubmissions(challengeId)
    return NextResponse.json({ ok: true })
  }

  if (intent === 'tally') {
    const challengeId = typeof body.challengeId === 'string' ? body.challengeId : ''
    if (!challengeId) return NextResponse.json({ error: 'challengeId required' }, { status: 400 })
    const ch = await prisma.survivorChallenge.findUnique({ where: { id: challengeId } })
    if (!ch) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const gate = await assertLeagueCommissioner(ch.leagueId, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const denied = await survivorHostGuard(ch.leagueId, userId)
    if (denied) return denied
    try {
      const out = await tallyChallengeResults(challengeId)
      return NextResponse.json(out)
    } catch {
      return NextResponse.json({ error: 'Challenge result is pending a verified scoring source.' }, { status: 409 })
    }
  }

  return NextResponse.json({ error: 'Use GET for listing or set intent' }, { status: 400 })
}

