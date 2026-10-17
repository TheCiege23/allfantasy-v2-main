'use client'

/**
 * Premium player detail modal for the draft room.
 *
 * Data sources:
 *   - /api/player-card-analytics  → meta trends, AI insight, news, career summary
 *   - /api/legacy/player-game-logs → per-week stat lines (Sleeper-backed, NFL)
 *
 * Design intent (matches the reference premium player card):
 *   - Header: headshot + name + physical-stats chip bar + team badge + favorite star
 *   - Rankings row: position rank, overall rank, rostered%, started%
 *   - Year tabs (current season + 3 prior)
 *   - Dense game-log table with position-aware columns
 *   - Latest-news rail on the right
 *   - League-context footer: drafted pick / acquisition / rostered-by
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { X, Star, Flame } from 'lucide-react'
import type { DraftCopilotInsight } from '@/lib/draft-room/draft-copilot-types'
import type { NormalizedDraftRoomPlayer } from '@/lib/players/normalizePlayer'
import { getPlayerImage, preloadPlayerImage } from '@/lib/players/getPlayerImage'
import type { NflDraftProjectionSplits } from '@/lib/draft/analytics/nfl-draft-pool-projection-splits'
import { formatNflStatCell } from '@/lib/draft/analytics/nfl-draft-pool-projection-splits'
import { NflDraftPoolStatsGroupHeader, NflDraftPoolStatsRow } from '@/components/app/draft-room/NflDraftPoolStatsStrip'
import { PlayerAvatar } from '@/components/app/draft-room/PlayerAvatar'

export interface PlayerDetailPlayer {
  id?: string | null
  name: string
  position?: string | null
  team?: string | null
  byeWeek?: number | null
  adp?: number | null
  headshotUrl?: string | null
  teamLogoUrl?: string | null
  status?: string | null
  age?: number | null
  heightIn?: number | null
  weightLbs?: number | null
  yearsExp?: number | null
  college?: string | null
  jersey?: number | null
}

export interface LeagueContext {
  /** Pick label (e.g. "2.07") if this player has been drafted in this league. */
  draftedPickLabel?: string | null
  /** Display name of the team currently rostering this player, if any. */
  rosteredByTeamName?: string | null
  /** 'draft' | 'trade' | 'waiver' | 'import' */
  acquiredVia?: string | null
}

/** Live digest from `/draft/assistant-context` mapped to this player / league. */
export type DraftAssistantRoomContext = {
  headline?: string | null
  injuryLine?: string | null
  digestPreview?: string | null
}

export interface PlayerDetailModalProps {
  open: boolean
  onClose: () => void
  player: PlayerDetailPlayer
  /** Canonical draft-room shape (stats line, news, projection) — optional enricher. */
  normalized?: NormalizedDraftRoomPlayer | null
  sport: string
  leagueContext?: LeagueContext | null
  onAddToQueue?: () => void
  onMakePick?: () => void
  canDraft?: boolean
  isWatchlisted?: boolean
  onToggleWatchlist?: () => void
  /** Live redraft snake: synthesized insight from draft copilot + War Room when available. */
  draftCopilot?: DraftCopilotInsight | null
  /** News/injury/sports digest aligned to assistant-context for this player. */
  assistantRoomContext?: DraftAssistantRoomContext | null
  /** Live snake redraft: denser chrome aligned with draft room surfacing */
  presentationVariant?: 'default' | 'redraft_snake'
  /** Header rankings row: label next to numeric ADP (matches list when using AI ADP sort). */
  adpDisplayLabel?: 'ADP' | 'AI ADP'
  /** When Draft is disabled, clarifies drafted vs wrong turn */
  draftUnavailableReason?: 'already_drafted' | 'not_your_pick' | null
  /** NFL: season projection + splits from `/draft/pool` (mobile detail access without list grid). */
  nflDraftProjectionSplits?: NflDraftProjectionSplits | null
}

