'use client'

import Link from 'next/link'
import { MessageSquareMore, Trophy, Users } from 'lucide-react'
import type { CreatorLeagueDto } from '@/lib/creator-system/types'

interface CreatorCommunityPreviewProps {
  leagues: CreatorLeagueDto[]
  creatorSlug: string
  emptyMessage?: string
}

export function CreatorCommunityPreview({
  leagues,
  creatorSlug,
  emptyMessage = 'No public leagues yet.',
}: CreatorCommunityPreviewProps) {
  if (leagues.length === 0) {
    return (
      <div
        className="rounded-[28px] border p-8 text-center"
        style={{
          borderColor: 'var(--border)',
          background: 'color-mix(in srgb, var(--panel) 72%, transparent)',
        }}
      >
        <Trophy className="mx-auto h-12 w-12" style={{ color: 'var(--muted)' }} />
        <p className="mt-3 text-sm" style={{ color: 'var(--muted)' }}>
          {emptyMessage}
        </p>
      </div>
    )
  }

  const totalMembers = leagues.reduce((sum, league) => sum + league.memberCount, 0)
  const publicLeagues = leagues.filter((league) => league.isPublic).length

  return (
    <section
      className="rounded-[28px] border p-5"
      style={{
        borderColor: 'var(--border)',
        background: 'color-mix(in srgb, var(--panel) 72%, transparent)',
      }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4" style={{ color: 'var(--muted)' }} />
            <h3 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>
              Community preview
            </h3>
          </div>
          <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
            {publicLeagues} public leagues, {totalMembers} members, latest recap headlines ready to share.
          </p>
        </div>
        <Link
          href={`/creators/${encodeURIComponent(creatorSlug)}`}
          className="text-sm font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          Open creator profile
        </Link>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {leagues.slice(0, 4).map((league) => (
          <Link
            key={league.id}
            href={`/creator/leagues/${encodeURIComponent(league.id)}`}
            className="rounded-2xl border p-4 transition hover:opacity-90"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{league.name}</p>
                <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
                  {league.sport} • {league.memberCount} members
                </p>
              </div>
              <span className="rounded-full border px-2 py-1 text-[11px]" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                {league.isPublic ? 'Public' : 'Invite'}
              </span>
            </div>
            {league.latestRecapSummary && (
              <div className="mt-3 flex gap-2 text-xs" style={{ color: 'var(--muted)' }}>
                <MessageSquareMore className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="line-clamp-2">{league.latestRecapSummary}</span>
              </div>
            )}
          </Link>
        ))}
      </div>
    </section>
  )
}
