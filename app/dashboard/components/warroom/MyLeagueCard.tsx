'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Clock, Crown, DollarSign, ShieldCheck } from 'lucide-react'
import type { UserLeague } from '../../types'
import { resolveLeagueLogoSrc, leagueInitials } from '@/lib/dashboard/league-logo-src'
import { shouldFetchLeagueScopedData } from '@/lib/dashboard/league-card-fetch-policy'
import { useImageLoadFailed } from '@/hooks/useImageLoadFailed'
import { WarRoomCard } from './WarRoomCard'
import { ChampionshipGauge } from './ChampionshipGauge'
import { useActivityFeed } from '@/hooks/useActivityFeed'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { useLeagueHealth, type HealthStatus } from './useLeagueHealth'
import { useCountUp } from './useCountUp'
import { formatRelativeTime } from './TodayTimeline'
import type { InterpolationVars } from '@/lib/i18n/tInterpolate'

type WaiverTimingProp = { nextWaiverProcessKnown: boolean; nextWaiverProcessIsoUtc: string | null } | null

type MyTeamSummary = {
  externalId: string
  wins: number
  losses: number
  ties: number
  currentRank: number | null
  pointsFor: number
}

type ForecastRow = {
  teamId: string
  playoffProbability: number
  championshipProbability: number
}

type MatchupRow = {
  teamAId?: string
  teamBId?: string
  teamAName: string
  teamBName: string
  scoreA: number
  scoreB: number
}

/** Real values from the League Lifecycle enum (see app/dashboard/types.ts). "complete" is the legacy
 *  coarse `status` spelling; "completed" is the precise `lifecycleState` spelling — normalized below. */
export const LIFECYCLE_KEY: Record<string, string> = {
  setup: 'dashboard.warroom.lifecycle.setup',
  pre_draft: 'dashboard.warroom.lifecycle.preDraft',
  drafting: 'dashboard.warroom.lifecycle.drafting',
  post_draft: 'dashboard.warroom.lifecycle.postDraft',
  in_season: 'dashboard.warroom.lifecycle.inSeason',
  playoffs: 'dashboard.warroom.lifecycle.playoffs',
  completed: 'dashboard.warroom.lifecycle.completed',
  offseason: 'dashboard.warroom.lifecycle.offseason',
  renewal_pending: 'dashboard.warroom.lifecycle.renewalPending',
  archived: 'dashboard.warroom.lifecycle.archived',
}

/** Raw normalized lifecycle stage (e.g. 'pre_draft'), independent of its i18n key — shared with DashboardOverview. */
export function rawStage(league: UserLeague): string | null {
  const raw = league.lifecycleState || league.status
  if (!raw) return null
  return raw === 'complete' ? 'completed' : raw
}

function stageKey(league: UserLeague): string | null {
  const stage = rawStage(league)
  if (!stage) return null
  return LIFECYCLE_KEY[stage] ?? null
}

/** Phase 2.6A — sport accent color for the card's left edge + art glow, so each league
 *  reads as its own place rather than an interchangeable gray tile. */
const SPORT_ACCENT: Record<string, string> = {
  NFL: '#f5c451',
  NBA: '#fb923c',
  MLB: '#38bdf8',
  NHL: '#22d3ee',
}

function sportAccent(sport: string): string {
  return SPORT_ACCENT[sport.toUpperCase()] ?? 'rgba(255,255,255,0.14)'
}

/** Compact "Draft in 3d 4h" style countdown for pre-draft leagues with a known date. */
function formatDraftCountdown(
  draftDate: string,
  t: (key: string) => string,
  tInterpolate: (key: string, vars?: InterpolationVars) => string,
): string | null {
  const ms = new Date(draftDate).getTime() - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return null
  const days = Math.floor(ms / 86400000)
  const hours = Math.floor((ms % 86400000) / 3600000)
  if (days > 0) return tInterpolate('dashboard.warroom.myLeagueCard.draftCountdownDays', { d: days, h: hours })
  const minutes = Math.floor((ms % 3600000) / 60000)
  if (hours > 0) return tInterpolate('dashboard.warroom.myLeagueCard.draftCountdownHours', { h: hours, m: minutes })
  return t('dashboard.warroom.myLeagueCard.draftCountdownSoon')
}