/** Matches lib/player-card-analytics/types.ts PlayerCardAnalyticsPayload */
interface AnalyticsResponse {
  aiInsights?: string | null
  metaTrends?: {
    trendScore?: number
    addRate?: number
    dropRate?: number
    tradeRate?: number
    draftRate?: number
    trendingDirection?: string
    updatedAt?: string
  } | null
  careerProjection?: {
    projectedPointsYear1?: number
    projectedPointsYear2?: number
    projectedPointsYear3?: number
    projectedPointsYear4?: number
    projectedPointsYear5?: number
    breakoutProbability?: number
    declineProbability?: number
    volatilityScore?: number
    season?: number
  } | null
  matchupPrediction?: {
    expectedPoints?: number | null
    expectedPointsPerGame?: number | null
    outlook?: string
    opponentTier?: string
  } | null
  seasonHistory?: Array<{
    season: string
    gamesPlayed: number | null
    fantasyPoints: number | null
    fantasyPointsPerGame: number | null
    team: string | null
    stats?: Record<string, unknown>
  }> | null
  news?: Array<{ title: string; body?: string; source?: string; publishedAt?: string; url?: string }> | null
  rankings?: {
    positionRank?: number | null
    overallRank?: number | null
    rosteredPct?: number | null
    startedPct?: number | null
  } | null
}

interface WeekLog {
  week: number
  opponent?: string
  pts_ppr?: number
  pts_half_ppr?: number
  pts_std?: number
  gp?: number
  pass_att?: number
  pass_cmp?: number
  pass_yd?: number
  pass_td?: number
  pass_int?: number
  rush_att?: number
  rush_yd?: number
  rush_td?: number
  rec?: number
  rec_tgt?: number
  rec_yd?: number
  rec_td?: number
  fum_lost?: number
}

function formatHeight(inches: number | null | undefined): string {
  if (!inches || inches <= 0) return '—'
  const ft = Math.floor(inches / 12)
  const remain = inches - ft * 12
  return `${ft}'${remain}"`
}

function columnSetForPosition(pos: string | null | undefined): 'qb' | 'rb' | 'wr_te' | 'other' {
  const p = String(pos ?? '').toUpperCase()
  if (p === 'QB') return 'qb'
  if (p === 'RB' || p === 'FB') return 'rb'
  if (p === 'WR' || p === 'TE') return 'wr_te'
  return 'other'
}

function statusBadgeClass(status: string | null | undefined): string {
  const s = String(status ?? '').toLowerCase()
  if (s.includes('out') || s.includes('ir') || s.includes('susp')) {
    return 'bg-rose-500/20 text-rose-200 border-rose-400/40'
  }
  if (s.includes('quest') || s.includes('doubt')) {
    return 'bg-amber-500/20 text-amber-200 border-amber-400/40'
  }
  if (s.includes('rookie')) {
    return 'bg-cyan-500/20 text-cyan-200 border-cyan-400/40'
  }
  return 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40'
}

