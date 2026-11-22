import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { awardBallotHref, awardTallies } from '@/lib/league-chat/awardBallot'
import { readLeagueAwardBallots } from '@/lib/league-chat/awardBallotService'
import { LeagueAwardVoting } from '@/components/core-app/commissioner/LeagueAwardVoting'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ leagueId: string; ballot?: string[] }> }) {
  const { leagueId, ballot: segments } = await params
  if (segments && segments.length !== 1) notFound()
  const id = segments?.[0] ?? null
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  const returnTo = id ? awardBallotHref(leagueId, id) : `/league/${encodeURIComponent(leagueId)}/awards`
  if (!userId) redirect(`/login?callbackUrl=${encodeURIComponent(returnTo)}`)
  const [member, canManage] = await Promise.all([
    resolveLeagueAccess(leagueId, userId),
    canCommissionerAct(leagueId, userId, 'league'),
  ])
  if (!member && !canManage) notFound()

  const [league, rows] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { name: true, platform: true } }),
    readLeagueAwardBallots(leagueId),
  ])
  if (!league || (id && !rows.some((row) => row.id === id))) notFound()

  const ballots = rows.map(({ id, ballot }) => ({
    id, href: awardBallotHref(leagueId, id), name: ballot.name, closesAt: ballot.closeAt,
    mine: ballot.votes.find((vote) => vote.userId === userId)?.optionId ?? null,
    ...awardTallies(ballot),
  }))
  return (
    <main className="mx-auto grid max-w-3xl gap-6 px-4 py-8">
      <Link href={`/core?league=${encodeURIComponent(leagueId)}`}>← {league.name ?? 'League'}</Link>
      <h1 className="text-2xl font-semibold">League awards</h1>
      <LeagueAwardVoting leagueId={leagueId} selectedId={id} ballots={ballots}
        canManage={canManage} canVote={Boolean(member)} native={isNativePlatform(league.platform)} />
    </main>
  )
}
