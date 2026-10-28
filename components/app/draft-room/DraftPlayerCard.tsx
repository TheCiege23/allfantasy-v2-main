'use client'

import React, { useMemo, useState } from 'react'
import type { PlayerDisplayModel, PlayerAssetModel } from '@/lib/draft-sports-models/types'
import type { UnifiedPlayerProductView } from '@/lib/player-data/unifiedPlayerProductView'
import type { NflDraftProjectionSplits } from '@/lib/draft/analytics/nfl-draft-pool-projection-splits'
import { formatNflStatCell } from '@/lib/draft/analytics/nfl-draft-pool-projection-splits'
import { NflDraftPoolStatsRow } from '@/components/app/draft-room/NflDraftPoolStatsStrip'
import { LazyDraftImage } from './LazyDraftImage'
import { PlayerAvatar } from './PlayerAvatar'
import { normalizePlayer } from '@/lib/players/normalizePlayer'
import { getPlayerImage } from '@/lib/players/getPlayerImage'
import { DEFAULT_SPORT } from '@/lib/sport-scope'
import { DraftPlayerLabelBadge } from './DraftPlayerLabelBadge'

export type DraftPlayerCardProps = {
  /** Normalized display model (preferred) */
  display?: PlayerDisplayModel | null
  /** Unified product layer — fallback headshot / injury when display assets omit data */
  unifiedProductView?: UnifiedPlayerProductView | null
  /** Fallback when display not provided: minimal fields for list row */
  name: string
  position: string
  team?: string | null
  adp?: number | null
  byeWeek?: number | null
  /** League sport for logo + asset resolution */
  draftSport?: string
  /** Draft state */
  isDrafted?: boolean
  /** Show compact row (list) vs larger card */
  variant?: 'row' | 'card'
  /** Devy: from college/devy pool */
  isDevy?: boolean
  /** Devy: school (e.g. "Ohio State") */
  school?: string | null
  classYearLabel?: string | null
  draftGrade?: string | null
  projectedLandingSpot?: string | null
  /** Devy: promoted to NFL */
  graduatedToNFL?: boolean
  /** C2C: 'college' | 'pro' for Campus-to-Canton */
  poolType?: 'college' | 'pro'
  /** Rookie indicator from normalized pool row when available. */
  isRookie?: boolean
  /** Optional: primary action (e.g. Draft button) */
  primaryAction?: React.ReactNode
  /** Optional: secondary action (e.g. Add to queue) */
  secondaryAction?: React.ReactNode
  /** Optional: compare / vs action (shown before secondary in row layout) */
  compareAction?: React.ReactNode
  /** Loading state */
  loading?: boolean
  /** Error state (e.g. failed to load asset) */
  error?: string | null
  /** Optional card click handler for player detail drill-down. */
  onSelect?: () => void
  /** Optional explicit test id */
  testId?: string
  /** War Room / AI helper badge on list rows */
  aiWarRoomBadge?: 'ai_pick' | 'value' | 'risky' | null
  presentationVariant?: 'default' | 'redraft_snake'
  /** List row keyboard/click selection highlight */
  isSelected?: boolean
  /** Matches a player on the user&apos;s draft queue */
  isQueued?: boolean
  /** Label for the ADP column (e.g. AI ADP when sorting by AI ADP). */
  adpMetricLabel?: string
  /** NFL redraft pool: projection + split stats (from `/draft/pool`). */
  compactStats?: string | null
  nflDraftProjectionSplits?: NflDraftProjectionSplits | null
}

function formatAdpDisplay(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  const n = Number(v)
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function formatBye(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v <= 0) return '—'
  return String(Math.floor(v))
}

/** E.1: thin wrapper around the shared PlayerAvatar so DraftPlayerCard's existing call sites
 * keep their headshotUrl + displayName + size props but get the URL-classifier behavior
 * (data URIs + team-logo paths fall through to silhouette+initials instead of being shown
 * as the main avatar). Team-logo overlay is rendered separately by the card layout below
 * (TeamLogoOrFallback), so we don't pass teamLogoUrl here. */
