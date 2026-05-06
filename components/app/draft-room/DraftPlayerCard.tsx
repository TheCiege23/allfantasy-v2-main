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
      className={`inline-flex items-center justify-center rounded border border-white/15 bg-[#141e35] text-[9px] font-bold text-white/90 flex-shrink-0 shadow-sm ${className}`}
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
  const injuryStatus =
    display?.metadata?.injuryStatus ?? unifiedProductView?.unified.injuryStatus ?? unifiedProductView?.injuryStatus ?? null
  const resolvedSchool = school ?? display?.metadata?.collegeOrPipeline ?? null
  const resolvedClassYearLabel = display?.metadata?.classYearLabel ?? classYearLabel
  const resolvedDraftGrade = display?.metadata?.draftGrade ?? draftGrade
  const resolvedProjectedLandingSpot = display?.metadata?.projectedLandingSpot ?? projectedLandingSpot
  const devyLabel = resolvedSchool ?? (isDevy ? 'Devy' : null)
  const showPromoted = graduatedToNFL
  const showProBadge = poolType === 'pro'
  const showCollegeBadge = poolType === 'college' || (isDevy && !showProBadge)
  const showRookieBadge = Boolean(isRookie)

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
  const teamLogoUrl = normalized.teamLogoUrl ?? assets?.teamLogoUrl ?? null
  const rowHeadshotSize = rs ? 44 : 40
  const rowLogoSize = rs ? 18 : 16
  // Commit P — surface the explicit `projection` field as a stat-line
  // fallback when the upstream summary is absent. Pre-Commit-P the row
  // showed "No stats available" even when the resolver had a projected-
  // points number on the normalized payload (the field was computed in
  // `normalizePlayer` but never read by the card).
  const projectedPoints =
    typeof normalized.projection === 'number' && Number.isFinite(normalized.projection)
      ? normalized.projection
      : null
  const statLine =
    normalized.stats?.summary ??
    (projectedPoints != null
      ? `Proj ${projectedPoints.toFixed(1)} pts`
      : 'No stats available')
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
              <span className="rounded-md border border-cyan-300/30 bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-cyan-100">
                {position}
              </span>
              <span className="rounded-md border border-white/18 bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/90">
                {teamAbbr ?? 'FA'}
              </span>
              {showRookieBadge ? (
                <span className="rounded-md border border-lime-300/40 bg-lime-500/18 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-lime-100">
                  Rookie
                </span>
              ) : null}
              {devyLabel && (
                <span className="rounded bg-violet-500/25 px-1.5 py-0.5 text-[10px] font-medium text-violet-200" title="Devy / college">
                  {devyLabel}
                </span>
              )}
              {showPromoted && (
                <span className="rounded bg-emerald-500/25 px-1.5 py-0.5 text-[10px] font-medium text-emerald-200" title="Promoted to NFL">
                  Promoted
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-white/65">
              {[adpMetricLabel, formatAdpDisplay(normalized.adp), 'Bye', formatBye(normalized.byeWeek)].join(' · ')}
            </p>
            {injuryStatus ? (
              <span className="mt-1 inline-flex max-w-full truncate rounded-md border border-rose-400/35 bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-rose-100">
                {injuryStatus}
              </span>
            ) : null}
            <p className="mt-1 text-[11px] text-white/78 line-clamp-2">{statLine}</p>
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
    <li
      data-draft-player-card="true"
      data-variant="row"
      data-drafted={isDrafted ? 'true' : 'false'}
      data-testid={testId}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onSelect?.()
      }}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      className={`group flex min-w-0 flex-col gap-1 rounded-xl border px-2.5 py-2 text-[11px] backdrop-blur-sm transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 active:scale-[0.98] ${
        rs
          ? `shadow-[0_8px_28px_rgba(0,0,0,0.35)] ${
              isDrafted
                ? 'border-white/10 bg-black/40 opacity-50 saturate-50 hover:translate-y-0 hover:scale-100'
                : isSelected
                  ? 'border-cyan-300/55 bg-[linear-gradient(118deg,rgba(24,52,78,0.98)_0%,rgba(12,28,48,0.96)_100%)] ring-2 ring-cyan-400/35 ring-offset-2 ring-offset-[#040915] shadow-[0_12px_44px_rgba(34,211,238,0.15)]'
                  : 'border-cyan-500/25 bg-[linear-gradient(118deg,rgba(18,36,58,0.95)_0%,rgba(8,16,32,0.92)_55%,rgba(6,12,24,0.96)_100%)] hover:-translate-y-0.5 hover:scale-[1.01] hover:border-cyan-400/45 hover:shadow-[0_12px_40px_rgba(34,211,238,0.12)]'
            }`
          : `shadow-md transition duration-200 hover:-translate-y-1.5 hover:scale-[1.03] hover:border-cyan-300/70 hover:bg-[#1f3a52] hover:shadow-lg hover:shadow-cyan-500/20 ${
              isDrafted ? 'border-cyan-400/20 bg-[#0a1228]/70 opacity-60' : 'border-cyan-400/40 bg-gradient-to-r from-[#1a2f48] via-[#142438] to-[#0a1228] shadow-cyan-500/10'
            }`
      } ${isDevy ? 'border-l-[3px] border-l-violet-500/70' : ''}`}
    >
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5">
      <div className={`relative shrink-0 ${rs ? 'h-11 w-11' : 'h-10 w-10'}`}>
        <HeadshotOrFallback
          headshotUrl={headshotUrl}
          displayName={displayName}
          size={rowHeadshotSize}
          testIdBase={headshotTestBase}
        />
        <div className="absolute -bottom-0.5 -right-0.5 rounded border border-white/15 bg-[#0a1228] p-px shadow-md">
          <TeamLogoOrFallback logoUrl={teamLogoUrl} teamAbbr={teamAbbr} size={rowLogoSize} testIdBase={teamLogoTestBase} />
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p
            className={`truncate font-bold text-white ${rs ? 'text-[13px] tracking-tight' : ''}`}
            data-testid={testId ? `${testId}-name` : 'draft-player-name'}
          >
            {displayName}
          </p>
          {rs && (
            <span className="shrink-0 rounded-md border border-white/15 bg-black/35 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cyan-100/90">
              {position}
            </span>
          )}
          {!rs ? (
            <span className="shrink-0 rounded-md border border-cyan-300/30 bg-cyan-500/12 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-cyan-100/90">
              {position}
            </span>
          ) : null}
          <span className="shrink-0 rounded-md border border-white/16 bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-white/88">
            {teamAbbr ?? 'FA'}
          </span>
          {showRookieBadge ? (
            <span className="shrink-0 rounded-md border border-lime-300/35 bg-lime-500/18 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-lime-100">
              Rookie
            </span>
          ) : null}
          {isQueued && (
            <span
              className="shrink-0 rounded-full border border-amber-400/35 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-100"
              title="On your queue"
            >
              Queued
            </span>
          )}
          {showProBadge && (
            <span className="rounded bg-gradient-to-r from-cyan-500/40 to-cyan-400/25 px-1 py-0.5 text-[9px] font-medium text-cyan-100 shrink-0 border border-cyan-400/40 shadow-sm shadow-cyan-500/15" title="Pro / NFL">
              Pro
            </span>
          )}
          {showCollegeBadge && devyLabel && (
            <span className="rounded bg-violet-500/25 px-1 py-0.5 text-[9px] font-medium text-violet-200 shrink-0" title="College / devy">
              {devyLabel}
            </span>
          )}
          {resolvedDraftGrade && (
            <span className="rounded bg-amber-500/20 px-1 py-0.5 text-[9px] font-medium text-amber-100 shrink-0" title="Draft grade">
              {resolvedDraftGrade}
            </span>
          )}
          {showPromoted && (
            <span className="rounded bg-emerald-500/25 px-1 py-0.5 text-[9px] font-medium text-emerald-200 shrink-0" title="Promoted to NFL">
              Promoted
            </span>
          )}
          {aiWarRoomBadge === 'ai_pick' && (
            <span className="rounded bg-emerald-500/30 px-1 py-0.5 text-[9px] font-semibold text-emerald-100 shrink-0" title="AI recommendation">
              AI Pick
            </span>
          )}
          {aiWarRoomBadge === 'value' && (
            <span className="rounded bg-amber-500/28 px-1 py-0.5 text-[9px] font-semibold text-amber-100 shrink-0" title="Strong value">
              Great Value
            </span>
          )}
          {aiWarRoomBadge === 'risky' && (
            <span className="rounded bg-rose-500/30 px-1 py-0.5 text-[9px] font-semibold text-rose-100 shrink-0" title="Elevated risk">
              Risky
            </span>
          )}
        </div>
        <p className={`${rs ? 'text-[11px] text-white/75' : 'text-[10px] text-cyan-100/75'}`}>
          <span className="font-medium text-white/88">{teamAbbr ?? '—'}</span>
          {!rs ? ` · ${position}` : ''}
          {resolvedClassYearLabel ? ` · ${resolvedClassYearLabel}` : ''}
          {resolvedProjectedLandingSpot ? ` · ${resolvedProjectedLandingSpot}` : ''}
        </p>
        {injuryStatus ? (
          <span
            data-testid={testId ? `${testId}-injury-status` : 'draft-player-injury-status'}
            className={`mt-0.5 inline-block max-w-full truncate rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
              rs ? 'border-rose-400/35 bg-rose-500/15 text-rose-100' : 'border-rose-400/25 bg-rose-500/10 text-rose-100/90'
            }`}
          >
            {injuryStatus}
          </span>
        ) : null}
        <p
          data-testid={testId ? `${testId}-stats-summary` : 'draft-player-stats-summary'}
          className={`truncate ${rs ? 'mt-1 text-[10px] text-emerald-100/80' : 'text-[10px] text-cyan-100/55'}`}
          title={statLine}
        >
          {statLine}
        </p>
        {rs &&
        display?.stats?.secondaryStatLabel != null &&
        display.stats.secondaryStatValue != null ? (
          <p
            className="text-[10px] text-emerald-200/75 truncate"
            title={`${display.stats.secondaryStatLabel} ${display.stats.secondaryStatValue}`}
          >
            {display.stats.secondaryStatLabel} {display.stats.secondaryStatValue}
          </p>
        ) : null}
      </div>

      <div
        className="flex shrink-0 flex-col items-end gap-1.5"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div
          className={`text-right text-[10px] tabular-nums font-semibold ${rs ? 'rounded-lg border border-white/10 bg-black/25 px-1.5 py-1 text-cyan-50' : 'text-cyan-100'}`}
        >
          <div>
            <span className={rs ? 'text-[9px] font-medium text-white/45' : ''}>{adpMetricLabel}</span>{' '}
            <span
              className="text-cyan-300"
              data-testid={testId ? `${testId}-adp` : 'draft-player-adp'}
            >
              {formatAdpDisplay(normalized.adp)}
            </span>
          </div>
          <div className={rs ? 'mt-0.5' : ''}>
            Bye{' '}
            <span
              className="text-cyan-300"
              data-testid={testId ? `${testId}-bye` : 'draft-player-bye'}
            >
              {formatBye(normalized.byeWeek)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">{compareAction}{secondaryAction}{primaryAction}</div>
      </div>
      </div>
      {showNflKickerSplits && nflDraftProjectionSplits?.kicking ? (
        <div className="border-t border-white/[0.06] pt-1.5 pl-2 sm:pl-[52px]">
          <p className="text-[10px] tabular-nums text-emerald-100/75">
            FG {formatNflStatCell(nflDraftProjectionSplits.kicking.fg)} · XP{' '}
            {formatNflStatCell(nflDraftProjectionSplits.kicking.xpt)}
          </p>
        </div>
      ) : null}
      {showNflSplitGrid && nflDraftProjectionSplits ? (
        // Slice D.1.5: the per-row stat strip used to be hidden behind `max-sm:hidden sm:block`,
        // which meant any pool panel narrower than 640px (the typical draft layout) had no visible
        // stats and the column header at the top of the panel had nothing aligned beneath it.
        // Now we always render it; the inner div allows horizontal scroll on narrow widths.
        // mt-2 + bg accent gives the strip its own visual band so 13 dashes don't blend into the
        // 1px border above.
        <div className="mt-2 rounded-md bg-white/[0.03] border border-white/[0.06] py-1 px-2 sm:pl-[52px]">
          <div className="-mx-1 overflow-x-auto overscroll-x-contain px-1 [scrollbar-color:rgba(56,189,248,0.35)_rgba(15,23,42,0.5)]">
            <NflDraftPoolStatsRow splits={nflDraftProjectionSplits} />
          </div>
        </div>
      ) : null}
    </li>
  )
}

export const DraftPlayerCard = React.memo(DraftPlayerCardInner)
