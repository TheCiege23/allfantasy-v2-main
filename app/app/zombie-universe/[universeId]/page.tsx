'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  ChevronLeft,
  Crown,
  MessageSquare,
  RadioTower,
  Shield,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import { ZombieUniverseStandingsClient } from '@/components/zombie/ZombieUniverseStandingsClient'
import { ZombieUniverseForumClient } from '@/components/zombie/ZombieUniverseForumClient'
import { ZombieUniverseAIPanel } from '@/components/zombie/ZombieUniverseAIPanel'

type UniverseData = {
  universe: {
    id: string
    name: string
    sport: string
    tierCount?: number
    status?: string
    levels?: Array<{
      id: string
      name: string
      rankOrder?: number | null
      colorHex?: string | null
    }>
    leagues?: Array<{
      id?: string
      leagueId: string
      name?: string | null
      league?: { id: string; name?: string | null } | null
      level?: { id?: string; name?: string | null } | null
      teams?: Array<{ status?: string | null }>
      whispererRecord?: { id: string } | null
    }>
    universeStat?: Array<{
      rosterId: string
      displayName?: string | null
      leagueName?: string | null
      currentSeasonPPW?: number | null
      currentLevelId?: string | null
    }>
  }
  topRanked?: Array<{
    rosterId: string
    displayName?: string | null
    leagueName?: string | null
    currentSeasonPPW?: number | null
    currentLevelId?: string | null
  }>
}

type HubData = {
  counts?: {
    survivorCount?: number
    zombieCount?: number
    whispererCount?: number
    leagueCount?: number
  }
}

function levelTone(rank: number) {
  if (rank >= 3) return 'from-amber-500/25 to-red-500/10 border-amber-400/20'
  if (rank === 2) return 'from-sky-500/18 to-cyan-500/10 border-sky-400/20'
  return 'from-emerald-500/18 to-lime-500/10 border-emerald-400/20'
}

