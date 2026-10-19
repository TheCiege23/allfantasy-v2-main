import { notFound } from 'next/navigation'
import { loadTrophy } from '@/lib/tournament/divisions/lifecycle'
import { buildShareCard } from '@/lib/tournament/divisions/shareCard'
import { ChampionShareStudio } from '@/components/tournament/divisions/ChampionShareCard'
import { DivisionsHub } from '@/components/tournament/divisions/DivisionsHub'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Tournament trophy — AllFantasy', robots: { index: false, follow: false } }

/**
 * Public trophy page: the share card and the full bracket. Exists only once seeding
 * is committed; `?entry=<team>` shows that finisher's own card, otherwise the
 * champion's (or the top seed's while the bracket is still running).
 */
export default async function TrophyPage({ params, searchParams }: { params: Promise<{ tournamentId: string }>; searchParams: Promise<{ entry?: string | string[] }> }) {
  const { tournamentId } = await params
  const q = await searchParams
  const view = await loadTrophy(tournamentId)
  if (!view) notFound()
  const fallback = view.championship?.winnerId ?? view.divisions[0].rows[0]?.id
  const teamId = typeof q.entry === 'string' && q.entry.length <= 200 ? q.entry : fallback
  const card = teamId ? buildShareCard(view, teamId) : null
  if (!card || !teamId) notFound()
  const shareUrl = `/tournament-trophy/${encodeURIComponent(tournamentId)}?entry=${encodeURIComponent(teamId)}`
  return (
    <main className="mx-auto min-h-screen max-w-[1440px] space-y-6 bg-[#07080d] px-4 py-6 text-white sm:px-8">
      <header><h1 className="text-2xl font-bold sm:text-4xl">Share your title</h1><p className="text-slate-300">Trophy page · share card</p></header>
      <ChampionShareStudio card={card} view={view} shareUrl={shareUrl} />
      <section aria-label="Full bracket"><DivisionsHub view={view} initialScreen="bracket" /></section>
    </main>
  )
}
