'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { useTournamentUi } from '@/app/tournament/[tournamentId]/TournamentUiContext'
import { useTournamentParticipantState } from '@/lib/tournament/useTournamentParticipantState'
import { ForumPostCard } from '@/app/tournament/components/ForumPostCard'
import { StandingsRow } from '@/app/tournament/components/StandingsRow'

const FILTERS = ['All', 'Commissioner', 'AI Recaps', 'Results', 'Drafts', 'Rules'] as const

export default function TournamentForumPage() {
  const tournamentId = useParams<{ tournamentId: string }>()?.tournamentId ?? ''
  const base = `/tournament/${tournamentId}`
  const ctx = useTournamentUi()
  const state = useTournamentParticipantState(ctx)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All')

  const posts = useMemo(() => {
    let a = [...ctx.announcements]
    if (filter === 'AI Recaps') a = a.filter((x) => x.type === 'round_summary')
    else if (filter === 'Results') a = a.filter((x) => x.type.includes('qualifier') || x.type.includes('round'))
    else if (filter === 'Drafts') a = a.filter((x) => x.type === 'draft_scheduled')
    else if (filter === 'Rules') a = a.filter((x) => x.type === 'welcome')
    else if (filter === 'Commissioner') a = a.filter((x) => x.type === 'welcome' || x.type === 'round_started')
    return a
  }, [ctx.announcements, filter])

  const topPf = useMemo(() => {
    const rows = state.standingsLeagues.flatMap((L) => L.participants)
    rows.sort((a, b) => b.pointsFor - a.pointsFor)
    return rows.slice(0, 5)
  }, [state.standingsLeagues])

  const readOnly = state.status === 'eliminated'

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
      <div>
        <h1 className="text-[18px] font-bold text-white">Tournament forum</h1>
        <div className="scrollbar-none mt-3 flex gap-1 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold ${
                filter === f ? 'bg-cyan-500/25 text-cyan-100' : 'bg-white/5 text-[var(--tournament-text-mid)]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="mt-4 space-y-4">
          {posts.map((a) => (
            <ForumPostCard
              key={a.id}
              type={a.type}
              title={a.title}
              content={a.content}
              createdAt={a.createdAt}
              readOnly={readOnly}
            />
          ))}
        </div>
      </div>

      <aside className="space-y-4">
        <div className="tournament-panel p-4">
          <h2 className="text-[12px] font-bold uppercase tracking-wide text-[var(--tournament-text-dim)]">
            Standings snapshot
          </h2>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left">
              <tbody>
                {topPf.map((row, i) => (
                  <StandingsRow
                    key={row.id}
                    row={row}
                    rank={i + 1}
                    highlight={row.userId === ctx.viewerUserId}
                    hidePf={false}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <Link href={`${base}/standings`} className="mt-3 inline-block text-[12px] font-semibold text-cyan-300 hover:underline">
            Full standings
          </Link>
        </div>
        <div className="tournament-panel space-y-2 p-4 text-[12px]">
          <p className="font-bold text-white">Quick links</p>
          <Link href={`${base}/league`} className="block text-cyan-300 hover:underline">
            My league
          </Link>
          <Link href={`${base}/drafts`} className="block text-cyan-300 hover:underline">
            Drafts
          </Link>
          <Link href={`${base}/progress`} className="block text-cyan-300 hover:underline">
            Progress map
          </Link>
        </div>
      </aside>
    </div>
  )
}
