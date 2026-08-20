'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Crown, LayoutGrid, MessageSquare, Settings, Shield, Trophy, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import { leagueTabSportEmoji } from '@/app/league/[leagueId]/LeagueTabs'
import { KingBuffaloPresentedBy } from '@/components/tournament/KingBuffaloPresentedBy'
import type { BigBrotherSummary } from '@/components/big-brother/types'

export type TournamentHeroContext = {
  tournamentId: string
  tournamentName: string
  conferenceName: string
  conferenceTheme: string
  roundIndex: number
  phase: string
  roundRules?: { benchSpots: number; faabReset: boolean; faabBudget: number }
  theme?: {
    bannerUrl: string | null
    themePack: string
    accentColor: string | null
    glowAccent: string | null
    badgeStyle: string | null
  } | null
}

type SurvivorSummary = {
  currentWeek: number
  merged: boolean
  tribes: { id: string; name: string }[]
  council: {
    phase: string
    voteDeadlineAt: string | null
    closedAt?: string | null
  } | null
  challenges: {
    id: string
    lockAt: string | null
    resultJson: unknown
    challengeType: string
  }[]
  exileLeagueId: string | null
  jury: { rosterId: string }[]
  rosterDisplayNames: Record<string, string>
  finale?: { open: boolean; closed: boolean } | null
}

