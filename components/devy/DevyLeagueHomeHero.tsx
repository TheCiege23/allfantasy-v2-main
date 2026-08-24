'use client'

import { Crosshair, Sparkles, Telescope, Timer, Trophy } from 'lucide-react'

export type DevyLeagueHomeHeroProps = {
  leagueName: string
  sport: string
  season: number
  dynastyYear?: number
  isCommissioner: boolean
  onOpenSettings: () => void
  onOpenChat: () => void
}

/**
 * Premium devy league home strip — scouting / war-room aesthetic (glass, glow, depth).
 * Surfaces pipeline status chips. The dedicated /devy roster/pick pages are
 * build-excluded in production, so this strip must not link into them.
 */
export function DevyLeagueHomeHero({
  leagueName,
  sport,
  season,
  dynastyYear,
  isCommissioner,
  onOpenSettings,
  onOpenChat,
}: DevyLeagueHomeHeroProps) {
  const longYear = dynastyYear ?? season
  return (
    <section
      className="relative overflow-hidden border-b border-cyan-500/15 bg-gradient-to-br from-[#070f22] via-[#050915] to-[#03060f] px-4 py-5"
      data-testid="devy-league-home-hero"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 120% 80% at 50% -20%, rgba(56,189,248,0.35), transparent 55%), radial-gradient(ellipse 80% 50% at 100% 0%, rgba(167,139,250,0.2), transparent 50%)',
        }}
      />
      <div className="relative mx-auto flex max-w-5xl flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-cyan-400/35 bg-cyan-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-100">
              Devy
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/55">
              {String(sport).toUpperCase()}
            </span>
            <span className="text-[11px] text-white/45">
              Season {season} · Long-term {longYear}
            </span>
          </div>
          <h2 className="truncate text-2xl font-black tracking-tight text-white drop-shadow-[0_0_18px_rgba(34,211,238,0.25)] md:text-3xl">
            {leagueName}
          </h2>
          <p className="max-w-xl text-[13px] leading-relaxed text-white/60">
            Prospect pipeline, taxi stashes, and future draft capital — built for multi-year roster construction. Timer
            driven drafts; no separate &quot;slow draft&quot; type — use relaxed timers in settings.
          </p>
        </div>

        <div className="flex flex-shrink-0 flex-wrap gap-2 md:justify-end">
          <button
            type="button"
            onClick={onOpenChat}
            className="inline-flex items-center gap-2 rounded-xl border border-violet-400/30 bg-violet-500/15 px-3 py-2 text-[12px] font-bold text-violet-50 hover:bg-violet-500/25"
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            DM @chimmy
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.05] px-3 py-2 text-[12px] font-bold text-white/90 hover:bg-white/[0.09]"
          >
            <Telescope className="h-4 w-4 text-cyan-300" aria-hidden />
            League settings
          </button>
        </div>
      </div>

      <div className="relative mx-auto mt-5 grid max-w-5xl gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ['Rookie draft', 'Scheduled / settings', Trophy],
            ['Devy draft', 'Annual devy rounds', Crosshair],
            ['Prospect watch', 'Pool & filters', Telescope],
            ['Timers', 'Live vs relaxed pacing', Timer],
          ] as const
        ).map(([title, sub, Icon]) => (
          <div
            key={title}
            className="rounded-xl border border-white/[0.07] bg-white/[0.04] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md"
          >
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-cyan-300/90" aria-hidden />
              <p className="text-[12px] font-bold text-white">{title}</p>
            </div>
            <p className="mt-0.5 pl-6 text-[11px] text-white/45">{sub}</p>
          </div>
        ))}
      </div>

      <div className="relative mx-auto mt-4 flex max-w-5xl flex-wrap gap-3 text-[11px]">
        <span className="text-white/45">Devy roster &amp; future picks — dedicated pages not yet enabled.</span>
        {isCommissioner ? (
          <span className="text-amber-200/80">Commissioner: open Devy HQ in settings for full controls.</span>
        ) : null}
      </div>
    </section>
  )
}
