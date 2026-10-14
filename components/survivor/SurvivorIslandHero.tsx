'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { getSurvivorThemeById, survivorSceneArtwork } from '@/lib/survivor/survivorVisuals'

type SurvivorIslandHeroProps = {
  leagueId: string
  leagueName: string
  sport?: string | null
  week?: number | null
  phase: string
  visualThemeId?: string | null
  headline: string
  description: string
  primaryAction: { href: string; label: string }
  secondaryAction: { href: string; label: string }
}

/** The same island entry on the league dashboard and the full Survivor hub. */
export function SurvivorIslandHero({
  leagueId,
  leagueName,
  sport,
  week,
  phase,
  visualThemeId,
  headline,
  description,
  primaryAction,
  secondaryAction,
}: SurvivorIslandHeroProps) {
  const theme = getSurvivorThemeById(visualThemeId, leagueId)
  const scene = survivorSceneArtwork(sport, theme.id)

  return (
    <header className="relative isolate min-h-[330px] overflow-hidden rounded-[24px] border border-amber-300/25 bg-[#07110e] px-5 py-6 text-white shadow-[0_24px_70px_rgba(0,0,0,0.35)] sm:min-h-[390px] sm:px-8 sm:py-9" data-testid="survivor-island-hero">
      <div aria-hidden="true" className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${scene})` }} />
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-[#05100e]/95 via-[#05100e]/80 to-[#05100e]/25" />
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-[#05100e]/90 via-transparent to-[#05100e]/35" />
      <div className="relative flex min-h-[278px] flex-col justify-between sm:min-h-[318px]">
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em]">
          <span className="rounded-full border border-amber-300/35 bg-amber-950/55 px-3 py-1.5 text-amber-100">{sport ?? 'Fantasy'} island</span>
          <span className="rounded-full border border-white/20 bg-black/40 px-3 py-1.5 text-white/85">{phase.replace(/_/g, ' ')}</span>
          {week && week > 0 ? <span className="rounded-full border border-white/20 bg-black/40 px-3 py-1.5 text-white/85">Week {week}</span> : null}
        </div>
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-200/90">{leagueName}</p>
          <h1 className="mt-2 text-2xl font-black leading-tight tracking-tight sm:text-4xl">{headline}</h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/85 sm:text-base">{description}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link href={primaryAction.href} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-bold text-[#211508] transition-colors hover:bg-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200">
              {primaryAction.label}<ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link href={secondaryAction.href} className="inline-flex min-h-11 items-center rounded-xl border border-white/35 bg-black/40 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-black/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              {secondaryAction.label}
            </Link>
          </div>
        </div>
      </div>
    </header>
  )
}
