'use client'

import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Search, User, Plus, GitCompare, LayoutGrid, Rows3, X } from 'lucide-react'
import { usePlayerComparisonUIOptional } from '@/components/player-comparison-ui'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { applyDraftFilters, DRAFT_ROOM_I18N_KEYS, getPickConfirmationLabel, getPositionFilterOptionsForSport } from '@/lib/draft-room'
import { DraftPlayerCard } from './DraftPlayerCard'
import { SleeperPoolTable } from './SleeperPoolTable'
import {
  applyPoolSort,
  nextSortState,
  sortKeyForColumn,
  type PoolSortKey,
  type PoolSortState,
} from './SleeperPoolSort'
// NflDraftPoolStatsGroupHeader import removed in Slice D.1.5 Path B; re-add when D.2 ships the
// Sleeper-style table mode and rows actually align to those columns.
import { PlayerDetailModal, type DraftAssistantRoomContext } from './PlayerDetailModal'
import type { PlayerDisplayModel } from '@/lib/draft-sports-models/types'
import type { UnifiedPlayerProductView } from '@/lib/player-data/unifiedPlayerProductView'
import { normalizePlayer } from '@/lib/players/normalizePlayer'
import { DRAFT_ROOM } from '@/lib/analytics/eventNames'
import { sendProductAnalyticsBeacon } from '@/lib/analytics/client'
import type { DraftCopilotInsight } from '@/lib/draft-room/draft-copilot-types'
import type { NflDraftProjectionSplits } from '@/lib/draft/analytics/nfl-draft-pool-projection-splits'
import { isRookieEligibleForFilter, isVetEligibleForFilter } from '@/lib/draft-room/rookieFilterPredicate'
import { sleeperPoolStatOptionsFromPositionFilter } from '@/lib/draft-room/sleeperPoolTableLayout'
import { getDraftRoomRookieDataState, type DraftRoomRookiePlayerLike } from '@/lib/draft-room/draftPlayerRookie'
import { buildRookieSignalDiagnostics } from '@/lib/draft-room/draftRoomRookieDiagnostics'
import {
  getDraftRoomPositionGroupCounts,
  poolPlayerMatchesPositionPill,
} from '@/lib/draft-room/draftPoolPositionGroups'
import {
  logDraftPoolAdpDiagnosticsIfNeeded,
  logDraftPoolPositionDiagnosticsIfNeeded,
} from '@/lib/draft-room/draftPoolDiagnostics'
import { formatAiAdpUnavailableBanner } from '@/lib/draft-room/adpReadinessCopy'
import { getDraftRoomDisplayHeadshot, getDraftRoomDisplayInjury } from '@/lib/player-data/adapters/draftRoomDisplayFields'

const PLAYER_ROW_ESTIMATE_HEIGHT = 76
/** Redraft rows use slightly taller estimate (chips + stats). */
const PLAYER_ROW_ESTIMATE_HEIGHT_REDRAFT = 104
const DRAFT_WATCHLIST_STORAGE_KEY = 'af:draft-room-watchlist-v1'

/** Align with draft room session: drafted name set is normalized lowercase. */
function isPlayerNameDrafted(name: string, draftedNames: Set<string>): boolean {
  return draftedNames.has(name.trim().toLowerCase())
}

/** Prefer stable player IDs when pool rows carry them — avoids ambiguity + matches pick API guards. */
function isPlayerDraftedEntry(
  p: PlayerEntry,
  draftedNames: Set<string>,
  draftedPlayerIds?: ReadonlySet<string> | null,
): boolean {
  const ids = draftedPlayerIds
  if (ids && ids.size > 0) {
    const pid =
      (p.display?.playerId != null ? String(p.display.playerId).trim() : '') ||
      (p.id != null ? String(p.id).trim() : '')
    if (pid && ids.has(pid)) return true
  }
  return isPlayerNameDrafted(p.name, draftedNames)
}

export type PlayerEntry = {
  id?: string
  /** Stable sport / provider id when the pool row carries it (may mirror `display.playerId`). */
  playerId?: string | null
  name: string
  position: string
  team: string | null
  adp?: number | null
  byeWeek?: number | null
  aiAdp?: number | null
  aiAdpSampleSize?: number
  aiAdpLowSample?: boolean
  /** Normalized display model for player image, team logo, stats */
  display?: PlayerDisplayModel | null
  /** Devy: true when from college/devy pool */
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
  nflDraftProjectionSplits?: NflDraftProjectionSplits | null
  /** D.7 — NFL years of pro experience (Sleeper). 0 = rookie, null/undefined = unknown. */
  yearsExp?: number | null
  /** D.7 — derived rookie flag (true when yearsExp === 0 or upstream marked as rookie). */
  isRookie?: boolean
  /** Provider-prioritized unified layer for fallback image/injury/source metadata */
  unifiedProductView?: UnifiedPlayerProductView | null
}

export type PlayerPanelProps = {
  players: PlayerEntry[]
  draftedNames: Set<string>
  /** Draft session pick playerIds — disables rows by id when available (reduces name-only ambiguity). */
  draftedPlayerIds?: ReadonlySet<string>
  sport: string
  /** When user is on clock, show Draft button */
  canDraft: boolean
  onAddToQueue: (player: PlayerEntry) => void
  onMakePick: (player: PlayerEntry) => void
  /** Show current user's drafted roster (roster view) */
  currentRoster?: Array<{ playerName: string; position: string; team: string | null }>
  useAiAdp?: boolean
  onUseAiAdpChange?: (value: boolean) => void
  loading?: boolean
  /** When true, AI ADP is enabled but no data (show message, keep sort controls working) */
  aiAdpUnavailable?: boolean
  /** Optional message when AI ADP is enabled but unavailable */
  aiAdpUnavailableMessage?: string | null
  /** When true, AI ADP snapshot is older than freshness window */
  aiAdpStaleWarning?: boolean
  /** When true, segment or entries have low sample size (show warning) */
  aiAdpLowSampleWarning?: boolean
  /** Auction: when true, show Nominate as primary action (instead of Draft) */
  canNominate?: boolean
  /** Auction: called when user clicks Nominate for a player */
  onNominate?: (player: PlayerEntry) => void
  /** Devy: when enabled, show Pro/Devy filter and devy round hint */
  devyConfig?: { enabled: boolean; devyRounds: number[] }
  /** C2C: when enabled, show College/Pro filter and college/pro round hint */
  c2cConfig?: { enabled: boolean; collegeRounds: number[] }
  /** Current draft round (for devy/C2C round hints) */
  currentRound?: number
  /** When 'IDP', position filter includes Offense, DL, LB, DB, DE, DT, CB, S, IDP FLEX */
  formatType?: string
  /** Optional external selection target (e.g. from helper recommendation click). */
  selectedPlayerTarget?: { name: string; position: string; team?: string | null } | null
  /** League context for premium comparison (coach lens when API supports it). */
  leagueId?: string
  /** War Room AI row hints keyed by `name|position` (lowercase). */
  aiRowBadges?: Record<string, 'ai_pick' | 'value' | 'risky'>
  presentationVariant?: 'default' | 'redraft_snake'
  /** D.2 — explicit pool layout opt-out. Defaults to 'auto' which picks
   * Sleeper-style table for NFL redraft/snake on desktop and falls back to
   * the existing card layout everywhere else. Pass 'card' to force the legacy
   * card layout (useful for non-NFL sports or modal/detail contexts that reuse
   * PlayerPanel internals). */
  poolLayout?: 'auto' | 'card' | 'sleeper_table'
  /** Redraft live room: player detail “copilot” copy from recommendations + War Room. */
  getDraftCopilotInsight?: (player: PlayerEntry) => DraftCopilotInsight | null
  /** Headline / injury / digest strip from assistant-context for the selected player. */
  getAssistantRoomContext?: (player: PlayerEntry) => DraftAssistantRoomContext | null
  /** Mark rows that match the user's draft queue (best-effort name + position). */
  isPlayerQueued?: (player: PlayerEntry) => boolean
  /** Calendar season for rookie-class inference (NFL/NCAAF draft year match). Defaults internally if omitted. */
  draftSeasonYear?: number
}

