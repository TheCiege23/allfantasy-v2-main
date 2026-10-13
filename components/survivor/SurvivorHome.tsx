'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Flame, MessageSquare, Settings, Sparkles, Zap, ChevronDown, Users } from 'lucide-react'
import type { SurvivorSummary, SurvivorView } from './types'
import { SurvivorTribeBoard } from './SurvivorTribeBoard'
import { SurvivorChallengeCenter } from './SurvivorChallengeCenter'
import { SurvivorTribalCouncilView } from './SurvivorTribalCouncilView'
import { SurvivorIdolsView } from './SurvivorIdolsView'
import { SurvivorExileView } from './SurvivorExileView'
import { SurvivorMergeJuryView } from './SurvivorMergeJuryView'
import { SurvivorAIPanel } from './SurvivorAIPanel'
import { SurvivorFirstEntryModal } from './SurvivorFirstEntryModal'
import {
  EXILE_ISLAND_RULES,
  SURVIVOR_CONDUCT_BULLETS,
  SURVIVOR_ISLAND_TAGLINE,
  SURVIVOR_TOKEN_POOL_BLURB,
  SURVIVOR_TIPS,
  SURVIVOR_WELCOME_BLURB,
} from '@/lib/survivor/survivorIslandContent'
import { getSurvivorThemeById, survivorSceneArtwork } from '@/lib/survivor/survivorVisuals'

const VIEW_LABELS: Record<SurvivorView, string> = {
  'tribe-board': 'Tribe Board',
  challenge: 'Challenge Center',
  council: 'Elimination Council',
  idols: 'Idols & Advantages',
  exile: 'Exile Island',
  'merge-jury': 'Merge & Jury',
  ai: 'AI Host',
}

export interface SurvivorHomeProps {
  leagueId: string
}