type MatchupCellState =
  | { kind: 'value'; text: string; tone: 'win' | 'loss' | 'neutral' }
  | { kind: 'preseason' }
  | { kind: 'pendingWeek1' }
  | { kind: 'loading' }
  | { kind: 'unavailable' }

function resolveOpponentCell(
  opponentName: string | undefined,
  hasMatchups: boolean,
  fetchAttempted: boolean,
): MatchupCellState {
  if (opponentName) return { kind: 'value', text: opponentName, tone: 'neutral' }
  if (!hasMatchups) return { kind: 'preseason' }
  if (!fetchAttempted) return { kind: 'loading' }
  return { kind: 'unavailable' }
}

function resolveResultCell(
  lastResult: { won: boolean; score: string } | null | undefined,
  hasMatchups: boolean,
  isFirstWeek: boolean,
  fetchAttempted: boolean,
): MatchupCellState {
  if (lastResult) return { kind: 'value', text: `${lastResult.won ? 'W' : 'L'} ${lastResult.score}`, tone: lastResult.won ? 'win' : 'loss' }
  if (!hasMatchups) return { kind: 'preseason' }
  if (isFirstWeek) return { kind: 'pendingWeek1' }
  if (!fetchAttempted) return { kind: 'loading' }
  return { kind: 'unavailable' }
}

/** Renders a My Leagues card matchup cell (opponent/result) — one honest state per real cause,
 *  never the same bare dash for "not started yet" and "should have data but doesn't". */
function matchupCellDisplay(
  state: MatchupCellState,
  t: (key: string) => string,
): { text: string; className: string } {
  switch (state.kind) {
    case 'value':
      return {
        text: state.text,
        className: state.tone === 'win' ? 'text-emerald-300' : state.tone === 'loss' ? 'text-white/60' : 'text-white/85',
      }
    case 'preseason':
      return { text: t('dashboard.warroom.myLeagueCard.preseasonNotice'), className: 'font-normal text-white/40' }
    case 'pendingWeek1':
      return { text: t('dashboard.warroom.myLeagueCard.resultPendingWeek1'), className: 'font-normal text-white/40' }
    case 'loading':
      return { text: t('dashboard.warroom.myLeagueCard.matchupLoading'), className: 'font-normal text-white/35' }
    case 'unavailable':
      return { text: t('dashboard.warroom.myLeagueCard.matchupUnavailable'), className: 'font-normal text-amber-300/70' }
  }
}

function healthTone(status: HealthStatus): { color: string; labelKey: string } {
  switch (status) {
    case 'excellent':
      return { color: '#34d399', labelKey: 'dashboard.warroom.health.excellent' }
    case 'healthy':
      return { color: '#34d399', labelKey: 'dashboard.warroom.health.healthy' }
    case 'watch':
      return { color: '#fbbf24', labelKey: 'dashboard.warroom.health.watch' }
    case 'at_risk':
      return { color: '#f87171', labelKey: 'dashboard.warroom.health.atRisk' }
    case 'critical':
      return { color: '#f87171', labelKey: 'dashboard.warroom.health.critical' }
    default:
      return { color: 'rgba(255,255,255,0.35)', labelKey: 'dashboard.warroom.health.unknown' }
  }
}

