'use client'

import { useState, useEffect, useCallback } from 'react'
import clsx from 'clsx'
import Link from 'next/link'
import {
  Skull,
  MessageSquare,
  Settings,
  Sparkles,
  ChevronDown,
  FileText,
  ExternalLink,
  Biohazard,
  Radio,
} from 'lucide-react'
import type { ZombieSummary, ZombieView } from './types'
import { ZOMBIE_ITEM_ICON, ZOMBIE_STATUS_ICON } from '@/lib/zombie/iconSystem'
import { ZombieWhispererCard } from './ZombieWhispererCard'
import { ZombieSurvivorsList } from './ZombieSurvivorsList'
import { ZombieZombiesList } from './ZombieZombiesList'
import { ZombieWinningsSummary } from './ZombieWinningsSummary'
import { ZombieResourcesSummary } from './ZombieResourcesSummary'
import { ZombieChompinBlock } from './ZombieChompinBlock'
import { ZombieMovementOutlook } from './ZombieMovementOutlook'
import { ZombieWeeklyBoard } from './ZombieWeeklyBoard'
import { ZombieResourcesView } from './ZombieResourcesView'
import { ZombieAmbushBoard } from './ZombieAmbushBoard'
import { ZombieAIPanel } from './ZombieAIPanel'

const VIEW_LABELS: Record<ZombieView, string> = {
  home: 'Home',
  resources: 'Resources',
  ambush: 'Ambush & Matchups',
  'weekly-board': 'Weekly Board',
  ai: 'AI Tools',
}

export interface ZombieHomeProps {
  leagueId: string
}

