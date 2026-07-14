'use client'

/**
 * Premium league homepage hero.
 *
 * Sits at the top of `LeagueTab` (the default "home" tab) for every non-excluded
 * league type. Matches the create-league v2 cinematic design language:
 *   - Glassmorphism surface with inner shine
 *   - Accent-tinted ambient glow overlay that tracks the league type
 *   - Autoplay/loop/muted MP4 backdrop with onError fallback chain
 *   - At-a-glance stat cards (My Team / Record / Rank / Next Up)
 */

import { useRef } from 'react'
import type { UserLeague, LeagueTeamSlot } from '@/app/dashboard/types'
import type { AccentTone } from '@/lib/create-league-v2/theme'
import type { ResolvedLeagueMedia } from '@/lib/league-home/league-media-resolver'

export interface LeagueHomeHeroProps {
  league: UserLeague
  teams: LeagueTeamSlot[]
  accent: AccentTone
  media: ResolvedLeagueMedia
  /** Current user's team (from LeagueShell props). Null when user is a viewer or orphan. */
  userTeam?: { id: string; teamName?: string | null } | null
}

function labelForLeagueType(leagueType: string | null | undefined, variant?: string | null): string {
  const v = String(variant ?? '').toLowerCase()
  if (v === 'idp' || v === 'dynasty_idp') return 'IDP'
  if (v === 'devy_dynasty') return 'Devy'
  if (v === 'merged_devy_c2c') return 'C2C'
  if (v === 'guillotine') return 'Guillotine'
  if (v === 'zombie') return 'Zombie'
  if (v === 'salary_cap') return 'Salary Cap'

  const t = String(leagueType ?? 'redraft').toLowerCase()
  const map: Record<string, string> = {
    redraft: 'Redraft',
    dynasty: 'Dynasty',
    keeper: 'Keeper',
    best_ball: 'Best Ball',
    salary_cap: 'Salary Cap',
    survivor: 'Survivor',
    guillotine: 'Guillotine',
    tournament: 'Tournament',
    devy: 'Devy',
    c2c: 'C2C',
    zombie: 'Zombie',
    big_brother: 'Big Brother',
  }
  return map[t] ?? t
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string
  value: React.ReactNode
  accent: AccentTone
}) {
  return (
    <div className="glass-panel p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${accent.text}`}>{label}</p>
      <div className="mt-1 text-base font-bold text-primary sm:text-lg">{value}</div>
    </div>
  )
}

export function LeagueHomeHero({
  league,
  teams,
  accent,
  media,
  userTeam = null,
}: LeagueHomeHeroProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const fallbackTriedRef = useRef(false)

  const leagueWithType = league as UserLeague & { leagueType?: string | null }
  const typeLabel = labelForLeagueType(leagueWithType.leagueType ?? null, league.leagueVariant)
  const currentWeekDisplay =
    typeof league.currentWeek === 'number' && league.currentWeek > 0
      ? `Week ${league.currentWeek}`
      : null
  const seasonDisplay = league.season != null ? String(league.season) : null

  // User team + record
  const myTeam =
    (userTeam && teams.find((t) => t.id === userTeam.id)) ??
    teams.find((t) => t.claimedByUserId && t.claimedByUserId === userTeam?.id) ??
    null
  const myTeamName = myTeam?.teamName ?? userTeam?.teamName ?? 'Unclaimed'
  const myRecord = myTeam
    ? myTeam.ties > 0
      ? `${myTeam.wins}-${myTeam.losses}-${myTeam.ties}`
      : `${myTeam.wins}-${myTeam.losses}`
    : '—'
  const myRank = myTeam?.currentRank != null ? `#${myTeam.currentRank}` : '—'

  return (
    <section
      className="relative mb-5 overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-b from-white/[0.06] to-white/[0.02] shadow-[0_24px_80px_-20px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.06)]"
    >
      {/* Ambient video backdrop */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <video
          ref={videoRef}
          key={media.primary}
          className="h-full w-full object-cover opacity-40"
          src={media.primary}
          poster={media.poster}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          aria-hidden
          onError={() => {
            const el = videoRef.current
            if (!el || fallbackTriedRef.current) return
            fallbackTriedRef.current = true
            if (media.fallback && el.src !== window.location.origin + media.fallback) {
              el.src = media.fallback
              el.load()
            }
          }}
        />
        {/* Accent-tinted gradient + dark vignette for readability */}
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(180deg, rgba(6,10,24,0.30) 0%, rgba(6,10,24,0.75) 60%, rgba(6,10,24,0.95) 100%), radial-gradient(80% 80% at 50% 0%, ${accent.hex}22, transparent 70%)`,
          }}
          aria-hidden
        />
      </div>

      <div className="relative z-10 p-5 sm:p-7">
        {/* Breadcrumb / status chip */}
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/80 backdrop-blur-md"
            style={{ boxShadow: `0 0 16px -6px ${accent.hex}` }}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: accent.hex, boxShadow: `0 0 8px ${accent.hex}` }}
              aria-hidden
            />
            <span className={accent.text}>{typeLabel}</span>
            {currentWeekDisplay ? <span className="text-white/50">· {currentWeekDisplay}</span> : null}
            {seasonDisplay ? <span className="text-white/40">· {seasonDisplay}</span> : null}
          </span>
        </div>

        {/* Title + meta */}
        <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">
          {league.name}
        </h1>
        <p className="mt-1 text-sm text-white/55">
          <span className="font-semibold text-white/75">{league.sport}</span>
          <span className="mx-1.5 text-white/30">·</span>
          <span>{league.format}</span>
          <span className="mx-1.5 text-white/30">·</span>
          <span>
            {league.teamCount} {league.teamCount === 1 ? 'team' : 'teams'}
          </span>
          {league.isDynasty ? (
            <>
              <span className="mx-1.5 text-white/30">·</span>
              <span className={accent.text}>Dynasty</span>
            </>
          ) : null}
        </p>

        {/* Stat cards */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="My Team"
            value={<span className="truncate block">{myTeamName}</span>}
            accent={accent}
          />
          <StatCard label="Record" value={myRecord} accent={accent} />
          <StatCard label="Rank" value={myRank} accent={accent} />
          <StatCard
            label="Next Up"
            value={
              <span className="text-sm font-medium text-white/70">
                Matchup coming soon
              </span>
            }
            accent={accent}
          />
        </div>
      </div>
    </section>
  )
}