export function SurvivorHome({ leagueId }: SurvivorHomeProps) {
  const [summary, setSummary] = useState<SurvivorSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<SurvivorView>('tribe-board')
  const [showIntro, setShowIntro] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/summary`, { cache: 'no-store' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Error ${res.status}`)
        setSummary(null)
        return
      }
      const data = await res.json()
      setSummary(data)
    } catch {
      setError('Failed to load Survivor summary')
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (summary) {
      setShowIntro(true)
    }
  }, [summary])

  if (loading && !summary) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] p-8">
        <p className="text-sm text-white/60">Loading Survivor League…</p>
      </div>
    )
  }

  if (error && !summary) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4">
        <p className="text-sm text-amber-200">{error}</p>
        <button type="button" onClick={() => load()} className="mt-2 text-xs text-cyan-400 hover:underline">
          Retry
        </button>
      </div>
    )
  }

  const names = summary?.rosterDisplayNames ?? {}
  const cal = summary?.seasonCalendar
  const themeHeadline =
    summary?.config?.seasonThemeLabel?.trim() ||
    summary?.leagueName || 'Survivor League'
  const tribeChatHref = summary?.myTribeSource
    ? `/league/${leagueId}?tab=Chat&source=${encodeURIComponent(summary.myTribeSource)}`
    : `/league/${leagueId}?tab=Chat`
  const theme = getSurvivorThemeById(summary?.config?.visualThemeId, leagueId)

  return (
    <div className={`relative overflow-hidden rounded-[28px] ${theme.backgroundClass} p-4 sm:p-5` }>
      <SurvivorFirstEntryModal
        leagueId={leagueId}
        userId={summary?.myRosterId ?? 'viewer'}
        enabled={showIntro}
        onClose={() => setShowIntro(false)}
        visualThemeId={summary?.config?.visualThemeId}
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent_25%,rgba(0,0,0,0.28)_100%)] opacity-40" />
      <div className="relative space-y-6">
      {/* Survivor branding header */}
      <header className="relative flex min-h-48 flex-wrap items-center gap-4 overflow-hidden rounded-2xl border border-amber-200/20 bg-[#08110e] p-4 sm:p-6">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-55" style={{ backgroundImage: `url(${survivorSceneArtwork(cal?.sport, theme.id)})` }} />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#07100e]/95 via-[#07100e]/70 to-[#07100e]/20" />
        <div className="relative flex w-full flex-wrap items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-950/30 sm:h-20 sm:w-20">
          <Flame className="h-8 w-8 text-amber-400 sm:h-10 sm:w-10" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-white sm:text-2xl">{themeHeadline}</h1>
          <p className="mt-1 text-sm text-amber-100/85">{SURVIVOR_ISLAND_TAGLINE}</p>
          {cal && (
            <p className="mt-2 text-xs text-cyan-200/80">
              Regular-season weeks (no playoffs): {cal.firstWeek}–{cal.lastWeek} · {cal.sport}
            </p>
          )}
          <p className="mt-2 text-xs text-amber-100/80">
            {summary?.tribes?.some((tribe) => tribe.members.length > 0)
              ? `${summary.tribes.length} tribes · ${summary.merged ? 'Merged island' : 'Tribes formed'}`
              : `${summary?.config?.tribeCount ?? 4} tribes planned · Members are assigned after the draft`}
          </p>
          <p className="mt-2 text-sm text-white/60">
            Tribes · Challenges · Elimination Council · Idols · Exile · Merge & Jury
          </p>
        </div>
        </div>
      </header>

      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-white">How this league works</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/70">{SURVIVOR_WELCOME_BLURB}</p>
        <details className="mt-4 rounded-xl border border-white/[0.08] bg-black/20 p-3">
          <summary className="cursor-pointer text-sm font-medium text-cyan-200/95">
            Tips & conduct
          </summary>
          <ul className="mt-3 list-inside list-disc space-y-1.5 text-sm text-white/65">
            {SURVIVOR_TIPS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <ul className="mt-3 list-inside list-disc space-y-1.5 text-sm text-white/65">
            {SURVIVOR_CONDUCT_BULLETS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </details>
        <details className="mt-3 rounded-xl border border-cyan-500/15 bg-cyan-950/10 p-3">
          <summary className="cursor-pointer text-sm font-medium text-cyan-100/95">
            Token Pool & Exile (read before you’re voted out)
          </summary>
          <p className="mt-3 text-sm text-white/70">{SURVIVOR_TOKEN_POOL_BLURB}</p>
          <p className="mt-2 text-sm font-medium text-white/85">{EXILE_ISLAND_RULES.headline}</p>
          <p className="mt-1 text-sm text-white/65">{EXILE_ISLAND_RULES.intro}</p>
          <p className="mt-2 text-sm text-white/65">{cal?.sport === 'NBA'
            ? 'Each week starts with an empty Exile roster. Claim an NBA point guard to reserve that real-world team, then claim only that team’s players. All players return to waivers after the week.'
            : EXILE_ISLAND_RULES.lineup}</p>
          <p className="mt-2 text-sm text-white/65">{EXILE_ISLAND_RULES.tokens}</p>
          <p className="mt-2 text-sm text-white/65">{EXILE_ISLAND_RULES.bossReset}</p>
          <p className="mt-2 text-sm text-amber-100/80">{EXILE_ISLAND_RULES.conduct}</p>
        </details>
      </section>

      {/* Quick links: Chat, Tribe chat entry, Settings, AI, Waivers */}
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/league/${leagueId}?tab=Chat`}
          className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-950/30 px-4 py-2 text-sm text-cyan-200 hover:bg-cyan-950/50"
        >
          <MessageSquare className="h-4 w-4" /> League Chat
        </Link>
        <Link
          href={tribeChatHref}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 hover:bg-white/10"
        >
          <Users className="h-4 w-4" /> Tribe Chat
        </Link>
        <Link
          href={`/league/${leagueId}?tab=Settings`}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 hover:bg-white/10"
        >
          <Settings className="h-4 w-4" /> Settings
        </Link>
        <Link
          href={`/league/${leagueId}?tab=Intelligence`}
          className="inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-2 text-sm text-amber-200 hover:bg-amber-950/50"
        >
          <Sparkles className="h-4 w-4" /> AI Host
        </Link>
        <Link
          href={`/league/${leagueId}?tab=Waivers`}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 hover:bg-white/10"
        >
          <Zap className="h-4 w-4" /> Waivers
        </Link>
      </div>

      {/* View switcher (mobile dropdown, desktop tabs) */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-white/50 sm:hidden">View:</span>
        <div className="relative sm:hidden">
          <select
            value={view}
            onChange={(e) => setView(e.target.value as SurvivorView)}
            className="rounded-xl border border-white/20 bg-white/5 py-2 pl-3 pr-8 text-sm text-white appearance-none focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          >
            {(Object.keys(VIEW_LABELS) as SurvivorView[]).map((v) => (
              <option key={v} value={v}>
                {VIEW_LABELS[v]}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
        </div>
        <div className="hidden flex-wrap gap-1 sm:flex">
          {(Object.keys(VIEW_LABELS) as SurvivorView[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                view === v ? 'bg-amber-500/20 text-amber-200' : 'bg-white/5 text-white/70 hover:bg-white/10'
              }`}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
      </div>

      {/* Panel content */}
      {view === 'tribe-board' && summary && (
        <SurvivorTribeBoard leagueId={leagueId} summary={summary} names={names} />
      )}
      {view === 'challenge' && summary && (
        <SurvivorChallengeCenter leagueId={leagueId} summary={summary} names={names} />
      )}
      {view === 'council' && summary && (
        <SurvivorTribalCouncilView leagueId={leagueId} summary={summary} names={names} />
      )}
      {view === 'idols' && summary && (
        <SurvivorIdolsView leagueId={leagueId} summary={summary} names={names} />
      )}
      {view === 'exile' && summary && (
        <SurvivorExileView leagueId={leagueId} summary={summary} names={names} />
      )}
      {view === 'merge-jury' && summary && (
        <SurvivorMergeJuryView leagueId={leagueId} summary={summary} names={names} onRefresh={load} />
      )}
      {view === 'ai' && summary && (
        <SurvivorAIPanel leagueId={leagueId} summary={summary} names={names} />
      )}
      </div>
    </div>
  )
}
