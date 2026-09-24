import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Draft results landing: show leagues with completed drafts or redirect.
 * Full results at /league/[leagueId]/draft-results.
 */
export default async function DraftResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ leagueId?: string }>,
}) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) redirect('/login?callbackUrl=/draft-results')

  const { leagueId } = await searchParams
  if (leagueId) {
    redirect(`/league/${leagueId}/draft-results`)
  }

  const leaguesWithCompletedDraft = await prisma.league.findMany({
    where: {
      userId,
      // Any completed draft counts: a league with a finished startup and a live rookie draft
      // still has results to show.
      draftSessions: {
        some: { status: 'completed' },
      },
    },
    select: {
      id: true,
      name: true,
      sport: true,
    },
    take: 20,
  })

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white px-4 py-8">
      <div className="mx-auto max-w-lg">
        <h1 className="text-2xl font-bold">Draft results</h1>
        <p className="mt-1 text-sm text-white/60">
          View manager rankings, grades, and best/worst picks for a completed draft.
        </p>
        {leaguesWithCompletedDraft.length === 0 ? (
          <div className="mt-8 rounded-xl border border-white/10 bg-white/5 p-6 text-center">
            <p className="text-white/80">No completed drafts yet.</p>
            <p className="mt-2 text-sm text-white/50">
              Complete a league draft to see rankings and grades here.
            </p>
            <Link
              href="/app"
              className="mt-4 inline-block rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
            >
              Go to App
            </Link>
          </div>
        ) : (
          <ul className="mt-6 space-y-2">
            {leaguesWithCompletedDraft.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/league/${l.id}/draft-results`}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left hover:bg-white/10 min-h-[44px]"
                >
                  <span className="font-medium text-white/90">{l.name ?? 'League'}</span>
                  <span className="text-xs text-white/50">{l.sport}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-6">
          <Link href="/app" className="text-sm text-cyan-400 hover:underline">
            ← Back to App
          </Link>
        </p>
      </div>
    </div>
  )
}