export function PlayerDetailModal(props: PlayerDetailModalProps) {
  const {
    open,
    onClose,
    player,
    normalized = null,
    sport,
    leagueContext,
    onAddToQueue,
    onMakePick,
    canDraft,
    isWatchlisted,
    onToggleWatchlist,
    draftCopilot = null,
    assistantRoomContext = null,
    presentationVariant = 'default',
    adpDisplayLabel = 'ADP',
    draftUnavailableReason = null,
    nflDraftProjectionSplits = null,
  } = props

  const rsModal = presentationVariant === 'redraft_snake'

  const currentYear = new Date().getUTCFullYear()
  const availableYears = useMemo(
    () => [currentYear, currentYear - 1, currentYear - 2, currentYear - 3],
    [currentYear],
  )
  const [activeYear, setActiveYear] = useState<number>(currentYear)
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [gameLogs, setGameLogs] = useState<WeekLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsError, setLogsError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !player?.name) return
    let alive = true
    setAnalyticsLoading(true)
    setAnalytics(null)
    fetch('/api/player-card-analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: player.id ?? null,
        playerName: player.name,
        position: player.position ?? null,
        team: player.team ?? null,
        sport,
        season: String(activeYear),
      }),
    })
      .then(async (r) => {
        if (!alive) return
        if (!r.ok) return
        const body = (await r.json().catch(() => null)) as AnalyticsResponse | null
        if (alive) setAnalytics(body)
      })
      .finally(() => {
        if (alive) setAnalyticsLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open, player?.name, player?.id, player?.position, player?.team, sport, activeYear])

  useEffect(() => {
    // Game logs only wired for NFL via the legacy Sleeper endpoint.
    if (!open) return
    const pid = player?.id
    if (!pid || String(sport).toUpperCase() !== 'NFL') {
      setGameLogs([])
      setLogsError(null)
      return
    }
    let alive = true
    setLogsLoading(true)
    setLogsError(null)
    setGameLogs([])
    fetch('/api/legacy/player-game-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player_id: pid, season: String(activeYear) }),
    })
      .then(async (r) => {
        if (!alive) return
        const body = (await r.json().catch(() => ({}))) as {
          gameLogs?: WeekLog[]
          error?: string
        }
        if (!r.ok) {
          setLogsError(body.error ?? 'Game logs unavailable')
          return
        }
        setGameLogs(body.gameLogs ?? [])
      })
      .catch((e) => {
        if (alive) setLogsError(e instanceof Error ? e.message : 'Game logs failed')
      })
      .finally(() => {
        if (alive) setLogsLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open, player?.id, sport, activeYear])

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose],
  )
  useEffect(() => {
    if (!open) return
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, handleKey])

  const headerImageUrl = useMemo(() => {
    const fromNorm = normalized ? getPlayerImage(normalized, sport) : null
    return fromNorm ?? player.headshotUrl ?? null
  }, [normalized, player.headshotUrl])

  useEffect(() => {
    if (!open || !headerImageUrl) return
    preloadPlayerImage(headerImageUrl)
  }, [open, headerImageUrl])

  if (!open) return null

  const colSet = columnSetForPosition(player.position)
  const rankings = analytics?.rankings ?? null
  const news = analytics?.news ?? []

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
      data-testid="player-detail-modal"
    >
      <div
        className={`relative my-4 flex max-h-[calc(100vh-2rem)] w-full overflow-hidden rounded-2xl border bg-gradient-to-b from-[#0a1228] to-[#040915] shadow-2xl animate-in zoom-in-95 fade-in duration-200 sm:my-8 sm:max-h-[calc(100vh-4rem)] ${
          rsModal ? 'max-w-5xl border-cyan-400/25 shadow-[0_28px_80px_rgba(0,0,0,0.65),0_0_0_1px_rgba(34,211,238,0.08)]' : 'max-w-6xl border-white/10'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white/70 hover:bg-white/10"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {/* Header */}
          <div
            className={`relative border-b bg-gradient-to-r from-[#081428] via-[#0a1530] to-[#081428] px-6 py-5 ${
              rsModal ? 'border-cyan-500/15 shadow-[inset_0_-1px_0_rgba(34,211,238,0.06)]' : 'border-white/8'
            }`}
          >
            <div className="flex items-start gap-5">
              {/* E.1: shared PlayerAvatar replaces the previous inline `<img>` + initials block.
                * The old code rendered headerImageUrl unconditionally — when the resolver returned
                * a synthesized `data:image/svg+xml` URI containing the literal text "AF" as a fallback
                * placeholder, the image loaded successfully and the user saw "AF" instead of the
                * player's actual initials (Bijan Robinson should be "BR"). PlayerAvatar's
                * URL classifier rejects data URIs and team logos so we always fall through to
                * proper initials when there isn't a real photo. */}
              <PlayerAvatar
                headshotUrl={headerImageUrl}
                displayName={player.name}
                teamLogoUrl={normalized?.teamLogoUrl ?? player.teamLogoUrl ?? null}
                teamAbbr={player.team ?? null}
                position={player.position ?? null}
                size={rsModal ? 144 : 112}
                testIdBase="player-detail-avatar"
                className={rsModal ? 'rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.45)]' : ''}
              />

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/50">
                    {player.position ?? '—'}
                    {player.team ? ` · ${player.team}` : ''}
                    {typeof player.jersey === 'number' ? ` · #${player.jersey}` : ''}
                  </p>
                  {player.status && (
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.14em] ${statusBadgeClass(player.status)}`}>
                      {player.status}
                    </span>
                  )}
                </div>
                <h2 className={`mt-1 font-black tracking-tight text-white ${rsModal ? 'text-4xl' : 'text-3xl'}`}>
                  {player.name}
                </h2>

                {/* Physical-stat chip bar */}
                <div className="mt-3 grid max-w-xl grid-cols-5 gap-3 text-center">
                  <StatChip label="Age" value={player.age ? String(player.age) : '—'} />
                  <StatChip label="Height" value={formatHeight(player.heightIn)} />
                  <StatChip
                    label="Weight"
                    value={player.weightLbs ? `${player.weightLbs} lbs` : '—'}
                  />
                  <StatChip label="Exp" value={player.yearsExp != null ? String(player.yearsExp) : '—'} />
                  <StatChip label="College" value={player.college ?? '—'} />
                </div>

                {/* Rankings bar */}
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px]">
                  {rankings?.positionRank != null && (
                    <span>
                      <span className="font-black text-cyan-300">#{rankings.positionRank}</span>
                      <span className="ml-1 text-white/55">{String(player.position).toUpperCase()}</span>
                    </span>
                  )}
                  {rankings?.overallRank != null && (
                    <span>
                      <span className="font-black text-white">#{rankings.overallRank}</span>
                      <span className="ml-1 text-white/55">Overall</span>
                    </span>
                  )}
                  {rankings?.rosteredPct != null && (
                    <span>
                      <span className="font-black text-emerald-300">{Math.round(rankings.rosteredPct)}%</span>
                      <span className="ml-1 text-white/55">Rostered</span>
                    </span>
                  )}
                  {rankings?.startedPct != null && (
                    <span>
                      <span className="font-black text-amber-300">{Math.round(rankings.startedPct)}%</span>
                      <span className="ml-1 text-white/55">Started</span>
                    </span>
                  )}
                  {player.byeWeek != null && (
                    <span className="text-white/55">
                      BYE <span className="font-black text-white">{player.byeWeek}</span>
                    </span>
                  )}
                  {typeof player.adp === 'number' && (
                    <span className="text-white/55">
                      {adpDisplayLabel}{' '}
                      <span className="font-black text-white">{player.adp.toFixed(1)}</span>
                    </span>
                  )}
                </div>

                {assistantRoomContext &&
                (assistantRoomContext.headline ||
                  assistantRoomContext.injuryLine ||
                  assistantRoomContext.digestPreview) ? (
                  <div
                    className="mt-4 max-w-xl space-y-2 rounded-xl border border-cyan-400/25 bg-black/25 px-3 py-2.5"
                    data-testid="player-detail-assistant-feed"
                  >
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-200/70">
                      Draft room intel
                    </p>
                    {assistantRoomContext.headline ? (
                      <p className="text-[11px] leading-snug text-white/88">
                        <span className="font-semibold text-cyan-100/90">News · </span>
                        {assistantRoomContext.headline}
                      </p>
                    ) : null}
                    {assistantRoomContext.injuryLine ? (
                      <p className="text-[11px] leading-snug text-amber-100/90">
                        <span className="font-semibold text-amber-200/90">Injury · </span>
                        {assistantRoomContext.injuryLine}
                      </p>
                    ) : null}
                    {assistantRoomContext.digestPreview ? (
                      <p className="line-clamp-3 text-[11px] leading-relaxed text-white/55">
                        <span className="font-semibold text-white/65">League sports digest · </span>
                        {assistantRoomContext.digestPreview}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="flex shrink-0 flex-col items-end gap-2">
                {onToggleWatchlist && (
                  <button
                    type="button"
                    onClick={onToggleWatchlist}
                    className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition ${
                      isWatchlisted
                        ? 'border-amber-400 bg-amber-400/20 text-amber-200'
                        : 'border-white/20 bg-white/[0.05] text-white/70 hover:bg-white/10'
                    }`}
                    aria-label={isWatchlisted ? 'Remove from watchlist' : 'Add to watchlist'}
                  >
                    <Star className="h-4 w-4" fill={isWatchlisted ? 'currentColor' : 'none'} />
                  </button>
                )}
                {onMakePick &&
                  (canDraft ? (
                    <button
                      type="button"
                      onClick={onMakePick}
                      className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500 px-4 py-1.5 text-xs font-bold text-black shadow hover:bg-cyan-400"
                    >
                      <Flame className="h-3.5 w-3.5" />
                      Draft
                    </button>
                  ) : (
                    <span
                      className={`inline-flex items-center rounded-full border px-3 py-1.5 text-[11px] font-semibold ${
                        rsModal ? 'border-white/18 bg-black/35 text-white/55' : 'border-white/15 bg-white/[0.06] text-white/45'
                      }`}
                      title={
                        draftUnavailableReason === 'already_drafted'
                          ? 'This player is no longer available'
                          : 'Wait for your turn to draft'
                      }
                    >
                      {draftUnavailableReason === 'already_drafted'
                        ? 'Already drafted'
                        : draftUnavailableReason === 'not_your_pick'
                          ? 'Not your pick'
                          : 'Draft unavailable'}
                    </span>
                  ))}
                {onAddToQueue && (
                  <button
                    type="button"
                    onClick={onAddToQueue}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs font-semibold text-white/85 hover:bg-white/10"
                  >
                    + Queue
                  </button>
                )}
              </div>
            </div>
          </div>

          {String(sport).toUpperCase() === 'NFL' && nflDraftProjectionSplits ? (
            <DraftPoolNflProjectionSplitsSection
              splits={nflDraftProjectionSplits}
              position={player.position}
              rsModal={rsModal}
            />
          ) : null}

          {draftCopilot && draftCopilot.bullets.length > 0 ? (
            <div
              className="border-b border-violet-400/15 bg-[linear-gradient(92deg,rgba(167,139,250,0.1),transparent)] px-6 py-3"
              data-testid="player-detail-draft-copilot"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-violet-200/95">Draft copilot</span>
                {draftCopilot.stance ? (
                  <span className="rounded-full border border-white/15 bg-black/30 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white/70">
                    {draftCopilot.stance === 'safer'
                      ? 'Safer floor'
                      : draftCopilot.stance === 'upside'
                        ? 'Upside swing'
                        : 'Balanced'}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm font-semibold text-white">{draftCopilot.headline}</p>
              <ul className="mt-2 space-y-1.5 text-[12px] text-white/84">
                {draftCopilot.bullets.map((b, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-violet-400/85" aria-hidden />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-white/42">
                Redraft-room guidance from live board context — not dynasty stash or devy valuation.
              </p>
            </div>
          ) : null}

          {normalized ? (
            <div className="border-b border-white/8 px-6 py-4 space-y-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/45">Stat summary</p>
                <p
                  className={`mt-1 text-sm ${
                    rsModal && (!normalized.stats?.summary || normalized.stats.summary === 'No stats available')
                      ? 'rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-white/45 italic'
                      : 'text-white/85'
                  }`}
                >
                  {normalized.stats?.summary && normalized.stats.summary !== 'No stats available'
                    ? normalized.stats.summary
                    : rsModal
                      ? 'Season summary not loaded yet — rankings and projection below still apply.'
                      : 'No stats available'}
                </p>
              </div>
              {normalized.projection != null && Number.isFinite(normalized.projection) && (
                <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-3 py-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-200/80">Projection</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-cyan-100">{normalized.projection.toFixed(1)}</p>
                </div>
              )}
              {normalized.stats?.season && Object.keys(normalized.stats.season).length > 0 && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/45">Key stats</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {Object.entries(normalized.stats.season).map(([k, v]) => (
                      <div key={k} className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">{k}</p>
                        <p className="mt-0.5 text-sm font-bold text-white">{String(v)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {normalized.news && normalized.news.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/45">Headlines</p>
                  <ul className="mt-2 space-y-2">
                    {normalized.news.slice(0, 8).map((n) => (
                      <li key={n.id} className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-[13px] text-white/88">
                        {n.title}
                        {n.publishedAt ? (
                          <span className="mt-1 block text-[11px] text-white/40">{n.publishedAt}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : null}

          {/* Year tabs */}
          <div className="flex items-center gap-2 border-b border-white/8 px-6 pt-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/50">Game logs</p>
            <div className="ml-auto flex items-center gap-1">
              {availableYears.map((yr) => {
                const active = yr === activeYear
                return (
                  <button
                    key={yr}
                    type="button"
                    onClick={() => setActiveYear(yr)}
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                      active
                        ? 'bg-cyan-500 text-black shadow'
                        : 'bg-white/5 text-white/65 hover:bg-white/10'
                    }`}
                  >
                    {yr}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Career trends + season summary (from analytics) */}
          {/* Career stats (from DB-first PlayerSeasonStats) + meta trend badge */}
          {!analyticsLoading && (analytics?.metaTrends || (analytics?.seasonHistory && analytics.seasonHistory.length > 0)) && (
            <div className="border-b border-white/8 bg-white/[0.015] px-6 py-4" data-testid="player-detail-career-section">
              {analytics.metaTrends?.trendingDirection && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {(['addRate', 'dropRate', 'tradeRate', 'draftRate'] as const).map((key) => {
                    const val = analytics.metaTrends![key]
                    if (val == null) return null
                    const pct = (val * 100).toFixed(0)
                    const labels: Record<string, string> = { addRate: 'Add%', dropRate: 'Drop%', tradeRate: 'Trade%', draftRate: 'Draft%' }
                    return (
                      <span key={key} className="rounded-full border border-white/12 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-white/70">
                        {labels[key]} {pct}%
                      </span>
                    )
                  })}
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold ${
                      analytics.metaTrends.trendingDirection === 'hot' || analytics.metaTrends.trendingDirection === 'rising' || analytics.metaTrends.trendingDirection === 'up'
                        ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200'
                        : analytics.metaTrends.trendingDirection === 'cold' || analytics.metaTrends.trendingDirection === 'falling' || analytics.metaTrends.trendingDirection === 'down'
                        ? 'border-red-400/25 bg-red-500/10 text-red-200'
                        : 'border-white/12 bg-white/5 text-white/60'
                    }`}
                  >
                    {analytics.metaTrends.trendingDirection}
                  </span>
                </div>
              )}
              {analytics.seasonHistory && analytics.seasonHistory.length > 0 && (
                <div>
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-white/45">Season Stats</p>
                  <div className="flex flex-wrap gap-4">
                    {analytics.seasonHistory.slice(0, 5).map((s, i) => (
                      <div key={i} className="text-center">
                        <p className="text-[11px] text-white/40">{s.season}</p>
                        <p className="text-[13px] font-bold text-white">
                          {s.fantasyPointsPerGame != null ? s.fantasyPointsPerGame.toFixed(1) : s.fantasyPoints != null ? s.fantasyPoints.toFixed(0) + ' total' : '—'}
                        </p>
                        {s.gamesPlayed != null && <p className="text-[11px] text-white/40">{s.gamesPlayed}g</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Game-log table */}
          <div className="px-6 pb-6 pt-3">
            {logsLoading && <p className="py-4 text-center text-[12px] text-white/50">Loading game logs…</p>}
            {!logsLoading && logsError && (
              <p className="py-4 text-center text-[12px] text-rose-200/80">{logsError}</p>
            )}
            {!logsLoading && !logsError && gameLogs.length === 0 && (
              <p className="py-4 text-center text-[12px] text-white/45">
                {String(sport).toUpperCase() === 'NFL'
                  ? `No ${activeYear} game data available yet.`
                  : analytics?.seasonHistory && analytics.seasonHistory.length > 0
                    ? null
                    : `Game logs for ${String(sport).toUpperCase()} coming soon.`}
              </p>
            )}
            {!logsLoading && !logsError && gameLogs.length > 0 && (
              <GameLogTable colSet={colSet} rows={gameLogs} />
            )}
          </div>

          {/* League context footer */}
          {leagueContext && (leagueContext.draftedPickLabel || leagueContext.rosteredByTeamName) && (
            <div className="border-t border-white/8 bg-white/[0.02] px-6 py-3 text-[12px]">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/45">In this league</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-white/70">
                {leagueContext.draftedPickLabel && (
                  <span>
                    Drafted <span className="font-bold text-white">{leagueContext.draftedPickLabel}</span>
                  </span>
                )}
                {leagueContext.rosteredByTeamName && (
                  <span>
                    Rostered by <span className="font-bold text-white">{leagueContext.rosteredByTeamName}</span>
                  </span>
                )}
                {leagueContext.acquiredVia && (
                  <span>
                    Acquired via <span className="font-bold text-white">{leagueContext.acquiredVia}</span>
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right rail: news + AI insight */}
        <aside className="hidden w-80 shrink-0 flex-col overflow-y-auto border-l border-white/8 bg-black/25 lg:flex">
          <div className="border-b border-white/8 px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/55">Latest news</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {analyticsLoading && <p className="px-4 py-3 text-[12px] text-white/45">Loading…</p>}
            {!analyticsLoading && news.length === 0 && (
              <p className="px-4 py-3 text-[12px] text-white/45">No recent news.</p>
            )}
            {news.slice(0, 6).map((n, i) => (
              <article key={i} className="border-b border-white/[0.06] px-4 py-3">
                <h3 className="text-[13px] font-bold leading-tight text-white">{n.title}</h3>
                {n.body && <p className="mt-1 text-[11px] leading-relaxed text-white/60">{n.body}</p>}
                <p className="mt-2 text-[11px] uppercase tracking-[0.12em] text-white/35">
                  {n.source ?? 'News'}
                  {n.publishedAt ? ` · ${formatTimeAgo(n.publishedAt)}` : ''}
                </p>
              </article>
            ))}
            {analytics?.aiInsights && (
              <div className="border-t border-cyan-500/25 bg-cyan-500/[0.04] px-4 py-3">
                <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-200/80">
                  AI insight
                </p>
                <p className="text-[12px] leading-relaxed text-white/75">{analytics.aiInsights}</p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

function DraftPoolNflProjectionSplitsSection({
  splits,
  position,
  rsModal,
}: {
  splits: NflDraftProjectionSplits
  position: string | null | undefined
  rsModal: boolean
}) {
  const posU = String(position ?? '').trim().toUpperCase()
  const isK = posU === 'K'

  return (
    <div
      className={`border-b px-6 py-4 ${
        rsModal
          ? 'border-cyan-500/20 bg-[linear-gradient(92deg,rgba(34,211,238,0.07),transparent)]'
          : 'border-white/8 bg-white/[0.02]'
      }`}
      data-testid="player-detail-nfl-pool-projections"
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-200/80">Draft pool projections</p>
      <p className="mt-1 max-w-2xl text-[11px] leading-snug text-white/45">
        Season outlook from your league player pool (analytics snapshot and Rolling Insights when matched). Em dash means
        no data yet — not zero.
      </p>

      {isK ? (
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[12px] tabular-nums text-white/88">
          <span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-white/45">PTS</span>{' '}
            {formatNflStatCell(splits.projectedPoints, 1)}
          </span>
          <span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-white/45">PPG</span>{' '}
            {formatNflStatCell(splits.projectedPointsPerGame, 1)}
          </span>
          {splits.kicking ? (
            <>
              <span>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-white/45">FG</span>{' '}
                {formatNflStatCell(splits.kicking.fg)}
              </span>
              <span>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-white/45">XP</span>{' '}
                {formatNflStatCell(splits.kicking.xpt)}
              </span>
            </>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch] [scrollbar-color:rgba(56,189,248,0.35)_rgba(15,23,42,0.5)]">
          <div className="min-w-[min(720px,100%)] space-y-2">
            <NflDraftPoolStatsGroupHeader />
            <NflDraftPoolStatsRow splits={splits} />
          </div>
        </div>
      )}
    </div>
  )
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">{label}</p>
      <p className="mt-0.5 truncate text-[13px] font-bold text-white">{value}</p>
    </div>
  )
}

function GameLogTable({ colSet, rows }: { colSet: 'qb' | 'rb' | 'wr_te' | 'other'; rows: WeekLog[] }) {
  const weeks = rows.length
  const total = rows.reduce((acc, r) => acc + (r.pts_ppr ?? r.pts_std ?? 0), 0)
  const avg = weeks > 0 ? total / weeks : 0

  return (
    <div className="overflow-x-auto rounded-xl border border-white/8 bg-black/20">
      <table className="w-full min-w-[720px] text-[11px]">
        <thead className="bg-white/[0.03] text-[11px] uppercase tracking-wider text-white/50">
          <tr>
            <th className="px-2 py-2 text-left">WK</th>
            <th className="px-2 py-2 text-left">Opp</th>
            <th className="px-2 py-2 text-right">Pts (PPR)</th>
            <th className="px-2 py-2 text-right">Pts (STD)</th>
            {colSet === 'qb' && (
              <>
                <th className="px-2 py-2 text-right">Pass Cmp/Att</th>
                <th className="px-2 py-2 text-right">Pass YD</th>
                <th className="px-2 py-2 text-right">Pass TD</th>
                <th className="px-2 py-2 text-right">INT</th>
                <th className="px-2 py-2 text-right">Rush YD</th>
                <th className="px-2 py-2 text-right">Rush TD</th>
              </>
            )}
            {colSet === 'rb' && (
              <>
                <th className="px-2 py-2 text-right">Rush Att</th>
                <th className="px-2 py-2 text-right">Rush YD</th>
                <th className="px-2 py-2 text-right">Rush TD</th>
                <th className="px-2 py-2 text-right">Tgt</th>
                <th className="px-2 py-2 text-right">Rec</th>
                <th className="px-2 py-2 text-right">Rec YD</th>
                <th className="px-2 py-2 text-right">Rec TD</th>
              </>
            )}
            {colSet === 'wr_te' && (
              <>
                <th className="px-2 py-2 text-right">Tgt</th>
                <th className="px-2 py-2 text-right">Rec</th>
                <th className="px-2 py-2 text-right">Rec YD</th>
                <th className="px-2 py-2 text-right">Rec TD</th>
                <th className="px-2 py-2 text-right">Rush YD</th>
                <th className="px-2 py-2 text-right">Rush TD</th>
              </>
            )}
            <th className="px-2 py-2 text-right">Fum Lost</th>
          </tr>
        </thead>
        <tbody className="text-white/85">
          {rows.map((r) => (
            <tr key={r.week} className="border-t border-white/[0.05] hover:bg-white/[0.02]">
              <td className="px-2 py-1.5 tabular-nums text-white/65">{r.week}</td>
              <td className="px-2 py-1.5 text-white/75">{r.opponent ?? '—'}</td>
              <td className="px-2 py-1.5 text-right font-bold tabular-nums">{fmt(r.pts_ppr)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-white/60">{fmt(r.pts_std)}</td>
              {colSet === 'qb' && (
                <>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {r.pass_cmp != null && r.pass_att != null ? `${r.pass_cmp}/${r.pass_att}` : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.pass_yd)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.pass_td)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.pass_int)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.rush_yd)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.rush_td)}</td>
                </>
              )}
              {colSet === 'rb' && (
                <>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.rush_att)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.rush_yd)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.rush_td)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.rec_tgt)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.rec)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.rec_yd)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.rec_td)}</td>
                </>
              )}
              {colSet === 'wr_te' && (
                <>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.rec_tgt)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.rec)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.rec_yd)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.rec_td)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.rush_yd)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.rush_td)}</td>
                </>
              )}
              <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.fum_lost)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-white/10 bg-white/[0.03] text-[11px] font-semibold text-white/75">
          <tr>
            <td className="px-2 py-1.5" colSpan={2}>
              Avg / {weeks} game{weeks === 1 ? '' : 's'}
            </td>
            <td className="px-2 py-1.5 text-right tabular-nums">{avg.toFixed(1)}</td>
            <td className="px-2 py-1.5 text-right tabular-nums text-white/55">
              {(rows.reduce((a, r) => a + (r.pts_std ?? 0), 0) / Math.max(1, weeks)).toFixed(1)}
            </td>
            <td className="px-2 py-1.5" colSpan={colSet === 'qb' || colSet === 'rb' || colSet === 'wr_te' ? 7 : 1}>
              &nbsp;
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function formatTimeAgo(iso: string): string {
  try {
    const t = new Date(iso).getTime()
    const diff = Date.now() - t
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  } catch {
    return ''
  }
}