function useCountdown(targetIso: string | null) {
  const [label, setLabel] = useState<string | null>(null)
  const [urgent, setUrgent] = useState(false)

  useEffect(() => {
    if (!targetIso) {
      setLabel(null)
      setUrgent(false)
      return
    }
    const target = new Date(targetIso).getTime()
    if (!Number.isFinite(target)) {
      setLabel(null)
      return
    }
    const tick = () => {
      const now = Date.now()
      const ms = target - now
      if (ms <= 0) {
        setLabel('Now')
        setUrgent(true)
        return
      }
      const s = Math.floor(ms / 1000)
      const d = Math.floor(s / 86400)
      const h = Math.floor((s % 86400) / 3600)
      const m = Math.floor((s % 3600) / 60)
      const sec = s % 60
      if (d > 0) setLabel(`${d}d ${h}h ${m}m`)
      else if (h > 0) setLabel(`${h}h ${m}m ${sec}s`)
      else setLabel(`${m}m ${sec}s`)
      setUrgent(ms < 3600000)
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [targetIso])

  return { label, urgent }
}

function HeroQuickButton({
  children,
  onClick,
  href,
  icon: Icon,
}: {
  children: React.ReactNode
  onClick?: () => void
  href?: string
  icon: React.ComponentType<{ className?: string }>
}) {
  const cls = cn(
    'inline-flex items-center gap-1.5 rounded-xl border border-white/[0.12] bg-black/35 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition hover:border-[#ff3d81]/35 hover:bg-[#ff3d81]/10 hover:text-[#ffd7e5]',
  )
  if (href) {
    return (
      <Link href={href} className={cls}>
        <Icon className="h-3.5 w-3.5 opacity-90" />
        {children}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      <Icon className="h-3.5 w-3.5 opacity-90" />
      {children}
    </button>
  )
}

type Props = {
  leagueId: string
  leagueName: string
  sport: string
  season: number
  teamCount: number
  teamsFilled: number
  variant: 'tournament' | 'survivor' | 'big_brother'
  /** Pre-fetched tournament hub context (LeagueShell loads once). */
  tournamentContext: TournamentHeroContext | null
  draftDateIso: string | null
  rightRailCollapsed: boolean
  isCommissioner: boolean
  isHeadCommissioner: boolean
  onOpenDraftTab: () => void
  onOpenStandingsTab: () => void
  onOpenChat: () => void
  onOpenSettings: () => void
  onOpenCommissionerSettings: () => void
}

export function SpecialtyLeagueHomeHero({
  leagueId,
  leagueName,
  sport,
  season,
  teamCount,
  teamsFilled,
  variant,
  tournamentContext,
  draftDateIso,
  rightRailCollapsed,
  isCommissioner,
  isHeadCommissioner,
  onOpenDraftTab,
  onOpenStandingsTab,
  onOpenChat,
  onOpenSettings,
  onOpenCommissionerSettings,
}: Props) {
  const [survivor, setSurvivor] = useState<SurvivorSummary | null>(null)
  const [bb, setBb] = useState<BigBrotherSummary | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (variant === 'survivor') {
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/summary`, { cache: 'no-store' })
        if (!res.ok) throw new Error('summary')
        const data = await res.json()
        setSurvivor(data)
        setLoadErr(null)
      } catch {
        setLoadErr('Could not load island state')
        setSurvivor(null)
      }
    } else if (variant === 'big_brother') {
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/big-brother/summary`, { cache: 'no-store' })
        if (!res.ok) throw new Error('summary')
        const data = await res.json()
        setBb(data as BigBrotherSummary)
        setLoadErr(null)
      } catch {
        setLoadErr('Could not load house state')
        setBb(null)
      }
    }
  }, [leagueId, variant])

  useEffect(() => {
    if (variant === 'tournament') return
    load()
  }, [load, variant])

  const draftCountdown = useCountdown(draftDateIso)
  const [reduceMotion, setReduceMotion] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduceMotion(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const survivorPhase = useMemo(() => {
    if (!survivor) return { label: '…', mood: 'default' as const }
    const w = survivor.currentWeek
    if (survivor.finale?.open || survivor.finale?.closed) return { label: 'Finale', mood: 'jury' as const }
    if (survivor.jury.length > 0 && survivor.merged) return { label: `Jury · Week ${w}`, mood: 'jury' as const }
    if (survivor.council?.phase === 'voting_open' || survivor.council?.phase === 'votes_tallying')
      return { label: 'Tribal Council', mood: 'tribal' as const }
    if (survivor.merged) return { label: `Merge · Week ${w}`, mood: 'merge' as const }
    if (survivor.exileLeagueId) return { label: `Island · Week ${w}`, mood: 'exile' as const }
    return { label: `Tribe Phase · Week ${w}`, mood: 'default' as const }
  }, [survivor])

  const tribalDeadline =
    survivor?.council?.voteDeadlineAt && !survivor.council?.closedAt ? survivor.council.voteDeadlineAt : null
  const tribalCd = useCountdown(tribalDeadline)

  const activeChallenge = survivor?.challenges?.find((c) => !c.resultJson && c.lockAt)
  const challengeCd = useCountdown(activeChallenge?.lockAt ?? null)

  const evictionDeadline =
    bb?.cycle?.voteDeadlineAt && !bb?.ballot?.closed ? bb.cycle.voteDeadlineAt : null
  const evictionCd = useCountdown(evictionDeadline)

  const tribeName = survivor?.merged
    ? 'Merged Tribe'
    : survivor?.tribes?.[0]?.name
      ? survivor.tribes.map((t) => t.name).join(' · ')
      : 'Tribes forming'

  const bbPhaseLabel = useMemo(() => {
    if (!bb?.cycle) return 'House'
    const ph = String(bb.cycle.phase ?? '').toLowerCase()
    if (ph.includes('jury') || (bb.eligibility?.juryRosterIds?.length ?? 0) > 0) return 'Jury Phase'
    if (ph.includes('veto')) return 'Veto'
    if (ph.includes('nom')) return 'Nominations'
    if (ph.includes('vote') || ph.includes('evict')) return 'Eviction'
    if (ph.includes('hoh')) return 'Head of Household'
    return `Week ${bb.cycle.week}`
  }, [bb])

  const hohName =
    bb?.cycle?.hohRosterId && bb.rosterDisplayNames
      ? bb.rosterDisplayNames[bb.cycle.hohRosterId] ?? 'HOH'
      : null
  const n1 =
    bb?.cycle?.nominee1RosterId && bb.rosterDisplayNames
      ? bb.rosterDisplayNames[bb.cycle.nominee1RosterId] ?? 'Nominee'
      : null
  const n2 =
    bb?.cycle?.nominee2RosterId && bb.rosterDisplayNames
      ? bb.rosterDisplayNames[bb.cycle.nominee2RosterId] ?? 'Nominee'
      : null
  const vetoName =
    bb?.cycle?.vetoWinnerRosterId && bb.rosterDisplayNames
      ? bb.rosterDisplayNames[bb.cycle.vetoWinnerRosterId] ?? 'Veto'
      : null

  const tournamentGlow = tournamentContext?.theme?.glowAccent
  const phaseLower = (tournamentContext?.phase ?? '').toLowerCase()
  const isFinalsTournament =
    phaseLower.includes('final') || phaseLower.includes('championship') || phaseLower.includes('semifinal')
  const isEarlyTournament = phaseLower.includes('qualif') || phaseLower.includes('qualifier')

  const heroHeight = rightRailCollapsed ? 'min-h-[220px] md:min-h-[420px]' : 'min-h-[200px] md:min-h-[360px]'

  if (variant === 'tournament' && !tournamentContext) return null

  return (
    <section
      className={cn('relative z-[2] w-full overflow-hidden border-b border-white/[0.08]', heroHeight)}
      data-testid="specialty-league-hero"
      data-variant={variant}
    >
      {/* Themed backdrop */}
      {variant === 'tournament' ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: isFinalsTournament
              ? 'radial-gradient(ellipse 90% 80% at 50% -20%, rgba(245,184,0,0.22), transparent 55%), linear-gradient(180deg, #0a0f18 0%, #040915 45%, #020308 100%)'
              : isEarlyTournament
                ? 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(0,198,255,0.08), transparent 50%), linear-gradient(180deg, #060a12 0%, #040915 50%, #020308 100%)'
                : 'radial-gradient(ellipse 85% 70% at 50% -15%, rgba(245,184,0,0.14), transparent 52%), linear-gradient(180deg, #070c14 0%, #040915 48%, #020308 100%)',
            boxShadow: tournamentGlow ? `inset 0 0 80px ${tournamentGlow}18` : undefined,
          }}
        >
          {!reduceMotion ? (
            <div
              className="absolute inset-0 opacity-40 mix-blend-screen"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(90deg, rgba(0,198,255,0.05) 0 1px, transparent 1px 48px), repeating-linear-gradient(12deg, rgba(0,0,0,0.15) 0 2px, transparent 2px 120px)',
              }}
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/35 to-black/20" />
        </div>
      ) : variant === 'survivor' ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              survivorPhase.mood === 'tribal'
                ? 'radial-gradient(ellipse 70% 50% at 50% 20%, rgba(220,38,38,0.12), transparent 55%), linear-gradient(180deg, #081210 0%, #040915 55%, #020308 100%)'
                : survivorPhase.mood === 'exile'
                  ? 'radial-gradient(ellipse 60% 45% at 20% 40%, rgba(139,92,246,0.14), transparent 55%), linear-gradient(180deg, #0a0818 0%, #040915 55%, #020308 100%)'
                  : survivorPhase.mood === 'jury'
                    ? 'radial-gradient(ellipse 75% 55% at 50% 10%, rgba(245,158,11,0.1), transparent 52%), linear-gradient(180deg, #120a08 0%, #040915 55%, #020308 100%)'
                    : 'radial-gradient(ellipse 90% 55% at 85% 8%, rgba(180,220,255,0.08), transparent 50%), linear-gradient(180deg, #041016 0%, #040915 50%, #020308 100%)',
          }}
        >
          {!reduceMotion ? (
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-emerald-950/25 to-transparent" />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/40 to-black/25" />
        </div>
      ) : (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              bbPhaseLabel.includes('Jury') || bbPhaseLabel.includes('Finale')
                ? 'radial-gradient(ellipse 75% 55% at 50% 0%, rgba(230,220,200,0.08), transparent 52%), linear-gradient(188deg, #0c0a14 0%, #06040f 50%, #030208 100%)'
                : bbPhaseLabel.includes('Eviction')
                  ? 'radial-gradient(ellipse 80% 55% at 50% 35%, rgba(220,38,38,0.12), transparent 55%), linear-gradient(188deg, #080208 0%, #05030c 52%, #020105 100%)'
                    : bb?.cycle?.vetoWinnerRosterId && !bb?.cycle?.vetoUsed
                    ? 'radial-gradient(ellipse 70% 50% at 50% 18%, rgba(74,222,128,0.12), transparent 52%), linear-gradient(188deg, #06120c 0%, #06040f 50%, #030208 100%)'
                    : 'radial-gradient(ellipse 80% 55% at 50% -5%, rgba(168,85,247,0.14), transparent 52%), linear-gradient(188deg, #0a0618 0%, #06040f 48%, #030208 100%)',
          }}
        >
          {!reduceMotion ? (
            <div
              className="absolute inset-0 opacity-[0.18]"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(0deg, rgba(255,255,255,0.03) 0 1px, transparent 1px 64px), repeating-linear-gradient(90deg, rgba(255,61,129,0.04) 0 1px, transparent 1px 72px)',
              }}
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-black/78 via-black/45 to-black/28" />
        </div>
      )}

      <div className="relative flex h-full min-h-[inherit] flex-col px-4 py-4 md:px-6 md:py-6">
        <div className="pointer-events-none absolute right-3 top-3 md:right-5 md:top-4">
          <div className="pointer-events-auto scale-90 md:scale-100">
            <KingBuffaloPresentedBy variant="compact" />
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-4 pr-0 pt-10 md:flex-row md:items-stretch md:gap-6 md:pt-2 md:pr-44">
          {/* Left column */}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/30 text-xl shadow-inner"
                aria-hidden
              >
                {leagueTabSportEmoji(sport)}
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold leading-tight text-white md:text-xl">{leagueName}</h2>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                      variant === 'tournament' &&
                        'border-amber-400/35 bg-amber-500/15 text-amber-100',
                      variant === 'survivor' &&
                        'border-emerald-400/35 bg-emerald-950/40 text-emerald-100',
                      variant === 'big_brother' &&
                        'border-fuchsia-400/35 bg-fuchsia-950/35 text-fuchsia-100',
                    )}
                    data-testid="specialty-hero-type-badge"
                  >
                    {variant === 'tournament'
                      ? 'Tournament'
                      : variant === 'survivor'
                        ? 'Survivor'
                        : 'Big Brother'}
                  </span>
                  <span className="text-[11px] text-white/50">
                    {season} · {sport}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/[0.1] bg-black/45 px-3 py-2.5 backdrop-blur-md md:max-w-xl">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">Phase</p>
              <p className="mt-1 text-sm font-semibold text-white/95">
                {variant === 'tournament' && tournamentContext ? (
                  <>
                    {tournamentContext.phase} · Round {tournamentContext.roundIndex}
                    {tournamentContext.conferenceName ? (
                      <span className="text-white/60"> · {tournamentContext.conferenceName}</span>
                    ) : null}
                  </>
                ) : variant === 'survivor' ? (
                  survivorPhase.label
                ) : (
                  <>
                    {bbPhaseLabel}
                    {bb?.cycle ? <span className="text-white/55"> · Week {bb.cycle.week}</span> : null}
                  </>
                )}
              </p>
              {variant === 'tournament' && tournamentContext?.roundRules ? (
                <p className="mt-1 text-[11px] text-white/55">
                  Bench {tournamentContext.roundRules.benchSpots}
                  {tournamentContext.roundRules.faabReset
                    ? ` · FAAB ${tournamentContext.roundRules.faabBudget} (resets)`
                    : null}
                </p>
              ) : null}
            </div>
          </div>

          {/* Center / status */}
          <div className="flex w-full min-w-0 flex-[1.15] flex-col justify-center gap-2 md:max-w-md">
            <div className="rounded-2xl border border-white/[0.09] bg-[#070b14]/75 px-3 py-3 backdrop-blur-xl">
              {variant === 'tournament' && tournamentContext ? (
                <div className="space-y-2 text-[13px] text-white/85">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-[#ffb8d1]/90">Hub</span>
                    <Link
                      href={`/tournament/${tournamentContext.tournamentId}`}
                      className="text-[11px] font-semibold text-[#ff9ec0] underline-offset-2 hover:text-[#ffb8d1] hover:underline"
                      data-testid="specialty-hero-tournament-hub"
                    >
                      {tournamentContext.tournamentName} →
                    </Link>
                  </div>
                  <p className="text-[12px] text-white/70">
                    Teams in league:{' '}
                    <span className="font-semibold text-white">{teamsFilled}</span> / {teamCount}
                  </p>
                  {tournamentContext.theme?.bannerUrl ? (
                    <div
                      className="mt-2 h-16 w-full rounded-lg bg-cover bg-center opacity-90"
                      style={{ backgroundImage: `url(${tournamentContext.theme.bannerUrl})` }}
                      role="img"
                      aria-label="Tournament banner"
                    />
                  ) : null}
                  {draftDateIso && draftCountdown.label ? (
                    <p
                      className={cn(
                        'text-[12px] font-medium',
                        draftCountdown.urgent ? 'text-amber-200' : 'text-[#ffd7e5]/90',
                      )}
                    >
                      Draft starts in{' '}
                      <span className={cn('font-mono', draftCountdown.urgent && 'animate-pulse')}>
                        {draftCountdown.label}
                      </span>
                    </p>
                  ) : (
                    <p className="text-[12px] text-white/55">Schedule: check Draft tab for your window.</p>
                  )}
                  <p className="text-[11px] text-white/45">
                    Advancement: stay in the hunt each round — cut line follows your tournament hub standings.
                  </p>
                </div>
              ) : variant === 'survivor' ? (
                <div className="space-y-2 text-[13px] text-white/85">
                  {loadErr ? <p className="text-amber-200/90">{loadErr}</p> : null}
                  <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-200/90">Island</p>
                  <p className="text-sm text-white/90">
                    <span className="text-white/55">Tribe: </span>
                    {tribeName}
                  </p>
                  {survivor?.exileLeagueId ? (
                    <p className="text-[12px] text-violet-200/90">Exile Island · active</p>
                  ) : null}
                  {activeChallenge ? (
                    <p className="text-[12px] text-amber-100/90">
                      Mini-game: {activeChallenge.challengeType.replace(/_/g, ' ')}
                      {challengeCd.label ? (
                        <span className="ml-1 font-mono text-[11px] text-amber-200/80">
                          · locks {challengeCd.label}
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                  {tribalDeadline && tribalCd.label ? (
                    <p
                      className={cn(
                        'text-[12px]',
                        tribalCd.urgent ? 'text-red-200' : 'text-orange-100/90',
                      )}
                    >
                      Tribal Council: <span className={cn('font-mono', tribalCd.urgent && 'animate-pulse')}>{tribalCd.label}</span>
                    </p>
                  ) : (
                    <p className="text-[12px] text-white/55">No active tribal countdown.</p>
                  )}
                </div>
              ) : (
                <div className="space-y-2 text-[13px] text-white/85">
                  {loadErr ? <p className="text-amber-200/90">{loadErr}</p> : null}
                  <p className="text-[11px] font-bold uppercase tracking-wide text-fuchsia-200/90">House</p>
                  {hohName ? (
                    <p className="flex items-center gap-2 text-sm">
                      <Crown className="h-4 w-4 text-amber-300" />
                      <span className="text-white/55">HOH</span> <span className="font-semibold text-white">{hohName}</span>
                    </p>
                  ) : (
                    <p className="text-[12px] text-white/55">HOH not set yet</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {n1 ? (
                      <span className="rounded-lg border border-rose-500/30 bg-rose-950/30 px-2 py-1 text-[12px] text-rose-100">
                        {n1}
                      </span>
                    ) : null}
                    {n2 ? (
                      <span className="rounded-lg border border-rose-500/30 bg-rose-950/30 px-2 py-1 text-[12px] text-rose-100">
                        {n2}
                      </span>
                    ) : (
                      <span className="text-[12px] text-white/45">Nominees TBD</span>
                    )}
                  </div>
                  {vetoName ? (
                    <p className="text-[12px] text-emerald-100/90">
                      Veto: <span className="font-semibold">{vetoName}</span>
                      {bb?.cycle?.vetoUsed ? <span className="text-white/45"> (used)</span> : null}
                    </p>
                  ) : null}
                  {evictionDeadline && evictionCd.label ? (
                    <p
                      className={cn(
                        'text-[12px]',
                        evictionCd.urgent ? 'text-red-200' : 'text-[#ffd7e5]/90',
                      )}
                    >
                      Eviction / vote closes:{' '}
                      <span className={cn('font-mono', evictionCd.urgent && 'animate-pulse')}>{evictionCd.label}</span>
                    </p>
                  ) : (
                    <p className="text-[12px] text-white/55">Vote schedule: see Voting tab.</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right: actions */}
          <div className="flex w-full flex-col gap-2 md:w-[220px] md:shrink-0">
            <div className="scrollbar-none flex gap-2 overflow-x-auto pb-1 md:flex-col md:overflow-visible">
              <HeroQuickButton icon={Trophy} onClick={onOpenDraftTab}>
                Draft
              </HeroQuickButton>
              <HeroQuickButton icon={LayoutGrid} onClick={onOpenStandingsTab}>
                Standings
              </HeroQuickButton>
              <HeroQuickButton icon={MessageSquare} onClick={onOpenChat}>
                Chat
              </HeroQuickButton>
              <HeroQuickButton icon={Settings} onClick={onOpenSettings}>
                Settings
              </HeroQuickButton>
              {isCommissioner ? (
                <HeroQuickButton icon={Shield} onClick={onOpenCommissionerSettings}>
                  Commish
                </HeroQuickButton>
              ) : null}
              {isHeadCommissioner && variant === 'tournament' && tournamentContext ? (
                <HeroQuickButton
                  icon={Wrench}
                  href={`/tournament/${tournamentContext.tournamentId}/control`}
                >
                  Ops
                </HeroQuickButton>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