/** D.3 — re-exposed from SleeperPoolSort. Kept as `SortKey` for legacy call sites. */
type SortKey = PoolSortKey

function PlayerListVirtualized({
  filtered,
  draftedNames,
  draftedPlayerIds,
  presentationVariant,
  selectedPlayer,
  isPlayerQueued,
  canDraft,
  canNominate,
  useAiAdp,
  onDraftRequest,
  onAddToQueue,
  onNominateRequest,
  onPlayerSelect,
  scrollRef,
  compareAnchor,
  onCompareTap,
  draftSport,
  aiRowBadges,
}: {
  filtered: PlayerEntry[]
  draftedNames: Set<string>
  draftedPlayerIds?: ReadonlySet<string> | null
  presentationVariant?: 'default' | 'redraft_snake'
  selectedPlayer: PlayerEntry | null
  isPlayerQueued?: (player: PlayerEntry) => boolean
  canDraft: boolean
  canNominate: boolean
  useAiAdp: boolean
  draftSport: string
  onDraftRequest: (player: PlayerEntry) => void
  onAddToQueue: (player: PlayerEntry) => void
  onNominateRequest?: (player: PlayerEntry) => void
  onPlayerSelect: (player: PlayerEntry) => void
  scrollRef: React.RefObject<HTMLDivElement | null>
  compareAnchor: PlayerEntry | null
  onCompareTap: (player: PlayerEntry) => void
  aiRowBadges?: Record<string, 'ai_pick' | 'value' | 'risky'>
}) {
  const rs = presentationVariant === 'redraft_snake'
  const rowKey = (p: PlayerEntry) =>
    `${p.name.trim().toLowerCase()}|${p.position.trim().toLowerCase()}|${String(p.team ?? '').trim().toLowerCase()}`
  const selectedKey = selectedPlayer ? rowKey(selectedPlayer) : null

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (rs ? PLAYER_ROW_ESTIMATE_HEIGHT_REDRAFT : PLAYER_ROW_ESTIMATE_HEIGHT),
    overscan: rs ? 8 : 5,
  })

  const items = virtualizer.getVirtualItems()

  return (
    <div
      style={{
        height: `${virtualizer.getTotalSize()}px`,
        width: '100%',
        position: 'relative',
      }}
    >
      {items.map((virtualRow) => {
        const p = filtered[virtualRow.index]
        const sel = selectedKey != null && rowKey(p) === selectedKey
        return (
          <div
            key={p.id ?? rowKey(p)}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualRow.start}px)`,
            }}
            data-index={virtualRow.index}
          >
            <DraftPlayerCard
              display={p.display ?? null}
              unifiedProductView={p.unifiedProductView ?? null}
              name={p.name}
              position={p.position}
              team={p.team}
              adp={useAiAdp ? p.aiAdp : p.adp}
              adpMetricLabel={useAiAdp ? 'AI ADP' : 'ADP'}
              byeWeek={p.byeWeek}
              draftSport={draftSport}
              presentationVariant={presentationVariant}
              isSelected={sel}
              isQueued={Boolean(isPlayerQueued?.(p))}
              aiWarRoomBadge={aiRowBadges?.[`${p.name.trim().toLowerCase()}|${p.position.trim().toLowerCase()}`] ?? null}
              isDrafted={isPlayerDraftedEntry(p, draftedNames, draftedPlayerIds)}
              variant="row"
              isDevy={p.isDevy}
              school={p.school}
              classYearLabel={p.classYearLabel}
              draftGrade={p.draftGrade}
              projectedLandingSpot={p.projectedLandingSpot}
              graduatedToNFL={p.graduatedToNFL}
              poolType={p.poolType}
              isRookie={p.isRookie ?? false}
              nflDraftProjectionSplits={p.nflDraftProjectionSplits ?? null}
              testId={`draft-player-card-${virtualRow.index}`}
              onSelect={() => onPlayerSelect(p)}
              compareAction={
                <button
                  type="button"
                  onClick={() => onCompareTap(p)}
                  data-testid={`draft-compare-player-${virtualRow.index}`}
                  className={`inline-flex min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center rounded-lg border px-2 transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/45 active:scale-95 sm:min-w-0 sm:px-2 ${
                    compareAnchor?.name === p.name
                      ? 'border-amber-400/60 bg-gradient-to-br from-amber-500/20 to-amber-600/10 text-amber-100 shadow-[0_0_18px_rgba(251,191,36,0.15)]'
                      : 'border-white/15 bg-black/25 text-white/75 hover:border-white/28 hover:bg-white/12'
                  }`}
                  aria-label={
                    compareAnchor?.name === p.name
                      ? 'Clear compare selection'
                      : 'Select player for head-to-head compare'
                  }
                  title="Compare: pick a second player"
                >
                  <GitCompare className="h-4 w-4" />
                </button>
              }
              primaryAction={
                canNominate && onNominateRequest ? (
                  <button
                    type="button"
                    onClick={() => onNominateRequest(p)}
                    data-testid={`draft-nominate-player-${virtualRow.index}`}
                    className="inline-flex min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center rounded-lg border border-amber-400/45 bg-gradient-to-br from-amber-500/18 to-amber-600/8 px-3 py-2 text-xs font-semibold text-amber-100 shadow-[0_4px_20px_rgba(245,158,11,0.15)] transition duration-150 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/50 active:scale-95 sm:min-w-0 sm:px-2 sm:py-1"
                  >
                    Nominate
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!canDraft || isPlayerDraftedEntry(p, draftedNames, draftedPlayerIds)}
                    title={
                      isPlayerDraftedEntry(p, draftedNames, draftedPlayerIds)
                        ? 'Player already drafted'
                        : !canDraft
                          ? 'Not your turn'
                          : 'Draft this player'
                    }
                    onClick={() => {
                      if (!canDraft || isPlayerDraftedEntry(p, draftedNames, draftedPlayerIds)) return
                      onDraftRequest(p)
                    }}
                    data-testid={`draft-player-button-${virtualRow.index}`}
                    className={`inline-flex min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center rounded-lg border px-3 py-2 text-xs font-semibold transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/45 active:scale-95 sm:min-w-0 sm:px-2 sm:py-1 ${
                      isPlayerDraftedEntry(p, draftedNames, draftedPlayerIds)
                        ? 'cursor-not-allowed border-white/10 bg-white/[0.04] text-white/30'
                        : !canDraft
                          ? 'cursor-not-allowed border-white/10 bg-black/30 text-white/32'
                          : 'border-cyan-400/45 bg-gradient-to-br from-cyan-500/22 to-violet-600/15 text-cyan-50 shadow-[0_4px_22px_rgba(34,211,238,0.2)] hover:brightness-110 hover:shadow-[0_6px_28px_rgba(34,211,238,0.28)]'
                    }`}
                  >
                    {isPlayerDraftedEntry(p, draftedNames, draftedPlayerIds) ? 'Drafted' : 'Draft'}
                  </button>
                )
              }
              secondaryAction={
                <button
                  type="button"
                  onClick={() => onAddToQueue(p)}
                  data-testid={`draft-queue-add-${virtualRow.index}`}
                  className="inline-flex min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center rounded-lg border border-white/16 bg-black/25 text-white/75 transition duration-150 hover:border-cyan-400/25 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 active:scale-95"
                  aria-label={`Add ${p.name} to queue`}
                >
                  <Plus className="h-4 w-4" />
                </button>
              }
            />
          </div>
        )
      })}
    </div>
  )
}

function PlayerPanelInner({
  players,
  draftedNames,
  draftedPlayerIds,
  sport,
  canDraft,
  onAddToQueue,
  onMakePick,
  currentRoster = [],
  useAiAdp = false,
  onUseAiAdpChange,
  loading = false,
  aiAdpUnavailable = false,
  aiAdpUnavailableMessage = null,
  aiAdpStaleWarning = false,
  aiAdpLowSampleWarning = false,
  canNominate = false,
  onNominate,
  devyConfig,
  c2cConfig,
  currentRound,
  formatType,
  selectedPlayerTarget = null,
  leagueId,
  aiRowBadges,
  presentationVariant = 'default',
  poolLayout = 'auto',
  getDraftCopilotInsight,
  getAssistantRoomContext,
  isPlayerQueued,
  draftSeasonYear,
}: PlayerPanelProps) {
  const rs = presentationVariant === 'redraft_snake'
  const draftedIdsForRows = draftedPlayerIds?.size ? draftedPlayerIds : undefined
  const { t } = useLanguage()
  const compareUi = usePlayerComparisonUIOptional()
  const [compareAnchor, setCompareAnchor] = useState<PlayerEntry | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  /** User-facing view-mode override; null defers to the auto rule below. */
  const [viewModeOverride, setViewModeOverride] = useState<'sleeper_table' | 'card' | null>(null)
  const [positionFilter, setPositionFilter] = useState('All')
  const [teamFilter, setTeamFilter] = useState('All')
  const [poolFilter, setPoolFilter] = useState<'All' | 'Pro' | 'Devy' | 'College'>('All')
  const [sortBy, setSortBy] = useState<SortKey>('adp')
  /** D.3 — sort direction. Toolbar buttons + table headers both flip this when re-clicked. */
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [showRosterView, setShowRosterView] = useState(false)
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerEntry | null>(null)
  const [pendingNomination, setPendingNomination] = useState<PlayerEntry | null>(null)
  const [watchlistOnly, setWatchlistOnly] = useState(false)
  const [rookiesOnly, setRookiesOnly] = useState(false)
  /** Commit N — companion to `rookiesOnly`. Mutually exclusive with rookies-only;
   *  toggling one turns the other off so the user can't accidentally produce an
   *  empty intersection. */
  const [vetsOnly, setVetsOnly] = useState(false)
  const [hideDrafted, setHideDrafted] = useState(true)
  const [watchlistKeys, setWatchlistKeys] = useState<Set<string>>(new Set())
  const isDevyRound = Boolean(devyConfig?.enabled && !c2cConfig?.enabled && currentRound != null && devyConfig.devyRounds?.includes(currentRound))
  const isCollegeRound = Boolean(c2cConfig?.enabled && currentRound != null && c2cConfig.collegeRounds?.includes(currentRound))
  const isProRound = Boolean(c2cConfig?.enabled && currentRound != null && !c2cConfig.collegeRounds?.includes(currentRound))
  const showPoolFilter = Boolean(devyConfig?.enabled || c2cConfig?.enabled)

  const positionOptions = useMemo(
    () => getPositionFilterOptionsForSport(sport, formatType),
    [sport, formatType],
  )

  /**
   * D.6.1 — pill counts. Shows `<drafted>/<available>` per position so the user can
   * see at a glance "I've drafted 0 RBs out of 88 available". `drafted` comes from
   * the viewer's currentRoster prop; `available` is the count of pool players that
   * still match this position filter (excluding already-drafted players).
   *
   * For "All", `available` is the full undrafted pool.
   */
  const positionPillCounts = useMemo(() => {
    const draftedByPos: Record<string, number> = {}
    for (const r of currentRoster ?? []) {
      const k = String(r.position ?? '').trim().toUpperCase()
      if (!k) continue
      draftedByPos[k] = (draftedByPos[k] ?? 0) + 1
    }
    const available = (filterValue: string): number => {
      const v = filterValue.trim().toUpperCase()
      if (v === 'ALL') {
        return players.filter(
          (p) => !isPlayerDraftedEntry(p, draftedNames, draftedPlayerIds),
        ).length
      }
      return players.filter((p) => {
        if (isPlayerDraftedEntry(p, draftedNames, draftedPlayerIds)) return false
        return poolPlayerMatchesPositionPill(p.position, filterValue, {
          sport,
          formatType,
        })
      }).length
    }
    return positionOptions.map((opt) => {
      const k = String(opt.value).trim().toUpperCase()
      // Same alias group as the available-count above: DEF/DST/D/ST
      // pillside drafted total should sum across all defense rows.
      const draftedCount =
        k === 'K'
          ? (draftedByPos.K ?? 0) + (draftedByPos.PK ?? 0)
          : k === 'DEF' || k === 'DST' || k === 'D/ST'
            ? (draftedByPos.DEF ?? 0) + (draftedByPos.DST ?? 0) + (draftedByPos['D/ST'] ?? 0)
            : (draftedByPos[k] ?? 0)
      return {
        value: opt.value,
        label: opt.label,
        drafted: draftedCount,
        available: available(String(opt.value)),
      }
    })
  }, [positionOptions, players, currentRoster, draftedNames, draftedPlayerIds, sport, formatType])

  const rookieFilterContext = useMemo(
    () => ({
      sport,
      seasonYear: draftSeasonYear,
      devyEnabled: devyConfig?.enabled,
      c2cEnabled: c2cConfig?.enabled,
    }),
    [sport, draftSeasonYear, devyConfig?.enabled, c2cConfig?.enabled],
  )

  const rookieDataState = useMemo(
    () => getDraftRoomRookieDataState(players, rookieFilterContext),
    [players, rookieFilterContext],
  )

  const hasSecondaryPoolFilters = useMemo(
    () =>
      searchQuery.trim().length > 0 ||
      positionFilter !== 'All' ||
      teamFilter !== 'All' ||
      poolFilter !== 'All' ||
      watchlistOnly ||
      vetsOnly ||
      !hideDrafted,
    [searchQuery, positionFilter, teamFilter, poolFilter, watchlistOnly, vetsOnly, hideDrafted],
  )

  useEffect(() => {
    if (players.length === 0) return
    const undrafted = players.filter((p) => !isPlayerDraftedEntry(p, draftedNames, draftedPlayerIds))
    const counts = getDraftRoomPositionGroupCounts(undrafted, { sport, formatType })
    logDraftPoolPositionDiagnosticsIfNeeded({
      sport,
      leagueId: leagueId ?? null,
      totalPlayers: undrafted.length,
      counts,
      samplePositions: undrafted.slice(0, 40).map((p) => String(p.position ?? '')),
    })
    let sys = 0
    let ai = 0
    let neither = 0
    for (const p of undrafted) {
      const hasS = p.adp != null && Number.isFinite(Number(p.adp))
      const hasA = p.aiAdp != null && Number.isFinite(Number(p.aiAdp))
      if (hasS) sys += 1
      if (hasA) ai += 1
      if (!hasS && !hasA) neither += 1
    }
    logDraftPoolAdpDiagnosticsIfNeeded({
      sport,
      leagueId: leagueId ?? null,
      withSystemAdp: sys,
      withAiAdp: ai,
      withNeither: neither,
    })
  }, [players, draftedNames, draftedPlayerIds, sport, formatType, leagueId])

  const teamOptions = useMemo(() => {
    const teams = new Set(players.map((p) => p.team).filter(Boolean) as string[])
    return ['All', ...Array.from(teams).sort()]
  }, [players])

  /** Aligns pool sort + Sleeper table columns with the active position pill (IDP / MLB SP / NHL G). */
  const sleeperStatOpts = useMemo(
    () => sleeperPoolStatOptionsFromPositionFilter(sport, positionFilter),
    [sport, positionFilter],
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const watchKeyFor = useCallback((p: PlayerEntry) => {
    return [String(p.id ?? '').trim(), p.name.trim().toLowerCase(), p.position.trim().toLowerCase(), String(p.team ?? '').trim().toLowerCase()].join('|')
  }, [])

  const selectedNormalized = useMemo(
    () => (selectedPlayer ? normalizePlayer(selectedPlayer) : null),
    [selectedPlayer],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(DRAFT_WATCHLIST_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as string[]
      if (Array.isArray(parsed)) {
        setWatchlistKeys(new Set(parsed.filter((v) => typeof v === 'string' && v.length > 0)))
      }
    } catch {
      // ignore malformed storage
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(DRAFT_WATCHLIST_STORAGE_KEY, JSON.stringify(Array.from(watchlistKeys)))
    } catch {
      // ignore storage failure
    }
  }, [watchlistKeys])

  const filtered = useMemo(() => {
    let list = hideDrafted
      ? players.filter((p) => !isPlayerDraftedEntry(p, draftedNames, draftedIdsForRows))
      : [...players]
    if (watchlistOnly) {
      list = list.filter((p) => watchlistKeys.has(watchKeyFor(p)))
    }
    if (rookiesOnly) {
      list = list.filter((p) => isRookieEligibleForFilter(p, rookieFilterContext))
    }
    // Commit N — Vets Only filter. Predicate is evidence-required (not a
    // simple negation of rookie) so rows with missing metadata don't get
    // accidentally counted as vets.
    if (vetsOnly) {
      list = list.filter((p) => isVetEligibleForFilter(p))
    }
    if (teamFilter !== 'All') {
      list = list.filter((p) => p.team === teamFilter)
    }
    if (c2cConfig?.enabled && poolFilter !== 'All') {
      if (poolFilter === 'College') list = list.filter((p) => p.poolType === 'college' || (p.isDevy === true && p.poolType !== 'pro'))
      else if (poolFilter === 'Pro') list = list.filter((p) => p.poolType === 'pro' || (p.isDevy !== true && p.poolType !== 'college'))
    } else if (devyConfig?.enabled && poolFilter !== 'All') {
      if (poolFilter === 'Devy') list = list.filter((p) => p.isDevy === true)
      else if (poolFilter === 'Pro') list = list.filter((p) => p.isDevy !== true)
    }
    const asDraftPlayers = list.map((p) => ({
      name: p.name,
      position: p.position,
      team: p.team,
      adp: p.adp ?? undefined,
    }))
    const filteredDraft = applyDraftFilters(asDraftPlayers, {
      searchQuery,
      positionFilter,
      draftedNames,
      showDrafted: !hideDrafted,
    })
    const searchLower = searchQuery.trim().toLowerCase()
    list = list.filter((p) => {
      const inResolved = filteredDraft.some((d) => d.name === p.name && d.position === p.position)
      const schoolMatch = Boolean(searchLower && (p.school ?? '').toLowerCase().includes(searchLower))
      const landingSpotMatch = Boolean(searchLower && (p.projectedLandingSpot ?? '').toLowerCase().includes(searchLower))
      return inResolved || schoolMatch || landingSpotMatch
    })
    /** D.3 — single sort path covers both toolbar (adp/aiAdp/projected/name) and table-header
     * sorts (bye/pts/avg + rushing/receiving/passing splits). Nulls always sort last; tiebreak is ADP asc then name asc. */
    list = applyPoolSort<PlayerEntry>(list, { key: sortBy, direction: sortDirection }, sport, sleeperStatOpts)
    return list
  }, [
    players,
    draftedNames,
    draftedIdsForRows,
    hideDrafted,
    watchlistOnly,
    rookiesOnly,
    vetsOnly,
    watchlistKeys,
    watchKeyFor,
    searchQuery,
    positionFilter,
    teamFilter,
    poolFilter,
    devyConfig?.enabled,
    c2cConfig?.enabled,
    sortBy,
    sortDirection,
    useAiAdp,
    sport,
    sleeperStatOpts,
    rookieFilterContext,
  ])

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    if (!rookiesOnly) return
    if (filtered.length > 0) return
    if (players.length === 0) return
    const seasonYear = rookieFilterContext.seasonYear ?? new Date().getUTCFullYear()
    console.info(
      '[draft-room] rookies-only empty — signal diagnostics',
      buildRookieSignalDiagnostics(players as DraftRoomRookiePlayerLike[], sport, seasonYear),
    )
  }, [rookiesOnly, filtered.length, players, sport, rookieFilterContext])

  const selectedIsWatchlisted = selectedPlayer ? watchlistKeys.has(watchKeyFor(selectedPlayer)) : false

  useEffect(() => {
    if (!showPoolFilter || currentRound == null) return
    if (c2cConfig?.enabled) {
      setPoolFilter(isCollegeRound ? 'College' : 'Pro')
      return
    }
    if (devyConfig?.enabled) {
      setPoolFilter(isDevyRound ? 'Devy' : 'Pro')
    }
  }, [showPoolFilter, currentRound, c2cConfig?.enabled, devyConfig?.enabled, isCollegeRound, isDevyRound])

  useEffect(() => {
    if (!selectedPlayerTarget?.name) return
    const match = players.find(
      (p) =>
        p.name.toLowerCase() === selectedPlayerTarget.name.toLowerCase() &&
        p.position.toLowerCase() === (selectedPlayerTarget.position || '').toLowerCase()
    )
    if (!match) return
    setShowRosterView(false)
    setSelectedPlayer(match)
    setSearchQuery(match.name)
  }, [selectedPlayerTarget?.name, selectedPlayerTarget?.position, players])

  /** D.3 — single sort change entry point used by both the legacy toolbar buttons
   * and the new SleeperPoolTable header buttons. Same key → flip direction; new
   * key → switch to that key's default direction. */
  const handleSortChange = useCallback(
    (requestedKey: SortKey) => {
      const next = nextSortState({ key: sortBy, direction: sortDirection }, requestedKey)
      setSortBy(next.key)
      setSortDirection(next.direction)
    },
    [sortBy, sortDirection],
  )

  /** D.3 — adapter used by SleeperPoolTable header buttons. The table emits column keys
   * ('rk', 'player', 'avg', 'pa_int' …); we resolve them through `sortKeyForColumn`. */
  const handleColumnHeaderSort = useCallback(
    (columnKey: string) => {
      const sortKey = sortKeyForColumn(columnKey, sport)
      if (!sortKey) return
      handleSortChange(sortKey)
    },
    [handleSortChange, sport],
  )

  const onCompareTap = useCallback(
    (p: PlayerEntry) => {
      if (!compareAnchor) {
        setCompareAnchor(p)
        return
      }
      if (compareAnchor.name === p.name) {
        setCompareAnchor(null)
        return
      }
      const payload = {
        playerA: compareAnchor.name,
        playerB: p.name,
        sport,
        leagueId: leagueId ?? null,
        source: 'draft' as const,
      }
      if (compareUi) {
        compareUi.openComparison(payload)
      } else if (typeof window !== 'undefined') {
        const q = new URLSearchParams({
          playerA: payload.playerA,
          playerB: payload.playerB,
          sport: payload.sport,
        })
        if (leagueId) q.set('leagueId', leagueId)
        window.location.href = `/player-compare?${q.toString()}`
      }
      setCompareAnchor(null)
    },
    [compareAnchor, compareUi, leagueId, sport]
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onFocusSearch = () => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
    window.addEventListener('af:draft-player-search-focus', onFocusSearch)
    return () => window.removeEventListener('af:draft-player-search-focus', onFocusSearch)
  }, [])

  useEffect(() => {
    if (!leagueId) return
    const q = searchQuery.trim()
    if (q.length < 2) return
    const id = window.setTimeout(() => {
      sendProductAnalyticsBeacon(DRAFT_ROOM.SEARCH, { leagueId, len: q.length })
    }, 750)
    return () => window.clearTimeout(id)
  }, [searchQuery, leagueId])

  useEffect(() => {
    if (!selectedPlayer) return
    if (isPlayerDraftedEntry(selectedPlayer, draftedNames, draftedIdsForRows)) {
      setSelectedPlayer(null)
    }
  }, [draftedNames, draftedIdsForRows, selectedPlayer])

  const clearAllFilters = useCallback(() => {
    setSearchQuery('')
    setPositionFilter('All')
    setTeamFilter('All')
    setPoolFilter('All')
    setWatchlistOnly(false)
    setRookiesOnly(false)
    setVetsOnly(false)
    setHideDrafted(true)
  }, [])

  /**
   * Commit N — mutual exclusion between rookies-only and vets-only. Toggling
   * one off when the other is being turned on prevents the empty
   * intersection (a player can't be both a rookie and a vet).
   */
  const toggleRookiesOnly = useCallback(() => {
    setRookiesOnly((v) => {
      const next = !v
      if (next) setVetsOnly(false)
      return next
    })
  }, [])

  const toggleVetsOnly = useCallback(() => {
    setVetsOnly((v) => {
      const next = !v
      if (next) setRookiesOnly(false)
      return next
    })
  }, [])

  return (
    <section
      className={
        rs
          ? 'relative flex h-full min-h-0 max-h-full flex-1 flex-col overflow-hidden rounded-2xl border border-cyan-500/20 bg-[linear-gradient(168deg,rgba(12,24,44,0.95)_0%,rgba(5,10,20,0.98)_100%)] shadow-[0_20px_64px_rgba(0,0,0,0.5),0_0_0_1px_rgba(34,211,238,0.05),inset_0_1px_0_rgba(255,255,255,0.05)]'
          : 'relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-gradient-to-b from-[#070f22] via-[#060d1e] to-[#050a14] shadow-[0_16px_48px_rgba(0,0,0,0.4)]'
      }
      data-testid="draft-player-panel"
    >
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r ${rs ? 'via-cyan-400/30' : 'via-violet-400/15'} from-transparent to-transparent`}
        aria-hidden
      />
      <div
        className={`sticky top-0 z-20 shrink-0 border-b shadow-[0_12px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl ${rs ? 'border-cyan-500/12 bg-[rgba(6,14,28,0.97)]' : 'border-white/[0.08] bg-[#060d1e]/92'}`}
      >
        <div className={`flex flex-wrap items-center gap-1.5 border-b border-white/[0.06] p-2 ${rs ? 'gap-y-1.5' : ''}`}>
          <div
            className={`flex min-h-[44px] flex-1 items-center gap-2 rounded-xl border px-3 py-2 shadow-inner touch-manipulation transition duration-150 focus-within:border-cyan-400/40 focus-within:ring-2 focus-within:ring-cyan-400/20 ${
              rs
                ? 'min-w-[160px] border-cyan-400/25 bg-[#070f1c]/95 ring-1 ring-cyan-500/10'
                : 'border-white/14 bg-[#0a1228]/95'
            }`}
          >
            <Search className={`h-4 w-4 shrink-0 ${rs ? 'text-cyan-300/70' : 'text-white/50'}`} />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={rs ? 'Search name, team, school…' : 'Search players...'}
              className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none"
              aria-label="Search players"
              data-testid="draft-player-search-input"
            />
          </div>
          {/* D.6.1 — position pills replacing the legacy <select>. Each pill shows the
              available pool count for that position; the active pill is highlighted with
              the cyan→violet gradient that matches the rest of the Sleeper-style chrome.
              The legacy `data-testid="draft-position-filter"` lives on the wrapper so e2e
              selectors that expect to find it still resolve. */}
          <div
            role="radiogroup"
            aria-label="Position filter"
            data-testid="draft-position-filter"
            className="flex min-h-[44px] flex-wrap items-center gap-1"
          >
            {positionPillCounts.map((opt) => {
              const isActive = positionFilter === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  data-testid={`draft-position-pill-${String(opt.value).toLowerCase().replace(/\s+/g, '-')}`}
                  data-active={isActive ? 'true' : 'false'}
                  onClick={() => {
                    if (leagueId) sendProductAnalyticsBeacon(DRAFT_ROOM.FILTER_POSITION, { leagueId, value: opt.value })
                    setPositionFilter(opt.value)
                  }}
                  className={`inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-[11px] font-semibold uppercase tracking-wider transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 ${
                    isActive
                      ? 'border-cyan-400/45 bg-gradient-to-r from-cyan-500/22 to-violet-600/18 text-cyan-50 shadow-[0_0_14px_rgba(34,211,238,0.18)]'
                      : 'border-white/15 bg-black/20 text-white/65 hover:border-white/28 hover:text-white/90'
                  }`}
                >
                  <span>{opt.label}</span>
                  <span
                    className={`text-[9px] font-medium tabular-nums ${
                      isActive ? 'text-cyan-100/85' : 'text-white/45'
                    }`}
                  >
                    {opt.drafted}/{opt.available}
                  </span>
                </button>
              )
            })}
          </div>
          <select
            value={teamFilter}
            onChange={(e) => {
              const v = e.target.value
              if (leagueId) sendProductAnalyticsBeacon(DRAFT_ROOM.FILTER_TEAM, { leagueId, value: v })
              setTeamFilter(v)
            }}
            className={`min-h-[44px] rounded-xl border px-3 py-2 text-sm text-white shadow-sm touch-manipulation transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 ${
              rs ? 'border-cyan-400/28 bg-[#081424]/95' : 'border-white/14 bg-[#0a1228]/95'
            }`}
            aria-label="Team filter"
            data-testid="draft-team-filter"
          >
            {teamOptions.slice(0, 32).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {/* View-mode toggle: Table (dense) ↔ Cards. Computes the same `useTable`
              rule the body uses; clicking flips the override. Null override defers
              to the auto rule (NFL → table, others → cards). */}
          <div
            role="radiogroup"
            aria-label="Player pool view mode"
            data-testid="draft-pool-view-mode"
            className="ml-auto inline-flex items-center gap-1 rounded-xl border border-white/14 bg-[#0a1228]/95 p-0.5"
          >
            <button
              type="button"
              role="radio"
              aria-checked={viewModeOverride === 'sleeper_table' || (viewModeOverride === null && (poolLayout === 'sleeper_table' || (poolLayout === 'auto' && sport === 'NFL')))}
              onClick={() => setViewModeOverride('sleeper_table')}
              data-testid="draft-pool-view-table"
              title="Table view"
              className={`inline-flex h-9 w-9 items-center justify-center rounded-lg transition ${
                viewModeOverride === 'sleeper_table' || (viewModeOverride === null && (poolLayout === 'sleeper_table' || (poolLayout === 'auto' && sport === 'NFL')))
                  ? 'bg-cyan-500/20 text-cyan-100 shadow-[0_0_10px_rgba(34,211,238,0.18)]'
                  : 'text-white/55 hover:bg-white/[0.06] hover:text-white/85'
              }`}
            >
              <Rows3 className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={viewModeOverride === 'card' || (viewModeOverride === null && poolLayout !== 'sleeper_table' && !(poolLayout === 'auto' && sport === 'NFL'))}
              onClick={() => setViewModeOverride('card')}
              data-testid="draft-pool-view-cards"
              title="Card view"
              className={`inline-flex h-9 w-9 items-center justify-center rounded-lg transition ${
                viewModeOverride === 'card' || (viewModeOverride === null && poolLayout !== 'sleeper_table' && !(poolLayout === 'auto' && sport === 'NFL'))
                  ? 'bg-cyan-500/20 text-cyan-100 shadow-[0_0_10px_rgba(34,211,238,0.18)]'
                  : 'text-white/55 hover:bg-white/[0.06] hover:text-white/85'
              }`}
            >
              <LayoutGrid className="h-4 w-4" aria-hidden />
            </button>
          </div>
          {showPoolFilter && (
            <select
              value={poolFilter}
              onChange={(e) => {
                const v = e.target.value as 'All' | 'Pro' | 'Devy' | 'College'
                if (leagueId) sendProductAnalyticsBeacon(DRAFT_ROOM.POOL_FILTER, { leagueId, value: v })
                setPoolFilter(v)
              }}
              className="min-h-[44px] rounded-xl border border-white/14 bg-[#0a1228]/95 px-3 py-2 text-sm text-white shadow-sm touch-manipulation transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
              aria-label="Pool filter"
              data-testid="draft-pool-filter"
            >
              <option value="All">All</option>
              {c2cConfig?.enabled ? (
                <>
                  <option value="College">College</option>
                  <option value="Pro">Pro</option>
                </>
              ) : (
                <>
                  <option value="Pro">Pro</option>
                  <option value="Devy">Devy</option>
                </>
              )}
            </select>
          )}
        </div>
        {isCollegeRound && (
          <div className="border-b border-violet-400/20 bg-violet-500/10 px-2 py-1 text-[10px] text-violet-100">
            College round (C2C) — select a college-eligible player.
          </div>
        )}
        {isProRound && (
          <div className="border-b border-cyan-400/20 bg-cyan-500/8 px-2 py-1 text-[10px] text-cyan-100">
            Pro round (C2C) — select an NFL player.
          </div>
        )}
        {isDevyRound && (
          <div className="border-b border-amber-400/20 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-100">
            Devy round — select a college/devy-eligible player.
          </div>
        )}
        <div
          className={`flex flex-wrap items-center gap-1.5 border-b border-white/[0.06] px-2 py-2 sm:px-3 ${rs ? 'bg-[#050c18]/95' : 'bg-black/10'}`}
        >
          {/* G.1 — Sort buttons (ADP / AI ADP / Proj / Name) removed.
              They duplicated the SleeperPoolTable's clickable column headers, which
              are the canonical sort UI. The "Use AI ADP" toggle, AI-ADP warnings,
              and the "My roster / Pool" view-toggle remain in this row because they
              don't belong on the table header. */}
          {useAiAdp && (
            <span className="rounded border border-cyan-300/25 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-100" title="Player order uses AI ADP">
              AI ADP
            </span>
          )}
          {onUseAiAdpChange && (
            <label className="min-h-[44px] flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-[10px] text-white/70 hover:bg-white/5 touch-manipulation transition">
              <input
                type="checkbox"
                checked={useAiAdp}
                onChange={(e) => {
                  if (leagueId) {
                    sendProductAnalyticsBeacon(DRAFT_ROOM.AI_ADP_SORT, { leagueId, enabled: e.target.checked })
                  }
                  onUseAiAdpChange(e.target.checked)
                }}
                className="rounded border-white/20 w-4 h-4 shrink-0"
                aria-label="Use AI ADP for sort order"
              />
              Use AI ADP
            </label>
          )}
          {aiAdpUnavailable && (
            <span
              className="text-[10px] text-amber-400/90"
              data-testid="draft-ai-adp-unavailable-banner"
              title={formatAiAdpUnavailableBanner(aiAdpUnavailableMessage) ?? undefined}
            >
              {formatAiAdpUnavailableBanner(aiAdpUnavailableMessage)}
            </span>
          )}
          {useAiAdp && aiAdpStaleWarning && !aiAdpUnavailable && (
            <span className="text-[10px] text-amber-300/90" title="AI ADP is stale and will refresh after the daily job">
              Stale snapshot
            </span>
          )}
          {useAiAdp && aiAdpLowSampleWarning && !aiAdpUnavailable && (
            <span className="text-[10px] text-amber-400/90" title="Some ADP values based on few drafts">
              Low sample
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowRosterView((v) => !v)}
            data-testid="draft-toggle-roster-view"
            className="ml-auto min-h-[40px] flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs text-white/70 hover:bg-white/10 touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 transition"
          >
            <User className="h-3.5 w-3.5" />
            {showRosterView ? 'Pool' : 'My roster'}
          </button>
        </div>
        <div
          className={`flex flex-wrap items-center justify-between gap-2 border-b px-2 py-1.5 text-[10px] ${rs ? 'border-cyan-500/10 bg-black/20 text-white/60' : 'border-white/8 text-white/55'}`}
        >
          <span className={rs ? 'tabular-nums' : undefined}>
            <span className="font-semibold text-white/85">{filtered.length}</span> shown
            {hideDrafted ? <span className="text-white/45"> · drafted hidden</span> : null}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              data-testid="draft-filter-watchlist-only"
              onClick={() => setWatchlistOnly((v) => !v)}
              className={`rounded border px-2 py-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 ${watchlistOnly ? 'border-cyan-300/35 bg-cyan-500/12 text-cyan-100' : 'border-white/15 bg-black/20 text-white/65 hover:bg-white/10'}`}
            >
              Watchlist
            </button>
            <button
              type="button"
              data-testid="draft-filter-hide-drafted"
              onClick={() => setHideDrafted((v) => !v)}
              className={`rounded border px-2 py-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 ${hideDrafted ? 'border-cyan-300/35 bg-cyan-500/12 text-cyan-100' : 'border-white/15 bg-black/20 text-white/65 hover:bg-white/10'}`}
            >
              Hide drafted
            </button>
            {/* D.7 — Rookies Only filter. NFL redraft uses Sleeper `years_exp === 0`
                via the resolved draft pool; devy/C2C leagues additionally include
                isDevy / classYearLabel rows. When no rookie metadata is available
                for the pool, the empty state surfaces "Rookie data unavailable". */}
            <button
              type="button"
              data-testid="draft-filter-rookies-only"
              onClick={toggleRookiesOnly}
              aria-pressed={rookiesOnly}
              className={`rounded border px-2 py-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40 ${rookiesOnly ? 'border-violet-300/40 bg-violet-500/14 text-violet-100' : 'border-white/15 bg-black/20 text-white/65 hover:bg-white/10'}`}
            >
              Rookies only
            </button>
            {/* Commit N — Vets Only companion filter. Evidence-required predicate
                (yearsExp ≥ 1 or graduated devy); mutually exclusive with
                rookies-only via toggleVetsOnly. */}
            <button
              type="button"
              data-testid="draft-filter-vets-only"
              onClick={toggleVetsOnly}
              aria-pressed={vetsOnly}
              className={`rounded border px-2 py-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 ${vetsOnly ? 'border-cyan-300/40 bg-cyan-500/14 text-cyan-100' : 'border-white/15 bg-black/20 text-white/65 hover:bg-white/10'}`}
            >
              Vets only
            </button>
          </div>
          <button
            type="button"
            data-testid="draft-clear-filters"
            onClick={clearAllFilters}
            className="rounded border border-white/15 bg-black/20 px-2 py-1 text-white/65 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
          >
            Clear filters
          </button>
        </div>
      </div>
      {compareAnchor && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-400/25 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-100"
          data-testid="draft-compare-anchor-hint"
        >
          <span>
            Compare: <span className="font-semibold text-white">{compareAnchor.name}</span> — tap another player, or tap again to cancel.
          </span>
          <button
            type="button"
            onClick={() => setCompareAnchor(null)}
            className="shrink-0 rounded border border-amber-400/35 bg-black/20 px-2 py-1 text-[10px] text-amber-50 hover:bg-black/35 transition"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      {selectedPlayer && (
        <PlayerDetailModal
          open={true}
          onClose={() => setSelectedPlayer(null)}
          normalized={selectedNormalized}
          player={{
            id: (() => {
              const candidates = [selectedPlayer.id, selectedPlayer.display?.playerId]
              for (const c of candidates) {
                if (c == null || String(c).trim() === '') continue
                const s = String(c)
                // Synthetic fallback ids break Sleeper headshots and game logs; omit so APIs use name/team.
                if (s.startsWith('name:')) continue
                return s
              }
              return null
            })(),
            name: selectedPlayer.name,
            position: selectedPlayer.position ?? null,
            team: selectedPlayer.team ?? null,
            byeWeek: selectedPlayer.byeWeek ?? null,
            adp: useAiAdp ? (selectedPlayer.aiAdp ?? null) : (selectedPlayer.adp ?? null),
            headshotUrl:
              getDraftRoomDisplayHeadshot(selectedPlayer) ??
              selectedNormalized?.imageUrl ??
              selectedPlayer.display?.assets?.headshotUrl ??
              null,
            teamLogoUrl: selectedNormalized?.teamLogoUrl ?? selectedPlayer.display?.assets?.teamLogoUrl ?? null,
            status: getDraftRoomDisplayInjury(selectedPlayer) ?? selectedPlayer.display?.metadata?.injuryStatus ?? null,
            college: selectedPlayer.school ?? selectedPlayer.display?.metadata?.collegeOrPipeline ?? null,
            age: selectedPlayer.display?.metadata?.age ?? null,
            heightIn: null,
            weightLbs: null,
            // Commit N — pass the resolved Sleeper years_exp through so the
            // detail modal can render rookie/vet status accurately. Was
            // hardcoded to `null`, which silently dropped rookie metadata
            // for every player on the board.
            yearsExp:
              typeof selectedPlayer.yearsExp === 'number' && Number.isFinite(selectedPlayer.yearsExp)
                ? selectedPlayer.yearsExp
                : null,
            jersey: null,
          }}
          sport={sport}
          canDraft={canDraft && !isPlayerDraftedEntry(selectedPlayer, draftedNames, draftedIdsForRows)}
          onMakePick={() => {
            onMakePick(selectedPlayer)
            setSelectedPlayer(null)
          }}
          onAddToQueue={() => {
            onAddToQueue(selectedPlayer)
            setSelectedPlayer(null)
          }}
          isWatchlisted={selectedIsWatchlisted}
          onToggleWatchlist={() => {
            const key = watchKeyFor(selectedPlayer)
            setWatchlistKeys((prev) => {
              const next = new Set(prev)
              if (next.has(key)) next.delete(key)
              else next.add(key)
              return next
            })
          }}
          draftCopilot={getDraftCopilotInsight ? getDraftCopilotInsight(selectedPlayer) : null}
          assistantRoomContext={
            rs && getAssistantRoomContext ? getAssistantRoomContext(selectedPlayer) : null
          }
          presentationVariant={rs ? 'redraft_snake' : 'default'}
          adpDisplayLabel={useAiAdp ? 'AI ADP' : 'ADP'}
          draftUnavailableReason={
            selectedPlayer && isPlayerDraftedEntry(selectedPlayer, draftedNames, draftedIdsForRows)
              ? 'already_drafted'
              : selectedPlayer && !canDraft
                ? 'not_your_pick'
                : null
          }
          nflDraftProjectionSplits={
            sport === 'NFL' ? (selectedPlayer.nflDraftProjectionSplits ?? null) : null
          }
        />
      )}
      <div
        ref={scrollRef}
        data-testid="draft-player-list-scroll"
        className={`min-h-0 flex-1 overscroll-contain p-2 pb-4 sm:p-3 ${
          rs
            ? `max-h-[min(68vh,620px)] sm:max-h-[min(70vh,660px)] lg:max-h-[min(74vh,760px)] overflow-y-scroll bg-[linear-gradient(180deg,rgba(8,18,32,0.55),rgba(4,9,17,0.96))] [scrollbar-gutter:stable] [scrollbar-color:rgba(56,189,248,0.45)_rgba(15,23,42,0.55)] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-slate-950/80 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-cyan-500/40 [&::-webkit-scrollbar-thumb:hover]:bg-cyan-400/55`
            : 'overflow-auto bg-[#050a14]/40'
        }`}
      >
        {rs && !selectedPlayer && !showRosterView && !loading && filtered.length > 0 ? (
          <div className="mb-2 rounded-lg border border-cyan-500/20 bg-gradient-to-r from-cyan-500/[0.07] to-transparent px-3 py-2 text-[10px] leading-snug text-cyan-100/85">
            Select a player for projections, news, queue, compare, and draft actions.
          </div>
        ) : null}
        {loading ? (
          <div className="space-y-2 py-1" aria-busy="true" aria-label={t(DRAFT_ROOM_I18N_KEYS.playerPoolLoading)}>
            <p className="sr-only">{t(DRAFT_ROOM_I18N_KEYS.playerPoolLoading)}</p>
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="flex animate-pulse items-center gap-2 rounded-lg border border-white/10 bg-[#0a1228]/90 px-2 py-2"
              >
                <div className="h-7 w-7 shrink-0 rounded-full bg-white/10" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-2.5 w-24 rounded bg-white/10" />
                  <div className="h-2 w-40 max-w-full rounded bg-white/[0.07]" />
                </div>
                <div className="h-8 w-16 shrink-0 rounded-md bg-white/[0.06]" />
              </div>
            ))}
          </div>
        ) : showRosterView ? (
          <ul className="space-y-1">
            {currentRoster.length === 0 ? (
              <li className="text-[10px] text-white/50">{t('draftRoom.playerPanel.noPicksYet')}</li>
            ) : (
              currentRoster.map((p, i) => (
                <li
                  key={`${p.playerName}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#0a1228] px-2 py-1.5 text-[11px] hover:border-white/20 transition"
                >
                  <span className="font-medium text-white">{p.playerName}</span>
                  <span className="text-white/55">{p.position}{p.team ? ` · ${p.team}` : ''}</span>
                </li>
              ))
            )}
          </ul>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-14 text-center">
            {players.length === 0 ? (
              <>
                <p
                  className="text-sm font-medium text-white/75"
                  data-testid="draft-pool-empty-unloaded"
                >
                  No players loaded for this pool.
                </p>
                <p className="max-w-xs text-xs text-white/45">
                  Wait for the pool to finish loading, or refresh the draft room if this persists.
                </p>
              </>
            ) : rookiesOnly && !hasSecondaryPoolFilters && rookieDataState.reason === 'no_rookie_metadata' ? (
              <>
                <p
                  className="text-sm font-medium text-white/75"
                  data-testid="draft-rookie-metadata-missing"
                >
                  Rookie metadata is not available for this pool yet.
                </p>
                <p className="max-w-xs text-xs text-white/45">
                  We could not read rookie signals (experience, flags, or draft year) on these rows. Toggle Rookies Only off to see the full list.
                </p>
                <button
                  type="button"
                  onClick={() => setRookiesOnly(false)}
                  data-testid="draft-rookie-data-unavailable-clear"
                  className="rounded-full border border-violet-400/35 bg-violet-500/12 px-4 py-2 text-xs font-medium text-violet-100 transition hover:bg-violet-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/45"
                >
                  Turn off Rookies Only
                </button>
              </>
            ) : rookiesOnly && !hasSecondaryPoolFilters && rookieDataState.reason === 'no_rookies_for_context' ? (
              <>
                <p
                  className="text-sm font-medium text-white/75"
                  data-testid="draft-rookie-none-for-context"
                >
                  No rookies found for this draft context.
                </p>
                <p className="max-w-xs text-xs text-white/45">
                  The pool has rookie signals, but no players matched as rookies for this sport/season. Toggle Rookies Only off to see everyone.
                </p>
                <button
                  type="button"
                  onClick={() => setRookiesOnly(false)}
                  data-testid="draft-rookie-none-for-context-clear"
                  className="rounded-full border border-violet-400/35 bg-violet-500/12 px-4 py-2 text-xs font-medium text-violet-100 transition hover:bg-violet-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/45"
                >
                  Turn off Rookies Only
                </button>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-white/75">No players match your filters</p>
                <p className="max-w-xs text-xs text-white/45">Widen search, reset position or team, or clear filters to see the pool again.</p>
                <button
                  type="button"
                  onClick={clearAllFilters}
                  data-testid="draft-empty-clear-filters"
                  className="rounded-full border border-cyan-400/35 bg-cyan-500/12 px-4 py-2 text-xs font-medium text-cyan-100 transition hover:bg-cyan-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/45"
                >
                  Clear filters
                </button>
              </>
            )}
          </div>
        ) : (
          (() => {
            /**
             * D.2 — choose between Sleeper-style dense table and legacy card layout.
             *
             * Auto rule: NFL pools render the table; everything else stays on cards.
             * E.2.7 makes this safe — `nflDraftProjectionSplits` now hydrates with
             * real PPG / passing / rushing / receiving values, so the table's stat
             * columns aren't full of em-dashes.
             *
             * The horizontal-scroll container honors small viewports — on mobile,
             * the table scrolls sideways rather than squishing column widths.
             */
            const useTable =
              viewModeOverride === 'sleeper_table' ||
              (viewModeOverride === null &&
                (poolLayout === 'sleeper_table' ||
                  (poolLayout === 'auto' && sport === 'NFL')))

            if (!useTable) {
              return (
                <PlayerListVirtualized
                  filtered={filtered}
                  draftedNames={draftedNames}
                  draftedPlayerIds={draftedIdsForRows}
                  presentationVariant={presentationVariant}
                  selectedPlayer={selectedPlayer}
                  isPlayerQueued={isPlayerQueued}
                  canDraft={canDraft}
                  canNominate={canNominate}
                  useAiAdp={useAiAdp}
                  draftSport={sport}
                  onDraftRequest={onMakePick}
                  onAddToQueue={onAddToQueue}
                  onNominateRequest={(player) => setPendingNomination(player)}
                  onPlayerSelect={setSelectedPlayer}
                  scrollRef={scrollRef}
                  compareAnchor={compareAnchor}
                  onCompareTap={onCompareTap}
                  aiRowBadges={aiRowBadges}
                />
              )
            }

            return (
              <div className="overflow-x-auto" data-testid="sleeper-pool-table-scroll">
                <SleeperPoolTable
                  filtered={filtered}
                  draftedNames={draftedNames}
                  draftedPlayerIds={draftedIdsForRows ?? null}
                  selectedPlayer={selectedPlayer}
                  isPlayerQueued={isPlayerQueued}
                  isPlayerDrafted={(player) =>
                    isPlayerDraftedEntry(player, draftedNames, draftedIdsForRows)
                  }
                  canDraft={canDraft}
                  canNominate={canNominate}
                  useAiAdp={useAiAdp}
                  draftSport={sport}
                  statColumnOptions={sleeperStatOpts}
                  onDraftRequest={onMakePick}
                  onAddToQueue={onAddToQueue}
                  onNominateRequest={(player) => setPendingNomination(player)}
                  onPlayerSelect={setSelectedPlayer}
                  scrollRef={scrollRef}
                  compareAnchor={compareAnchor}
                  onCompareTap={onCompareTap}
                  sortState={{ key: sortBy, direction: sortDirection }}
                  onSortChange={handleColumnHeaderSort}
                />
              </div>
            )
          })()
        )}
      </div>
      {pendingNomination && (
        <div className="border-t border-white/8 bg-[#050c1d] p-2.5 space-y-2" data-testid="draft-pick-confirmation">
          <p className="text-xs text-white/80">
            Confirm nomination:
            <span className="ml-1 font-medium text-cyan-200">
              {getPickConfirmationLabel(pendingNomination.name, pendingNomination.position, pendingNomination.team)}
            </span>
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="draft-confirm-pick-button"
              onClick={() => {
                onNominate?.(pendingNomination)
                setPendingNomination(null)
              }}
              className="rounded border border-cyan-300/35 bg-cyan-500/12 px-3 py-1.5 text-xs text-cyan-100 hover:bg-cyan-500/20 transition"
            >
              Confirm
            </button>
            <button
              type="button"
              data-testid="draft-cancel-pick-button"
              onClick={() => setPendingNomination(null)}
              className="rounded border border-white/15 bg-black/20 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

export const PlayerPanel = React.memo(PlayerPanelInner)