export function ZombieHome({ leagueId }: ZombieHomeProps) {
  const [summary, setSummary] = useState<ZombieSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ZombieView>('home')
  const [week, setWeek] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/zombie/summary?week=${week}`,
        { cache: 'no-store' }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError((data as { error?: string }).error ?? `Error ${res.status}`)
        setSummary(null)
        return
      }
      const data = await res.json()
      setSummary(data)
    } catch {
      setError('Failed to load Zombie summary')
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [leagueId, week])

  useEffect(() => {
    load()
  }, [load])

  if (loading && !summary) {
    return (
      <div className="zombie-glass flex min-h-[200px] items-center justify-center rounded-2xl border border-white/[0.09] p-8">
        <p className="text-sm text-white/65">Loading outbreak data…</p>
      </div>
    )
  }

  if (error && !summary) {
    return (
      <div className="rounded-2xl border border-red-500/35 bg-red-950/25 p-4">
        <p className="text-sm text-red-100">{error}</p>
        <button
          type="button"
          onClick={() => load()}
          className="mt-2 text-xs font-medium text-cyan-300 hover:underline"
        >
          Retry
        </button>
      </div>
    )
  }

  const names = summary?.rosterDisplayNames ?? {}

  const itemEmojiStrip = Object.values(ZOMBIE_ITEM_ICON).join(' ')

  return (
    <div className="space-y-6 text-[var(--zombie-text-full)]">
      <header className="zombie-hero-shell relative overflow-hidden border border-white/10 shadow-[0_18px_60px_rgba(0,0,0,0.4)]">
        <div className="zombie-hero-fog opacity-80" aria-hidden />
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_15%_0%,rgba(74,222,128,0.12),transparent_55%),linear-gradient(180deg,rgba(8,10,18,0.92),rgba(4,5,10,0.98))]"
          aria-hidden
        />
        <div className="relative z-[1] p-4 sm:p-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--zombie-toxic)]/35 bg-black/35 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--zombie-toxic)]">
              <Radio className="h-3 w-3" aria-hidden />
              League embed
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[var(--zombie-toxic)]/35 bg-black/45 sm:h-16 sm:w-16">
              <Skull className="h-7 w-7 text-[var(--zombie-toxic)] sm:h-8 sm:w-8" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-black tracking-tight text-white sm:text-2xl">Zombie League</h1>
              <p className="text-sm text-white/72">
                Tactical chaos · Whisperer · Horde · serums · weapons · ambushes — stay human or join the swarm.
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-white/45" title="Status keys">
                {ZOMBIE_STATUS_ICON.survivor} Survivor · {ZOMBIE_STATUS_ICON.whisperer} Whisperer ·{' '}
                {ZOMBIE_STATUS_ICON.zombie} Zombie · {ZOMBIE_STATUS_ICON.revived_survivor} Revived
              </p>
              <p className="mt-1 text-[11px] text-white/38" title="Serums, weapons, ambush">
                {itemEmojiStrip}
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Quick links — command-center accents */}
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/league/${leagueId}?tab=Chat`}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-950/30 px-4 py-2 text-sm font-semibold text-cyan-50 ring-1 ring-inset ring-cyan-400/25 transition hover:bg-cyan-950/50"
        >
          <MessageSquare className="h-4 w-4 shrink-0" /> League Chat (@Chimmy)
        </Link>
        <Link
          href={`/zombie/${leagueId}`}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl border border-[var(--zombie-toxic)]/35 bg-emerald-950/20 px-4 py-2 text-sm font-semibold text-emerald-50 ring-1 ring-inset ring-[var(--zombie-toxic)]/25 transition hover:bg-emerald-950/40"
        >
          <ExternalLink className="h-4 w-4 shrink-0" /> Full Zombie hub
        </Link>
        <Link
          href={`/zombie/${leagueId}/rules`}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white/88 transition hover:bg-white/10"
        >
          <FileText className="h-4 w-4 shrink-0" /> Rules (no waivers · zombie trade limits)
        </Link>
        <Link
          href={`/league/${leagueId}?tab=Settings`}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white/88 transition hover:bg-white/10"
        >
          <Settings className="h-4 w-4 shrink-0" /> Settings
        </Link>
        <Link
          href={`/league/${leagueId}?tab=Intelligence`}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl border border-fuchsia-500/28 bg-fuchsia-950/25 px-4 py-2 text-sm font-semibold text-fuchsia-100 ring-1 ring-inset ring-fuchsia-400/20 transition hover:bg-fuchsia-950/45"
        >
          <Sparkles className="h-4 w-4 shrink-0" /> Storyline & AI
        </Link>
        {summary?.myRosterId && (
          <Link
            href={`/app/zombie-universe`}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl border border-amber-500/35 bg-amber-950/25 px-4 py-2 text-sm font-semibold text-amber-50 ring-1 ring-inset ring-amber-400/25 transition hover:bg-amber-950/45"
          >
            <Biohazard className="h-4 w-4 shrink-0" /> Universe (Alpha / Beta / Gamma)
          </Link>
        )}
      </div>

      <section className="zombie-glass zombie-panel-shine relative rounded-2xl border border-cyan-500/20 p-4 sm:p-5">
        <h2 className="text-sm font-bold text-cyan-100">@Chimmy — items & ambush</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-white/58">
          The engine validates timing and inventory. After a Whisperer ambush, the commissioner can remap matchups for
          that week in{' '}
          <span className="text-cyan-200/90">Commissioner → Zombie → Combat / Ambush</span> if your league allows it.
        </p>
        <ul className="mt-3 space-y-1.5 text-[12px] text-white/72">
          <li>
            <span className="font-medium text-violet-200/90">Ambush:</span> @Chimmy ambush steal · horde boost · swap matchup …
          </li>
          <li>
            <span className="font-medium text-teal-200/90">Serum:</span> @Chimmy serum … (antidote / revive flow per rules)
          </li>
          <li>
            <span className="font-medium text-amber-200/90">Weapons:</span> @Chimmy knife · bow · axe · gun · bomb / dynamite
          </li>
          <li>
            <span className="font-medium text-fuchsia-200/90">Whisperer:</span> @Chimmy activate … (dark whisper / infection override …)
          </li>
        </ul>
      </section>

      {/* Week selector */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-white/50">Week</label>
        <select
          value={week}
          onChange={(e) => setWeek(Math.max(1, parseInt(e.target.value, 10) || 1))}
          className="rounded-xl border border-white/15 bg-black/30 py-2 pl-3 pr-8 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
        >
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </div>

      {/* View switcher */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-white/50 sm:hidden">View:</span>
        <div className="relative sm:hidden">
          <select
            value={view}
            onChange={(e) => setView(e.target.value as ZombieView)}
            className="rounded-xl border border-white/15 bg-black/30 py-2 pl-3 pr-8 text-sm text-white appearance-none focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
          >
            {(Object.keys(VIEW_LABELS) as ZombieView[]).map((v) => (
              <option key={v} value={v}>
                {VIEW_LABELS[v]}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
        </div>
        <div className="hidden flex-wrap gap-1 sm:flex">
          {(Object.keys(VIEW_LABELS) as ZombieView[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={clsx(
                'rounded-xl border px-3 py-2 text-sm font-semibold transition',
                view === v
                  ? 'border-cyan-500/35 bg-cyan-500/15 text-cyan-50 shadow-[0_0_20px_rgba(34,211,238,0.12)]'
                  : 'border-white/10 bg-white/[0.04] text-white/70 hover:border-white/15 hover:bg-white/[0.07]',
              )}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
      </div>

      {/* Panel content */}
      {view === 'home' && summary && (
        <div className="space-y-6">
          <div className="grid gap-6 sm:grid-cols-2">
            <ZombieWhispererCard
              whispererRosterId={summary.whispererRosterId}
              hidden={summary.whispererHidden === true}
              displayNames={names}
            />
            <ZombieResourcesSummary
              serums={summary.myResources?.serums}
              weapons={summary.myResources?.weapons}
              ambushCount={summary.myResources?.ambush}
            />
          </div>
          <ZombieSurvivorsList survivors={summary.survivors} displayNames={names} />
          <ZombieZombiesList zombies={summary.zombies} displayNames={names} />
          <ZombieWinningsSummary myRosterId={summary.myRosterId} />
          <ZombieChompinBlock candidates={[]} displayNames={names} week={summary.week} />
          <ZombieMovementOutlook movementWatch={summary.movementWatch} displayNames={names} />
          <ZombieWeeklyBoard leagueId={leagueId} week={summary.week} />
        </div>
      )}
      {view === 'resources' && summary && (
        <ZombieResourcesView
          serums={summary.myResources?.serums ?? 0}
          weapons={summary.myResources?.weapons ?? 0}
          ambushCount={summary.myResources?.ambush ?? 0}
          bombAvailable={false}
          serumReviveCount={summary.config.serumReviveCount}
          displayNames={names}
        />
      )}
      {view === 'ambush' && summary && (
        <ZombieAmbushBoard
          leagueId={leagueId}
          week={summary.week}
          matchups={[]}
          displayNames={names}
        />
      )}
      {view === 'weekly-board' && summary && (
        <ZombieWeeklyBoard leagueId={leagueId} week={summary.week} />
      )}
      {view === 'ai' && summary && (
        <ZombieAIPanel leagueId={leagueId} summary={summary} displayNames={names} />
      )}
    </div>
  )
}
