'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, ChevronRight, Layers3, RadioTower, Shield, Skull, Trophy } from 'lucide-react'

interface UniverseRow {
  id: string
  name: string
  sport: string
  tierCount?: number
  status?: string
  leagueCount?: number
}

function statusTone(status?: string) {
  const value = (status ?? '').toLowerCase()
  if (value === 'active') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100'
  if (value === 'locked') return 'border-amber-500/20 bg-amber-500/10 text-amber-100'
  return 'border-white/10 bg-white/5 text-white/75'
}

export default function ZombieUniverseListPage() {
  const [universes, setUniverses] = useState<UniverseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const res = await fetch('/api/zombie-universe', { cache: 'no-store' })
        if (!active) return
        if (!res.ok) {
          setError('Failed to load universes')
          setUniverses([])
          return
        }
        const data = await res.json()
        setUniverses(Array.isArray(data.universes) ? data.universes : [])
      } catch {
        if (active) setError('Request failed')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [])

  const totals = useMemo(() => {
    return universes.reduce(
      (acc, universe) => {
        acc.tiers += universe.tierCount ?? 0
        acc.leagues += universe.leagueCount ?? 0
        return acc
      },
      { tiers: 0, leagues: 0 },
    )
  }, [universes])

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <header className="overflow-hidden rounded-[30px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.22),transparent_28%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.14),transparent_30%),linear-gradient(180deg,rgba(14,15,20,0.98),rgba(10,11,15,0.98))] p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-rose-500/30 bg-rose-950/30">
              <Skull className="h-8 w-8 text-rose-300" />
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-white sm:text-4xl">Zombie Universe</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">
              Promotion, relegation, outbreak pressure, and league-level chaos across your connected Zombie worlds.
            </p>
            <div className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100">
              Live apocalypse simulation layered on fantasy sports
              <ArrowUpRight className="h-4 w-4" />
            </div>
          </div>

          <div className="grid gap-3 sm:min-w-[360px] sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">Universes</p>
              <p className="mt-2 text-2xl font-black text-white">{universes.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">Leagues</p>
              <p className="mt-2 text-2xl font-black text-white">{totals.leagues}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">Tiers</p>
              <p className="mt-2 text-2xl font-black text-white">{totals.tiers}</p>
            </div>
          </div>
        </div>
      </header>

      {loading && (
        <div className="flex min-h-[220px] items-center justify-center">
          <p className="text-sm text-white/50">Loading universes...</p>
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-950/20 p-4">
          <p className="text-sm text-amber-200">{error}</p>
        </div>
      )}

      {!loading && !error && universes.length === 0 && (
        <div className="mt-6 rounded-[28px] border border-white/10 bg-white/[0.03] p-6 text-center">
          <p className="text-base font-semibold text-white">No Zombie universes are linked to your account yet.</p>
          <p className="mt-2 text-sm text-white/55">Join a Zombie league that belongs to a universe and it will appear here automatically.</p>
          <Link
            href="/app/discover"
            className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/15"
          >
            Discover leagues
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      {!loading && !error && universes.length > 0 && (
        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          {universes.map((universe) => (
            <Link
              key={universe.id}
              href={`/app/zombie-universe/${encodeURIComponent(universe.id)}`}
              className="group rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,20,27,0.96),rgba(10,11,15,0.98))] p-5 transition hover:border-rose-400/25 hover:bg-[linear-gradient(180deg,rgba(26,18,20,0.98),rgba(12,11,15,0.98))]"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] ${statusTone(universe.status)}`}>
                    {universe.status ?? 'draft'}
                  </div>
                  <h2 className="mt-3 truncate text-2xl font-black text-white">{universe.name}</h2>
                  <p className="mt-2 text-sm text-white/60">{universe.sport}</p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-white/35 transition group-hover:text-white/80" />
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3">
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                  <div className="flex items-center gap-2 text-white/45">
                    <Layers3 className="h-4 w-4" />
                    <span className="text-[11px] uppercase tracking-[0.18em]">Tiers</span>
                  </div>
                  <p className="mt-2 text-lg font-black text-white">{universe.tierCount ?? 0}</p>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                  <div className="flex items-center gap-2 text-white/45">
                    <RadioTower className="h-4 w-4" />
                    <span className="text-[11px] uppercase tracking-[0.18em]">Leagues</span>
                  </div>
                  <p className="mt-2 text-lg font-black text-white">{universe.leagueCount ?? 0}</p>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                  <div className="flex items-center gap-2 text-white/45">
                    {universe.status === 'active' ? <Shield className="h-4 w-4" /> : <Trophy className="h-4 w-4" />}
                    <span className="text-[11px] uppercase tracking-[0.18em]">Mode</span>
                  </div>
                  <p className="mt-2 text-sm font-bold text-white">{universe.status === 'active' ? 'Live' : 'Staged'}</p>
                </div>
              </div>
            </Link>
          ))}
        </section>
      )}
    </main>
  )
}
