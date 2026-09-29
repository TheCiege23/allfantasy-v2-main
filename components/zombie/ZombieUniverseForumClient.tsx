'use client'

import { useEffect, useMemo, useState } from 'react'
import { MessageSquare, Pin, RadioTower } from 'lucide-react'
import { ZombieEventFeed } from '@/app/zombie/components/ZombieEventFeed'

type HubData = {
  universe?: {
    name?: string
    leagues?: Array<{
      leagueId: string
      name?: string | null
      level?: { name?: string | null } | null
      teams?: Array<{ status?: string | null }>
    }>
  }
  animations?: Array<{
    id: string
    animationType: string
    week: number
    metadata: unknown
    createdAt: string
  }>
  announcements?: Array<{
    id: string
    type: string
    title: string
    content: string
    week: number | null
    createdAt: string
  }>
}

export interface ZombieUniverseForumClientProps {
  universeId: string
}

export function ZombieUniverseForumClient({ universeId }: ZombieUniverseForumClientProps) {
  const [data, setData] = useState<HubData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!universeId) return
    let active = true

    async function load() {
      try {
        const res = await fetch(`/api/zombie/universe-hub?universeId=${encodeURIComponent(universeId)}`, {
          cache: 'no-store',
        })
        if (!active) return
        if (!res.ok) {
          setError('Failed to load universe forum')
          setData(null)
          return
        }
        setData((await res.json()) as HubData)
      } catch {
        if (active) setError('Request failed')
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [universeId])

  const pinned = useMemo(() => (data?.announcements ?? []).slice(0, 2), [data])
  const threadRows = useMemo(() => {
    return (data?.universe?.leagues ?? []).slice(0, 8).map((league) => {
      let survivors = 0
      let zombies = 0

      for (const team of league.teams ?? []) {
        const status = (team.status ?? '').toLowerCase()
        if (status.includes('zombie')) zombies += 1
        if (status.includes('survivor') || status.includes('revived')) survivors += 1
      }

      return {
        id: league.leagueId,
        title: league.name ?? league.leagueId,
        subtitle: league.level?.name ?? 'Universe league',
        meta: `${survivors} alive | ${zombies} horde`,
      }
    })
  }, [data])

  if (error) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-4">
        <p className="text-sm text-amber-200">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <Pin className="h-5 w-5 text-amber-400" />
          Pinned updates
        </h2>
        {pinned.length === 0 ? (
          <p className="text-sm text-white/50">No pinned universe posts yet.</p>
        ) : (
          <div className="space-y-3">
            {pinned.map((post) => (
              <article key={post.id} className="rounded-2xl border border-amber-500/20 bg-amber-950/10 p-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-200/75">
                  {post.type.replace(/_/g, ' ')}
                </p>
                <p className="mt-2 text-base font-semibold text-white">{post.title}</p>
                <p className="mt-2 text-sm leading-6 text-white/70">{post.content}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <RadioTower className="h-5 w-5 text-rose-300" />
          Universe event feed
        </h2>
        <ZombieEventFeed
          animations={data?.animations ?? []}
          announcements={data?.announcements ?? []}
          maxItems={6}
          leagueName={data?.universe?.name ?? 'Universe'}
        />
      </section>

      <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <MessageSquare className="h-5 w-5 text-cyan-400" />
          League pulse
        </h2>
        {threadRows.length === 0 ? (
          <p className="text-sm text-white/50">No league pulse threads yet.</p>
        ) : (
          <div className="space-y-2">
            {threadRows.map((thread) => (
              <div
                key={thread.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-black/20 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{thread.title}</p>
                  <p className="mt-1 text-xs text-white/45">{thread.subtitle}</p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                  {thread.meta}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