function HeadshotOrFallback({
  headshotUrl,
  displayName,
  size = 32,
  className = '',
  testIdBase = 'draft-player-headshot',
}: {
  headshotUrl: string | null
  displayName: string
  size?: number
  className?: string
  testIdBase?: string
}) {
  return (
    <PlayerAvatar
      headshotUrl={headshotUrl}
      displayName={displayName}
      size={size}
      testIdBase={testIdBase}
      className={className}
    />
  )
}

function TeamLogoOrFallback({
  logoUrl,
  teamAbbr,
  size = 20,
  className = '',
  testIdBase = 'draft-player-team-logo',
}: {
  logoUrl: string | null
  teamAbbr: string | null
  size?: number
  className?: string
  testIdBase?: string
}) {
  const [imgError, setImgError] = useState(false)
  const showImg = logoUrl && !imgError

  if (showImg) {
    return (
      <LazyDraftImage
        src={logoUrl}
        alt={teamAbbr ?? ''}
        width={size}
        height={size}
        testId={`${testIdBase}-image`}
        className={`rounded object-contain ${className}`}
        lazy
        onError={() => setImgError(true)}
      />
    )
  }
  return (
    <span
      data-testid={`${testIdBase}-fallback`}
      className={`inline-flex items-center justify-center rounded border border-white/15 bg-[#141e35] text-[11px] font-bold text-white/90 flex-shrink-0 shadow-sm ${className}`}
      style={{ width: size, height: size }}
    >
      {teamAbbr ? teamAbbr.slice(0, 3).toUpperCase() : '—'}
    </span>
  )
}