export function MyLeagueCard({
  league,
  userId,
  waiverTiming = null,
}: {
  league: UserLeague
  userId: string | null
  /** Only meaningful when this card's league is the primary league the timing was computed for. */
  waiverTiming?: WaiverTimingProp
}) {
  const { t, tInterpolate } = useLanguage()
  const [myTeam, setMyTeam] = useState<MyTeamSummary | null>(null)
  const [forecastRows, setForecastRows] = useState<ForecastRow[] | null>(null)
  const [matchupRows, setMatchupRows] = useState<MatchupRow[] | null>(null)
  /** True once the matchups fetch has settled (success or failure) — distinguishes "still
   *  loading" / "genuinely no data" from "haven't started fetching because preseason". */
  const [matchupFetchAttempted, setMatchupFetchAttempted] = useState(false)
  /**
   * AF Legacy board rows carry a `LegacyLeague` id and no row in the `leagues` table
   * (`hasUnifiedRecord: false`). The DB-backed per-league fetches below all resolve the league out
   * of `leagues`, so for those rows they are dead on arrival — `/api/league/detail` 404s by
   * construction. Skipping them leaves the card in exactly the state the failed fetches did.
   *
   * Not a micro-optimization: these are per-card, and useActivityFeed additionally polls every 90s
   * for the lifetime of the mount. A real account with 543 legacy leagues therefore made ~2,000
   * requests per dashboard load and then held ~6 req/s indefinitely while merely sitting open —
   * enough to exhaust Postgres and surface as 53200 out-of-memory across unrelated routes.
   *
   * useLeagueHealth stays on: its route computes from the POST body and never reads the DB.
   * The predicate itself lives in lib/dashboard/league-card-fetch-policy.ts (pure + unit-tested,
   * per the lib/league/leagueTabSync.ts pattern) and carries the full reasoning.
   */
  const hasUnifiedRecord = shouldFetchLeagueScopedData(league)
  const { items: activityItems } = useActivityFeed({
    limit: 20,
    leagueId: league.id,
    enabled: hasUnifiedRecord,
  })
  const health = useLeagueHealth(league)

  const commissionerNotice = activityItems.find((i) => i.type === 'announcement') ?? null

  useEffect(() => {
    if (!hasUnifiedRecord) {
      // Legacy rows reach the matchups branch too (25 of one real account's 543 are `in_season`),
      // where the fetch 404'd and its `.then` still ran setMatchupFetchAttempted(true). Reproduce
      // that here so resolveOpponentCell/resolveResultCell render exactly as before — skipping the
      // request must not also change the cell copy from "no data" back to "loading".
      setMatchupFetchAttempted(true)
      return
    }
    let cancelled = false

    void fetch(`/api/league/detail?leagueId=${encodeURIComponent(league.id)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          data: {
            teams?: Array<{
              externalId: string
              claimedByUserId: string | null
              wins: number
              losses: number
              ties: number
              currentRank: number | null
              pointsFor: number
            }>
          } | null,
        ) => {
          if (cancelled || !data?.teams) return
          const mine = userId ? data.teams.find((t) => t.claimedByUserId === userId) : null
          if (mine) {
            setMyTeam({
              externalId: mine.externalId,
              wins: mine.wins,
              losses: mine.losses,
              ties: mine.ties,
              currentRank: mine.currentRank,
              pointsFor: mine.pointsFor,
            })
          }
        },
      )
      .catch(() => {})

    const season = typeof league.season === 'number' ? league.season : new Date().getFullYear()
    const week = league.currentWeek ?? 1
    void fetch(`/api/leagues/${encodeURIComponent(league.id)}/season-forecast?season=${season}&week=${week}`, {
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { teamForecasts?: ForecastRow[] } | null) => {
        if (cancelled || !data?.teamForecasts) return
        setForecastRows(data.teamForecasts)
      })
      .catch(() => {})

    const stage = league.lifecycleState || league.status
    const hasMatchups = stage === 'in_season' || stage === 'playoffs'
    if (hasMatchups) {
      void fetch(`/api/leagues/${encodeURIComponent(league.id)}/matchups`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { matchups?: MatchupRow[] } | null) => {
          if (cancelled) return
          if (data?.matchups?.length) setMatchupRows(data.matchups)
          setMatchupFetchAttempted(true)
        })
        .catch(() => {
          if (!cancelled) setMatchupFetchAttempted(true)
        })
    }

    return () => {
      cancelled = true
    }
  }, [hasUnifiedRecord, league.id, league.season, league.currentWeek, league.lifecycleState, league.status, userId])

  const forecast = useMemo(
    () => (myTeam ? (forecastRows?.find((r) => r.teamId === myTeam.externalId) ?? null) : null),
    [forecastRows, myTeam],
  )

  const matchupInfo = useMemo(() => {
    if (!myTeam || !matchupRows?.length) return null
    const mine = matchupRows.find((m) => m.teamAId === myTeam.externalId || m.teamBId === myTeam.externalId)
    if (!mine) return null
    const iAmA = mine.teamAId === myTeam.externalId
    const opponentName = iAmA ? mine.teamBName : mine.teamAName
    const myScore = iAmA ? mine.scoreA : mine.scoreB
    const oppScore = iAmA ? mine.scoreB : mine.scoreA
    const hasResult = myScore > 0 || oppScore > 0
    return {
      opponentName,
      // W/L are kept as universal single-letter sports abbreviations (same convention as "NFL"/"PPR"),
      // not translated per-locale — matches how fantasy platforms present these across languages.
      lastResult: hasResult ? { won: myScore > oppScore, score: `${myScore.toFixed(1)}-${oppScore.toFixed(1)}` } : null,
    }
  }, [matchupRows, myTeam])

  const record = myTeam ? `${myTeam.wins}-${myTeam.losses}${myTeam.ties ? `-${myTeam.ties}` : ''}` : null
  const tone = health ? healthTone(health.status) : null
  const stage = stageKey(league)
  const accent = sportAccent(league.sport)
  const logoSrc = resolveLeagueLogoSrc(league.logoUrl, league.avatarUrl)
  /** SSR-safe: a logo that 404s before hydration is caught too, not just one that fails after. */
  const { ref: logoRef, failed: logoFailed, onError: onLogoError } = useImageLoadFailed(logoSrc)
  const hasMatchups = rawStage(league) === 'in_season' || rawStage(league) === 'playoffs'
  const isFirstWeek = (league.currentWeek ?? 1) <= 1
  const rankText =
    typeof myTeam?.currentRank === 'number'
      ? tInterpolate('dashboard.warroom.myLeagueCard.rankLabel', { rank: myTeam.currentRank })
      : t('dashboard.warroom.myLeagueCard.rankPending')
  const opponentCell = matchupCellDisplay(
    resolveOpponentCell(matchupInfo?.opponentName, hasMatchups, matchupFetchAttempted),
    t,
  )
  const resultCell = matchupCellDisplay(
    resolveResultCell(matchupInfo?.lastResult, hasMatchups, isFirstWeek, matchupFetchAttempted),
    t,
  )
  const draftCountdown =
    rawStage(league) === 'pre_draft' && league.draftDate
      ? formatDraftCountdown(league.draftDate, t, tInterpolate)
      : null

  const narrativeParts: string[] = []
  if (matchupInfo?.opponentName) {
    narrativeParts.push(tInterpolate('dashboard.warroom.myLeagueCard.vsOpponent', { opponent: matchupInfo.opponentName }))
  }
  if (waiverTiming?.nextWaiverProcessKnown && waiverTiming.nextWaiverProcessIsoUtc) {
    narrativeParts.push(
      tInterpolate('dashboard.warroom.myLeagueCard.waiversNote', {
        time: formatRelativeTime(waiverTiming.nextWaiverProcessIsoUtc, tInterpolate),
      }),
    )
  }
  const narrativeLine = narrativeParts.length > 0 ? narrativeParts.join(' · ') : null

  // Animated win count — a satisfying, readable size unlike the small inline record/rank
  // text further down, which stays static (mirrors ChampionshipGauge's count-up pattern).
  const winsCountUp = useCountUp<HTMLSpanElement>(myTeam?.wins ?? 0, 700)

  return (
    <WarRoomCard
      className="relative overflow-hidden p-4 pl-[18px]"
      accentBorder={`${accent}33`}
    >
      {/* Sport-color identity bar — each league reads as its own place, not an interchangeable tile. */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: accent }} />
      <div className="flex items-start gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/[0.06]"
          style={{ boxShadow: `0 0 0 1px ${accent}40` }}
        >
          {logoSrc && !logoFailed ? (
            // Plain <img>, not next/image: logoUrl is unvalidated free text, and next/image throws
            // (killing the card) on a malformed src or any host outside next.config.js's allowlist.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={logoRef}
              src={logoSrc}
              alt=""
              width={44}
              height={44}
              className="h-full w-full object-cover"
              onError={onLogoError}
            />
          ) : (
            // Initials identify the specific league; a sport badge reads identically for every
            // league in that sport. Also covers a logo that 404s, which the old markup could not.
            <span className="text-[13px] font-bold" style={{ color: accent }} aria-hidden>
              {leagueInitials(league.name)}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            {league.isCommissioner ? <Crown className="h-3 w-3 shrink-0 text-amber-400" aria-hidden /> : null}
            <Link
              href={`/league/${league.id}`}
              title={league.name}
              className="min-w-0 flex-1 truncate text-[14px] font-bold text-white hover:text-cyan-200"
            >
              {league.name}
            </Link>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-white/40">
            {record ? (
              <span>
                <span ref={winsCountUp.ref} className="text-[13px] font-bold text-white/80">
                  {winsCountUp.value}
                </span>
                {`-${myTeam?.losses}${myTeam?.ties ? `-${myTeam.ties}` : ''} · ${rankText}`}
              </span>
            ) : (
              <span>{league.sport}</span>
            )}
            {stage ? <span className="text-white/25">· {t(stage)}</span> : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {draftCountdown ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-300">
              <Clock className="h-2.5 w-2.5" aria-hidden />
              {draftCountdown}
            </span>
          ) : null}
          {tone ? (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide"
              style={{ color: tone.color, background: `${tone.color}1a` }}
            >
              <ShieldCheck className="h-2.5 w-2.5" aria-hidden />
              {t(tone.labelKey)}
            </span>
          ) : null}
          {league.isPaid ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-300">
              <DollarSign className="h-2.5 w-2.5" aria-hidden />
              {league.entryFee
                ? tInterpolate('dashboard.warroom.myLeagueCard.entryFeeBadge', { amount: league.entryFee })
                : t('dashboard.warroom.myLeagueCard.paidLeague')}
            </span>
          ) : null}
        </div>
      </div>

      {narrativeLine ? (
        <p className="mt-3 truncate text-[13px] font-semibold text-cyan-100/90">{narrativeLine}</p>
      ) : null}

      <div className="mt-3.5 grid grid-cols-2 gap-2.5 text-[11px]">
        <div className="rounded-lg bg-white/[0.03] px-2.5 py-2">
          <p className="text-white/35">{t('dashboard.warroom.myLeagueCard.nextOpponent')}</p>
          <p className={`mt-0.5 truncate font-semibold ${opponentCell.className}`}>{opponentCell.text}</p>
        </div>
        <div className="rounded-lg bg-white/[0.03] px-2.5 py-2">
          <p className="text-white/35">{t('dashboard.warroom.myLeagueCard.lastResult')}</p>
          <p className={`mt-0.5 font-semibold ${resultCell.className}`}>{resultCell.text}</p>
        </div>
      </div>

      {forecast ? (
        <div className="mt-3 flex items-center justify-center gap-4 border-t border-white/[0.06] pt-3">
          <ChampionshipGauge
            percent={Math.round(forecast.playoffProbability)}
            label={t('dashboard.warroom.myLeagueCard.playoffOdds')}
            accent="#22d3ee"
            size={56}
          />
          <ChampionshipGauge
            percent={Math.round(forecast.championshipProbability)}
            label={t('dashboard.warroom.myLeagueCard.championship')}
            accent="#fbbf24"
            size={56}
          />
        </div>
      ) : null}

      {commissionerNotice ? (
        <p className="mt-3 truncate border-t border-white/[0.06] pt-2 text-[11px] text-white/45">
          📣 {commissionerNotice.description}
        </p>
      ) : null}
    </WarRoomCard>
  )
}
