import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getImportedTradeLedger } from '@/lib/trade-intel/importedTradeLedgerService'
import { getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { buildDraftTradeAiReview } from '@/lib/live-draft-engine/DraftTradeAiReviewService'
import { getReconciledTradeGrades } from '@/lib/core-app/sleeperTradeHistory'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // first build walks every season's transactions

/**
 * Graded trade ledger for the Legacy tab: every completed trade since the
 * league was created, graded on realized outcomes and re-graded each season.
 * Access rules mirror /api/league/history; Sleeper-only for now.
 */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) {
    return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  }

  const league = await prisma.league.findFirst({
    where: {
      id: leagueId,
      OR: [{ userId: userId }, { teams: { some: { claimedByUserId: userId } } }],
    },
    select: { id: true, platform: true, platformLeagueId: true },
  })
  if (!league) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }
  // Private offers are visible only to their participants. Approved trades are league-visible.
  if (req.nextUrl.searchParams.get('view') === 'proposals') {
    const cursor = req.nextUrl.searchParams.get('cursor')
    const proposals = await prisma.redraftTradeProposal.findMany({
      where: {
        leagueId: league.id,
        OR: [
          { proposerRoster: { ownerId: userId } },
          { receiverRoster: { ownerId: userId } },
          { status: { in: ['accepted', 'approved', 'completed', 'executed'] } },
        ],
      },
      orderBy: { id: 'desc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: 51,
      select: {
        id: true, status: true, createdAt: true,
        proposerRoster: { select: { teamName: true, ownerName: true, ownerId: true } },
        receiverRoster: { select: { teamName: true, ownerName: true, ownerId: true } },
        assets: { select: { playerName: true, assetType: true, pickSeason: true, pickRound: true } },
        valueSnapshot: { select: { grade: true, confidenceScore: true, payload: true } },
      },
    })
    return NextResponse.json({
      proposals: proposals.slice(0, 50).map(p => {
        const payload = p.valueSnapshot?.payload as { grade?: { insufficientData?: boolean; bullets?: string[] } } | null
        const graded = p.valueSnapshot && p.valueSnapshot.confidenceScore >= 60 && payload?.grade?.insufficientData === false
        return {
          id: p.id, status: p.status, createdAt: p.createdAt,
          title: `${p.proposerRoster.teamName || p.proposerRoster.ownerName} → ${p.receiverRoster.teamName || p.receiverRoster.ownerName}`,
          involvesYou: p.proposerRoster.ownerId === userId || p.receiverRoster.ownerId === userId,
          assets: p.assets.map(a => a.playerName || (a.assetType === 'draft_pick' ? `${a.pickSeason ?? '?'} round ${a.pickRound ?? '?'} pick` : a.assetType)),
          grade: graded ? p.valueSnapshot!.grade : null,
          explanation: graded ? (payload?.grade?.bullets ?? []).join(' ') || 'Snapshot of trade fairness when proposed.' : 'Not enough verified valuation data to grade this proposal.',
        }
      }),
      nextCursor: proposals.length > 50 ? proposals[49].id : null,
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  }
  if (req.nextUrl.searchParams.get('view') === 'draft-proposals') {
    const cursor = req.nextUrl.searchParams.get('cursor')
    const [viewerRosterId, commissioner] = await Promise.all([
      getCurrentUserRosterIdForLeague(league.id, userId),
      isCommissioner(league.id, userId),
    ])
    const participantVisibility = viewerRosterId
      ? [{ proposerRosterId: viewerRosterId }, { receiverRosterId: viewerRosterId }]
      : []
    const proposals = await (prisma as any).draftPickTradeProposal.findMany({
      where: {
        session: { leagueId: league.id },
        ...(commissioner ? {} : { OR: [...participantVisibility, { status: 'accepted' }] }),
      },
      orderBy: { id: 'desc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: 51,
      select: {
        id: true, status: true, createdAt: true,
        proposerRosterId: true, receiverRosterId: true,
        proposerName: true, receiverName: true,
        giveRound: true, giveSlot: true,
        receiveRound: true, receiveSlot: true,
        session: { select: { teamCount: true, draftType: true, thirdRoundReversal: true } },
      },
    }) as Array<any>
    return NextResponse.json({
      proposals: proposals.slice(0, 50).map(p => {
        // Receiver point of view: they give receive* and get give*.
        const review = buildDraftTradeAiReview({
          giveRound: p.receiveRound,
          giveSlot: p.receiveSlot,
          receiveRound: p.giveRound,
          receiveSlot: p.giveSlot,
          teamCount: p.session.teamCount,
          draftType: p.session.draftType,
          thirdRoundReversal: p.session.thirdRoundReversal,
        })
        return {
          id: p.id,
          status: p.status,
          createdAt: p.createdAt,
          title: `${p.proposerName || 'Proposer'} → ${p.receiverName || 'Receiver'}`,
          involvesYou: p.proposerRosterId === viewerRosterId || p.receiverRosterId === viewerRosterId,
          assets: [
            `${p.proposerName || 'Proposer'} offers pick ${p.giveRound}.${String(p.giveSlot).padStart(2, '0')}`,
            `${p.receiverName || 'Receiver'} offers pick ${p.receiveRound}.${String(p.receiveSlot).padStart(2, '0')}`,
          ],
          grade: review.verdict.toUpperCase(),
          explanation: `Receiver-side draft-capital verdict: ${review.summary}`,
        }
      }),
      nextCursor: proposals.length > 50 ? proposals[49].id : null,
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  }
  if (league.platform !== 'sleeper' || !league.platformLeagueId) {
    // Imported leagues (Yahoo/ESPN/…): serve the honest UNGRADED ledger from
    // the persisted transaction facts. Grades need per-player historical
    // scoring, which imported provider data doesn't include — the payload
    // says so explicitly instead of guessing letters.
    const ledger = await getImportedTradeLedger(league.id, league.platform ?? 'imported')
    if (ledger) {
      return NextResponse.json({
        supported: true as const,
        graded: false as const,
        viewerSleeperUserId: null,
        ledger,
      })
    }
    return NextResponse.json({ supported: false as const, platform: league.platform })
  }

  const [claimed, profile] = await Promise.all([
    prisma.leagueTeam
      .findFirst({ where: { leagueId: league.id, claimedByUserId: userId }, select: { platformUserId: true } })
      .catch(() => null),
    prisma.userProfile
      .findUnique({ where: { userId }, select: { sleeperUserId: true } })
      .catch(() => null),
  ])

  const reconciled = await getReconciledTradeGrades(league.platformLeagueId)
  const grades = reconciled.grades
  if (!grades) {
    return NextResponse.json(
      { supported: true as const, grades: null, error: 'Trade grading temporarily unavailable' },
      { status: 502 },
    )
  }

  return NextResponse.json({
    supported: true as const,
    viewerSleeperUserId: claimed?.platformUserId ?? profile?.sleeperUserId ?? null,
    grades,
    sync: {
      liveFeedAvailable: reconciled.feedAvailable,
      incomplete: reconciled.incomplete,
      refreshed: reconciled.refreshed,
    },
  })
}