function DraftPlayerCardInner({
  display,
  unifiedProductView = null,
  name,
  position,
  team,
  adp,
  byeWeek,
  draftSport = DEFAULT_SPORT,
  isDrafted = false,
  variant = 'row',
  primaryAction,
  secondaryAction,
  compareAction,
  loading = false,
  error = null,
  onSelect,
  testId,
  isDevy = false,
  school = null,
  classYearLabel = null,
  draftGrade = null,
  projectedLandingSpot = null,
  graduatedToNFL = false,
  poolType,
  isRookie = false,
  aiWarRoomBadge = null,
  presentationVariant = 'default',
  isSelected = false,
  isQueued = false,
  adpMetricLabel = 'ADP',
  nflDraftProjectionSplits = null,
  compactStats = null,
}: DraftPlayerCardProps) {
  const rs = presentationVariant === 'redraft_snake'
  const posU = position.trim().toUpperCase()
  const isNfl = String(draftSport).toUpperCase() === 'NFL'
  const showNflSplitGrid =
    rs && isNfl && nflDraftProjectionSplits != null && posU !== 'K'
  const showNflKickerSplits =
    rs && isNfl && nflDraftProjectionSplits != null && posU === 'K' && nflDraftProjectionSplits.kicking
  const assets: PlayerAssetModel | null = display?.assets ?? null
  const teamAbbr = display?.metadata?.teamAbbreviation ?? team ?? null
  const displayName = display?.displayName ?? name
  const primaryStat = display?.stats?.primaryStatValue ?? adp
  const bye = display?.metadata?.byeWeek ?? display?.stats?.byeWeek ?? byeWeek
  const rawInjuryStatus =
    display?.metadata?.injuryStatus ?? unifiedProductView?.unified.injuryStatus ?? unifiedProductView?.injuryStatus ?? null
  const injuryStatus = rawInjuryStatus && !/^(unknown|none|n\/a|healthy|active|act|available)$/i.test(rawInjuryStatus.trim())
    ? rawInjuryStatus : null
  const resolvedSchool = school ?? display?.metadata?.collegeOrPipeline ?? null
  const resolvedClassYearLabel = display?.metadata?.classYearLabel ?? classYearLabel
  const resolvedDraftGrade = display?.metadata?.draftGrade ?? draftGrade
  const resolvedProjectedLandingSpot = display?.metadata?.projectedLandingSpot ?? projectedLandingSpot
  const devyLabel = resolvedSchool ?? (isDevy ? 'Devy' : null)
  const showPromoted = graduatedToNFL
  const showProBadge = poolType === 'pro'
  const showCollegeBadge = poolType === 'college' || (isDevy && !showProBadge)
  // Rookie / Prospect: one resolver for every sport (lib/draft-room/draftRoomPlayerLabel).
  const labelInput = { isRookie, isDevy, graduatedToNFL, poolType }

  const normalized = useMemo(
    () =>
      normalizePlayer({
        display: display ?? undefined,
        name,
        position,
        team,
        adp: primaryStat,
        byeWeek: bye,
        sport: draftSport,
        school,
        classYearLabel,
        draftGrade,
        projectedLandingSpot,
        isDevy,
        graduatedToNFL,
        poolType,
      }),
    [
      display,
      name,
      position,
      team,
      primaryStat,
      bye,
      draftSport,
      school,
      classYearLabel,
      draftGrade,
      projectedLandingSpot,
      isDevy,
      graduatedToNFL,
      poolType,
    ],
  )

  const headshotUrl =
    getPlayerImage(normalized, draftSport) ??
    assets?.headshotUrl ??
    unifiedProductView?.unified.headshotUrl ??
    null
  // The caller chooses market/AI ADP. A display model's market ADP must not
  // override that selection, and an explicit null must remain unavailable.
  const displayedAdp = adp === undefined ? normalized.adp : adp
  const teamLogoUrl = normalized.teamLogoUrl ?? assets?.teamLogoUrl ?? null
  const rowHeadshotSize = 44
  const rowLogoSize = 16
  // Commit P — surface the explicit `projection` field as a stat-line
  // fallback when the upstream summary is absent. Pre-Commit-P the row
  // showed "No stats available" even when the resolver had a projected-
  // points number on the normalized payload (the field was computed in
  // `normalizePlayer` but never read by the card).
  const projectedPoints =
    typeof normalized.projection === 'number' && Number.isFinite(normalized.projection)
      ? normalized.projection
      : null
  const nbaRates = String(draftSport).toUpperCase() === 'NBA'
    ? [
        ['PPG', display?.stats?.pointsPerGame],
        ['RPG', display?.stats?.reboundsPerGame],
        ['MPG', display?.stats?.minutesPerGame],
      ].filter((item): item is [string, number] => typeof item[1] === 'number' && Number.isFinite(item[1]))
        .map(([label, value]) => `${label} ${value.toFixed(1)}`)
        .join(' · ')
    : ''
  const storedSummary = normalized.stats?.summary
  const meaningfulSummary = storedSummary && !/^(No stats available$|(?:AI )?ADP\b|Bye\b)/i.test(storedSummary) ? storedSummary : null
  const statLine = meaningfulSummary ??
    (projectedPoints != null
      ? `Proj ${projectedPoints.toFixed(1)} pts`
      : '')
  const displayStatLine = compactStats || nbaRates || statLine
  const headshotTestBase = testId ? `${testId}-headshot` : 'draft-player-headshot'
  const teamLogoTestBase = testId ? `${testId}-team-logo` : 'draft-player-team-logo'

  if (loading) {
    return (
      <div
        className="flex animate-pulse items-center gap-2 rounded-xl border border-white/15 bg-[#1f2d47]/90 px-2 py-2"
        aria-busy="true"
      >
        <div className="h-10 w-10 shrink-0 rounded-full bg-white/10" />
        <div className="flex-1 space-y-1">
          <div className="h-3 w-28 bg-white/10 rounded" />
          <div className="h-2 w-40 bg-white/10 rounded" />
        </div>
        <div className="h-8 w-20 shrink-0 rounded-md bg-white/[0.06]" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-2 text-xs text-amber-200">
        {error}
      </div>
    )
  }

  if (variant === 'card') {
    return (
      <div
        data-draft-player-card="true"
        data-variant="card"
        data-drafted={isDrafted ? 'true' : 'false'}
        data-testid={testId}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSelect?.()
        }}
        role={onSelect ? 'button' : undefined}
        tabIndex={onSelect ? 0 : undefined}
        className={`rounded-2xl border bg-gradient-to-b from-[#1b2f49] via-[#14263e] to-[#0f1a30] p-3.5 shadow-[0_18px_46px_rgba(0,0,0,0.35)] transition duration-200 hover:border-white/30 hover:shadow-[0_20px_52px_rgba(0,0,0,0.42)] ${
          isDrafted ? 'border-white/5 opacity-75' : 'border-white/12'
        } ${isDevy ? 'ring-1 ring-inset ring-violet-500/35' : ''}`}
      >
        <div className="flex items-start gap-3.5">
          <div className="relative h-[54px] w-[54px] shrink-0">
            <HeadshotOrFallback
              headshotUrl={headshotUrl}
              displayName={displayName}
              size={54}
              testIdBase={headshotTestBase}
            />
            <div className="absolute -bottom-1 -right-1 rounded border border-white/18 bg-[#141e35] p-px shadow-md">
              <TeamLogoOrFallback logoUrl={teamLogoUrl} teamAbbr={teamAbbr} size={20} testIdBase={teamLogoTestBase} />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="truncate text-[15px] font-bold tracking-tight text-white/98">{displayName}</p>
              <span className="rounded-md border border-cyan-300/30 bg-cyan-500/15 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-cyan-100">
                {position}
              </span>
              <span className="rounded-md border border-white/18 bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/90">
                {teamAbbr ?? 'FA'}
              </span>
              <DraftPlayerLabelBadge player={labelInput} />
              {devyLabel && (
                <span className="rounded bg-violet-500/25 px-1.5 py-0.5 text-[11px] font-medium text-violet-200" title="Devy / college">
                  {devyLabel}
                </span>
              )}
              {showPromoted && (
                <span className="rounded bg-emerald-500/25 px-1.5 py-0.5 text-[11px] font-medium text-emerald-200" title="Promoted to NFL">
                  Promoted
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-white/65">
              {[`${adpMetricLabel} ${formatAdpDisplay(displayedAdp)}`, ...(isNfl ? [`Bye ${formatBye(normalized.byeWeek)}`] : [])].join(' · ')}
            </p>
            {injuryStatus ? (
              <span className="mt-1 inline-flex max-w-full truncate rounded-md border border-rose-400/35 bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-rose-100">
                {injuryStatus}
              </span>
            ) : null}
            <p className="mt-1 text-[11px] text-white/78 line-clamp-2">{displayStatLine}</p>
          </div>
          {(compareAction || primaryAction || secondaryAction) && (
            <div
              className="mt-0.5 flex shrink-0 flex-col gap-1"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {primaryAction}
              <div className="flex items-center gap-1">
                {compareAction}
                {secondaryAction}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <article
      data-draft-player-card="true" data-variant="row"
      data-drafted={isDrafted ? 'true' : 'false'} data-testid={testId}
      className={`draft-readable-player rounded-xl border px-3 py-2 transition-colors focus-within:ring-2 focus-within:ring-cyan-300/70 ${isDrafted ? 'border-white/10 bg-black/25 opacity-60' : isSelected ? 'border-cyan-300/65 bg-cyan-950/60' : 'border-white/10 bg-[#0b1628] hover:border-cyan-400/40'}`}
    >
      <div className="draft-player-identity">
        <button type="button" onClick={onSelect} disabled={!onSelect}
          className="draft-player-detail flex min-w-0 items-center gap-3 text-left"
          aria-label={`View ${displayName} player details`}>
          <span className="relative shrink-0">
            <HeadshotOrFallback headshotUrl={headshotUrl} displayName={displayName}
              size={rowHeadshotSize} testIdBase={headshotTestBase} />
            <span className="absolute -bottom-0.5 -right-0.5 rounded bg-[#0a1228] p-px">
              <TeamLogoOrFallback logoUrl={teamLogoUrl} teamAbbr={teamAbbr} size={rowLogoSize} testIdBase={teamLogoTestBase} />
            </span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold leading-5 text-white"
              data-testid={testId ? `${testId}-name` : 'draft-player-name'}>{displayName}</span>
            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-slate-300">
              <span className="shrink-0 rounded bg-cyan-400/10 px-1.5 py-0.5 font-semibold text-cyan-100">{position}</span>
              <span className="truncate">{teamAbbr ?? 'Free agent'}</span>
              <DraftPlayerLabelBadge player={labelInput} className="shrink-0" />
              {isQueued ? <span className="shrink-0 text-amber-200">Queued</span> : null}
            </span>
          </span>
        </button>
        <div className="draft-player-metrics text-right text-xs tabular-nums text-slate-300">
          {displayedAdp != null ? <div>{adpMetricLabel}{' '}
            <span className="font-semibold text-cyan-200" data-testid={testId ? `${testId}-adp` : 'draft-player-adp'}>{formatAdpDisplay(displayedAdp)}</span>
          </div> : null}
          {isNfl && normalized.byeWeek != null && normalized.byeWeek > 0 ? <div>Bye{' '}
            <span data-testid={testId ? `${testId}-bye` : 'draft-player-bye'}>{formatBye(normalized.byeWeek)}</span>
          </div> : null}
        </div>
      </div>
      <div className="draft-player-actions flex shrink-0 items-center gap-1.5">
        {compareAction}{secondaryAction}{primaryAction}
      </div>
      {(injuryStatus || displayStatLine || devyLabel || resolvedDraftGrade || showPromoted || aiWarRoomBadge) ? (
        <div className="draft-player-context flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {injuryStatus ? <span className="rounded border border-rose-400/30 bg-rose-500/10 px-1.5 py-0.5 text-rose-200"
            data-testid={testId ? `${testId}-injury-status` : 'draft-player-injury-status'}>{injuryStatus}</span> : null}
          {displayStatLine ? <span className="truncate text-emerald-100/80" title={displayStatLine}
            data-testid={testId ? `${testId}-stats-summary` : 'draft-player-stats-summary'}>{displayStatLine}</span> : null}
          {devyLabel ? <span className="text-violet-200">{devyLabel}</span> : null}
          {resolvedDraftGrade ? <span className="text-amber-200">{resolvedDraftGrade}</span> : null}
          {resolvedClassYearLabel ? <span className="text-slate-300">{resolvedClassYearLabel}</span> : null}
          {resolvedProjectedLandingSpot ? <span className="text-slate-300">{resolvedProjectedLandingSpot}</span> : null}
          {showPromoted ? <span className="text-emerald-200">Promoted</span> : null}
          {aiWarRoomBadge ? <span className="text-cyan-200">{aiWarRoomBadge === 'ai_pick' ? 'AI Pick' : aiWarRoomBadge === 'value' ? 'Great Value' : 'Risky'}</span> : null}
        </div>
      ) : null}
      {showNflKickerSplits && nflDraftProjectionSplits?.kicking ? (
        <div className="draft-player-context text-xs text-emerald-100/75">
          FG {formatNflStatCell(nflDraftProjectionSplits.kicking.fg)} · XP {formatNflStatCell(nflDraftProjectionSplits.kicking.xpt)}
        </div>
      ) : null}
      {showNflSplitGrid && nflDraftProjectionSplits ? (
        <details className="draft-player-context min-w-0 border-t border-white/10 pt-1 text-xs">
          <summary className="cursor-pointer py-1 text-slate-300">Projection details</summary>
          <div className="overflow-x-auto overscroll-x-contain py-2"><NflDraftPoolStatsRow splits={nflDraftProjectionSplits} /></div>
        </details>
      ) : null}
    </article>
  )
}

export const DraftPlayerCard = React.memo(DraftPlayerCardInner)