export default function ZombieUniverseHomePage() {
  const params = useParams<{ universeId: string }>() ?? ({} as { universeId: string })
  const universeId = params?.universeId ?? ''
  const [tab, setTab] = useState<'standings' | 'forum' | 'ai'>('standings')
  const [data, setData] = useState<UniverseData | null>(null)
  const [hub, setHub] = useState<HubData | null>(null)

  useEffect(() => {
    if (!universeId) return

    let active = true

    async function load() {
      const [mainRes, hubRes] = await Promise.all([
        fetch(`/api/zombie/universe?universeId=${encodeURIComponent(universeId)}`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/zombie/universe-hub?universeId=${encodeURIComponent(universeId)}`, { cache: 'no-store' }).catch(() => null),
      ])

      if (!active) return

      const nextMain = mainRes?.ok ? ((await mainRes.json()) as UniverseData) : null
      const nextHub = hubRes?.ok ? ((await hubRes.json()) as HubData) : null

      setData(nextMain)
      setHub(nextHub)
    }

    void load()

    return () => {
      active = false
    }
  }, [universeId])

  const levelCards = useMemo(() => {
    const levels = (data?.universe?.levels ?? []).slice().sort((a, b) => (b.rankOrder ?? 0) - (a.rankOrder ?? 0))
    return levels.map((level) => {
      const leagues = (data?.universe?.leagues ?? []).filter((league) => league.level?.name === level.name)
      let survivors = 0
      let zombies = 0

      for (const league of leagues) {
        for (const team of league.teams ?? []) {
          const status = (team.status ?? '').toLowerCase()
          if (status.includes('zombie')) zombies += 1
          if (status.includes('survivor') || status.includes('revived')) survivors += 1
        }
      }

      return {
        ...level,
        leagueCount: leagues.length,
        survivors,
        zombies,
      }
    })
  }, [data])

  const topRanked = data?.topRanked?.slice(0, 5) ?? []
  const counts = hub?.counts

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <Link href="/app/zombie-universe" className="inline-flex items-center gap-2 text-sm text-white/70 hover:text-white">
          <ChevronLeft className="h-4 w-4" />
          Universes
        </Link>
      </div>

      <header className="overflow-hidden rounded-[30px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.22),transparent_28%),radial-gradient(circle_at_top_right,rgba(245,158,11,0.10),transparent_32%),linear-gradient(180deg,rgba(14,15,20,0.98),rgba(10,11,15,0.98))] p-5 sm:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-rose-500/25 bg-rose-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-rose-100">
                Universe War Room
              </span>
              {data?.universe?.status ? (
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70">
                  {data.universe.status}
                </span>
              ) : null}
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-white sm:text-4xl">
              {data?.universe?.name ?? 'Zombie Universe'}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">
              Promotion and relegation pressure across every linked league, with live outbreak counts, movement stakes, and social storylines.
            </p>
          </div>

          <div className="grid min-w-full grid-cols-2 gap-3 sm:min-w-[420px] sm:grid-cols-4 xl:max-w-[500px]">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">Leagues</p>
              <p className="mt-2 text-2xl font-black text-white">{counts?.leagueCount ?? data?.universe?.leagues?.length ?? 0}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">Survivors</p>
              <p className="mt-2 text-2xl font-black text-emerald-200">{counts?.survivorCount ?? 0}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">Zombies</p>
              <p className="mt-2 text-2xl font-black text-rose-100">{counts?.zombieCount ?? 0}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">Whisperers</p>
              <p className="mt-2 text-2xl font-black text-amber-200">{counts?.whispererCount ?? 0}</p>
            </div>
          </div>
        </div>
      </header>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,20,27,0.96),rgba(10,11,15,0.98))] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">Tier Lanes</p>
              <h2 className="mt-2 text-xl font-black text-white">Alpha to Gamma pressure map</h2>
            </div>
            <RadioTower className="h-5 w-5 text-rose-200" />
          </div>

          <div className="mt-5 grid gap-3">
            {levelCards.map((level) => (
              <div key={level.id} className={`rounded-3xl border bg-gradient-to-r p-4 ${levelTone(level.rankOrder ?? 1)}`}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/45">Tier {level.rankOrder ?? 0}</p>
                    <h3 className="mt-1 text-xl font-black text-white">{level.name}</h3>
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:min-w-[320px]">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Leagues</p>
                      <p className="mt-2 text-lg font-black text-white">{level.leagueCount}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Alive</p>
                      <p className="mt-2 text-lg font-black text-emerald-200">{level.survivors}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">Horde</p>
                      <p className="mt-2 text-lg font-black text-rose-100">{level.zombies}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,20,27,0.96),rgba(10,11,15,0.98))] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">Top Survivors</p>
                <h2 className="mt-2 text-xl font-black text-white">Promotion heat</h2>
              </div>
              <Crown className="h-5 w-5 text-amber-200" />
            </div>
            <div className="mt-4 space-y-3">
              {topRanked.length ? (
                topRanked.map((row, index) => (
                  <div key={`${row.rosterId}-${index}`} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">Rank {index + 1}</p>
                        <p className="truncate text-sm font-semibold text-white">{row.displayName ?? row.rosterId}</p>
                        <p className="mt-1 text-xs text-white/55">{row.leagueName ?? 'Universe team'}</p>
                      </div>
                      <div className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-100">
                        {(row.currentSeasonPPW ?? 0).toFixed(1)} PPW
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-white/55">Universe stat leaders will appear here once season scoring data is available.</p>
              )}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,20,27,0.96),rgba(10,11,15,0.98))] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">Movement Stakes</p>
                <h2 className="mt-2 text-xl font-black text-white">What this universe is optimizing for</h2>
              </div>
              <TrendingUp className="h-5 w-5 text-sky-200" />
            </div>
            <div className="mt-4 space-y-3 text-sm text-white/70">
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                <p className="font-semibold text-white">Promotion</p>
                <p className="mt-1">Top managers should feel like they are climbing into a safer, richer tier rather than merely collecting stats.</p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                <p className="font-semibold text-white">Relegation</p>
                <p className="mt-1">Bottom managers should see the danger clearly with movement context and outbreak consequences on the same screen.</p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                <p className="font-semibold text-white">Storylines</p>
                <p className="mt-1">Chat, AI, and standings all orbit the same universe pressure instead of acting like separate tools.</p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTab('standings')}
          className={`inline-flex min-h-[44px] items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-medium transition ${
            tab === 'standings'
              ? 'border-rose-500/35 bg-rose-500/10 text-rose-100'
              : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
          }`}
        >
          <BarChart3 className="h-4 w-4" />
          Standings
        </button>
        <button
          type="button"
          onClick={() => setTab('forum')}
          className={`inline-flex min-h-[44px] items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-medium transition ${
            tab === 'forum'
              ? 'border-rose-500/35 bg-rose-500/10 text-rose-100'
              : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
          }`}
        >
          <MessageSquare className="h-4 w-4" />
          Forum
        </button>
        <button
          type="button"
          onClick={() => setTab('ai')}
          className={`inline-flex min-h-[44px] items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-medium transition ${
            tab === 'ai'
              ? 'border-rose-500/35 bg-rose-500/10 text-rose-100'
              : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
          }`}
        >
          <Sparkles className="h-4 w-4" />
          AI
        </button>
      </div>

      <section className="mt-4 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,20,27,0.96),rgba(10,11,15,0.98))] p-4 sm:p-5">
        {tab === 'standings' && universeId && <ZombieUniverseStandingsClient universeId={universeId} />}
        {tab === 'forum' && universeId && <ZombieUniverseForumClient universeId={universeId} />}
        {tab === 'ai' && universeId && <ZombieUniverseAIPanel universeId={universeId} />}
      </section>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/app/zombie-universe/${encodeURIComponent(universeId)}/standings`}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
        >
          <TrendingUp className="h-4 w-4" />
          Standings full page
        </Link>
        <Link
          href={`/app/zombie-universe/${encodeURIComponent(universeId)}/forum`}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
        >
          <Shield className="h-4 w-4" />
          Forum full page
        </Link>
      </div>
    </main>
  )
}
