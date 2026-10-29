import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function DashboardDispersalPage() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent('/dashboard/dispersal')}`)
  }
  const userId = session.user.id
  const dispersalDraftClient = prisma.dispersalDraft

  const drafts: Array<{
    id: string
    leagueId: string
    status: string
    updatedAt: Date
    league: { id: string; name: string | null }
  }> = await dispersalDraftClient.findMany({
    where: {
      status: { in: ['pending', 'configuring', 'in_progress'] },
      league: {
        OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }],
      },
    },
    include: {
      league: { select: { id: true, name: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 40,
  })

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8 text-white">
      <div>
        <h1 className="text-xl font-bold">Dispersal drafts</h1>
        <p className="mt-1 text-sm text-white/50">
          Open leagues where a commissioner has started a dispersal draft for orphaned or pooled assets.
        </p>
      </div>

      {drafts.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-[#0a1328] p-6 text-sm text-white/60">
          No active dispersal drafts for your leagues. When a commissioner runs one, it will appear here and on the league
          home banner.
        </div>
      ) : (
        <ul className="space-y-3">
          {drafts.map((d) => (
            <li key={d.id}>
              <Link
                href={`/league/${d.leagueId}/dispersal-draft/${d.id}`}
                className="flex flex-col rounded-2xl border border-cyan-500/20 bg-[#081226] px-4 py-3 text-sm transition hover:border-cyan-400/40 hover:bg-cyan-500/5"
              >
                <span className="font-semibold text-cyan-100">{d.league.name ?? 'League'}</span>
                <span className="text-[11px] text-white/45">
                  Status: {d.status} · Updated {d.updatedAt.toISOString().slice(0, 10)}
                </span>
                <span className="mt-1 text-xs font-medium text-cyan-300/90">Enter draft room →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link href="/dashboard" className="inline-block text-xs text-white/50 underline hover:text-white/80">
        ← Back to dashboard
      </Link>
    </div>
  )
}
