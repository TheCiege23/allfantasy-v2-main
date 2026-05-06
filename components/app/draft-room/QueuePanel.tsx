'use client'

import { useMemo, useState } from 'react'
import { ListOrdered, GripVertical, X, Zap, UserMinus, Play, ChevronDown } from 'lucide-react'
import type { QueueEntry } from '@/lib/live-draft-engine/types'
import { DRAFT_ROOM } from '@/lib/analytics/eventNames'
import { sendProductAnalyticsBeacon } from '@/lib/analytics/client'
import { PlayerAvatar } from './PlayerAvatar'

type QueueSortMode = 'queue' | 'name' | 'adp' | 'rank'

export type QueuePanelProps = {
  queue: QueueEntry[]
  playerMetaById?: Record<
    string,
    {
      headshotUrl?: string | null
      teamLogoUrl?: string | null
      adp?: number | null
      aiAdp?: number | null
      injuryStatus?: string | null
      experienceBadge?: string | null
    }
  >
  canDraft: boolean
  onRemove: (index: number) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  onDraftFromQueue?: (entry: QueueEntry) => void
  onAiReorder?: () => void
  aiReorderLoading?: boolean
  aiReorderEnabled?: boolean
  onAiReorderEnabledChange?: (value: boolean) => void
  autoPickFromQueue: boolean
  onAutoPickFromQueueChange: (value: boolean) => void
  awayMode: boolean
  onAwayModeChange: (value: boolean) => void
  /** Next available player in queue (for auto-pick) */
  nextQueuedAvailable?: QueueEntry | null
  /** Explanation from last AI reorder */
  aiReorderExplanation?: string | null
  /** Execution mode metadata from backend */
  aiReorderExecutionMode?: string | null
  /** Global commissioner setting for allowing auto-pick behaviors */
  autoPickEnabled?: boolean
  /** When set, queue autopick/away/AI reorder emit product analytics beacons */
  analyticsLeagueId?: string
  presentationVariant?: 'default' | 'redraft_snake'
}

export function QueuePanel({
  queue,
  playerMetaById,
  canDraft,
  onRemove,
  onReorder,
  onDraftFromQueue,
  onAiReorder,
  aiReorderLoading = false,
  aiReorderEnabled = true,
  onAiReorderEnabledChange,
  autoPickFromQueue,
  onAutoPickFromQueueChange,
  awayMode,
  onAwayModeChange,
  nextQueuedAvailable,
  aiReorderExplanation,
  aiReorderExecutionMode,
  autoPickEnabled = true,
  analyticsLeagueId,
  presentationVariant = 'default',
}: QueuePanelProps) {
  const rs = presentationVariant === 'redraft_snake'
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [positionFilter, setPositionFilter] = useState('ALL')
  const [sortMode, setSortMode] = useState<QueueSortMode>('queue')

  const resolveMeta = (entry: QueueEntry) => {
    const fromMap =
      entry.playerId && playerMetaById ? playerMetaById[entry.playerId] : undefined
    const fromEntry = entry as QueueEntry & {
      headshotUrl?: string | null
      teamLogoUrl?: string | null
      adp?: number | null
      rank?: number | null
    }
    return {
      headshotUrl: fromMap?.headshotUrl ?? fromEntry.headshotUrl ?? null,
      teamLogoUrl: fromMap?.teamLogoUrl ?? fromEntry.teamLogoUrl ?? null,
      adp: fromMap?.adp ?? fromEntry.adp ?? null,
      aiAdp: fromMap?.aiAdp ?? (fromEntry as { aiAdp?: number | null }).aiAdp ?? null,
      injuryStatus: fromMap?.injuryStatus ?? null,
      experienceBadge: fromMap?.experienceBadge ?? null,
    }
  }

  const formatNumber = (value: number | null | undefined) => {
    if (value == null || !Number.isFinite(value)) return null
    return Number.isInteger(value) ? `${value}` : value.toFixed(1)
  }

  const queueWithIndex = useMemo(
    () => queue.map((entry, queueIndex) => ({ entry, queueIndex })),
    [queue],
  )

  const positionOptions = useMemo(() => {
    const values = new Set<string>()
    for (const { entry } of queueWithIndex) {
      const p = String(entry.position ?? '').trim().toUpperCase()
      if (p) values.add(p)
    }
    return ['ALL', ...Array.from(values).sort((a, b) => a.localeCompare(b))]
  }, [queueWithIndex])

  const normalizedQuery = searchQuery.trim().toLowerCase()
  const displayQueue = useMemo(() => {
    const filtered = queueWithIndex.filter(({ entry }) => {
      if (positionFilter !== 'ALL' && String(entry.position ?? '').toUpperCase() !== positionFilter) {
        return false
      }
      if (!normalizedQuery) return true
      const haystack = `${entry.playerName} ${entry.position} ${entry.team ?? ''}`.toLowerCase()
      return haystack.includes(normalizedQuery)
    })

    if (sortMode === 'queue') return filtered

    const safeValue = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? Number.POSITIVE_INFINITY : n)
    return [...filtered].sort((a, b) => {
      if (sortMode === 'name') return a.entry.playerName.localeCompare(b.entry.playerName)
      if (sortMode === 'adp') {
        const am = resolveMeta(a.entry)
        const bm = resolveMeta(b.entry)
        return safeValue(am.adp) - safeValue(bm.adp)
      }
      const am = resolveMeta(a.entry)
      const bm = resolveMeta(b.entry)
      return safeValue(am.aiAdp) - safeValue(bm.aiAdp)
    })
  }, [queueWithIndex, positionFilter, normalizedQuery, sortMode])

  const canReorderVisually =
    sortMode === 'queue' &&
    positionFilter === 'ALL' &&
    normalizedQuery.length === 0

  const showFilteredEmptyState = queue.length > 0 && displayQueue.length === 0

  return (
    <section
      className={`flex flex-col overflow-hidden rounded-xl border bg-[#060d1e] ${
        rs ? 'border-cyan-500/25 shadow-[0_12px_40px_rgba(34,211,238,0.08),inset_0_1px_0_rgba(255,255,255,0.05)]' : 'border-white/10'
      }`}
      data-testid="draft-queue-panel"
    >
      <div className={`flex items-center justify-between gap-2 border-b px-3 py-2.5 ${rs ? 'border-cyan-500/15 bg-[linear-gradient(90deg,rgba(34,211,238,0.08),transparent)]' : 'border-white/8'}`}>
        <div className="flex items-center gap-2">
          <ListOrdered className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white">Queue</span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 border-b border-white/8 p-2.5 sm:grid-cols-3">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search queued players"
          data-testid="draft-queue-search"
          className="h-10 rounded-lg border border-white/15 bg-[#0b1328] px-3 text-xs text-white placeholder:text-white/45 outline-none transition focus:border-cyan-400/40 focus:ring-2 focus:ring-cyan-500/15"
        />
        {/* Position filter — chip row matches the player pool's position pills
            so users see consistent affordances across both surfaces. */}
        <div
          role="radiogroup"
          aria-label="Queue position filter"
          data-testid="draft-queue-position-filter"
          className="flex flex-wrap items-center gap-1"
        >
          {positionOptions.map((position) => {
            const isActive = positionFilter === position
            return (
              <button
                key={position}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => setPositionFilter(position)}
                data-testid={`draft-queue-position-pill-${position.toLowerCase()}`}
                data-active={isActive ? 'true' : 'false'}
                className={`inline-flex h-8 items-center rounded-full border px-2.5 text-[11px] font-semibold uppercase tracking-wider transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 ${
                  isActive
                    ? 'border-cyan-400/45 bg-gradient-to-r from-cyan-500/22 to-violet-600/18 text-cyan-50 shadow-[0_0_14px_rgba(34,211,238,0.18)]'
                    : 'border-white/15 bg-black/20 text-white/65 hover:border-white/28 hover:text-white/90'
                }`}
              >
                {position === 'ALL' ? 'All' : position}
              </button>
            )
          })}
        </div>
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as QueueSortMode)}
          data-testid="draft-queue-sort"
          className="h-10 rounded-lg border border-white/15 bg-[#0b1328] px-3 text-xs text-white outline-none transition focus:border-cyan-400/40 focus:ring-2 focus:ring-cyan-500/15"
        >
          <option value="queue">Sort: Queue order</option>
          <option value="adp">Sort: ADP</option>
          <option value="rank">Sort: AI ADP</option>
          <option value="name">Sort: Name</option>
        </select>
      </div>
      {rs ? (
        <details className="group border-b border-white/8" data-testid="draft-queue-ai-options">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-cyan-100/90 [&::-webkit-details-marker]:hidden">
            <span>Queue &amp; AI options</span>
            <ChevronDown
              className="h-4 w-4 shrink-0 text-cyan-200/75 transition group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="flex flex-wrap gap-2 px-2.5 pb-2.5 pt-0">
            {onAiReorder && (
              <>
                {onAiReorderEnabledChange && (
                  <label className="min-h-[44px] flex cursor-pointer items-center gap-2 px-2 py-2 rounded-lg hover:bg-white/5 text-[11px] text-cyan-100/85 touch-manipulation">
                    <input
                      type="checkbox"
                      checked={aiReorderEnabled}
                      onChange={(e) => {
                        if (analyticsLeagueId) {
                          sendProductAnalyticsBeacon(DRAFT_ROOM.AI_REORDER_EXPLAIN_TOGGLE, {
                            leagueId: analyticsLeagueId,
                            enabled: e.target.checked,
                          })
                        }
                        onAiReorderEnabledChange(e.target.checked)
                      }}
                      data-testid="draft-queue-ai-reorder-toggle"
                      className="rounded border-cyan-300/40 w-4 h-4"
                    />
                    AI explanation for reorder
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (analyticsLeagueId) {
                      sendProductAnalyticsBeacon(DRAFT_ROOM.AI_QUEUE_REORDER, {
                        leagueId: analyticsLeagueId,
                        queueLen: queue.length,
                      })
                    }
                    onAiReorder()
                  }}
                  disabled={aiReorderLoading || !aiReorderEnabled || queue.length < 2}
                  data-testid="draft-queue-ai-reorder"
                  className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-cyan-300/35 bg-cyan-500/10 px-3 py-2.5 text-xs text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-50 touch-manipulation"
                >
                  <Zap className="h-3.5 w-3.5" />
                  {aiReorderLoading ? 'Reordering…' : 'Auto reorder'}
                </button>
              </>
            )}
            <label className="min-h-[44px] flex cursor-pointer items-center gap-2 px-2 py-2 rounded-lg hover:bg-white/5 text-[11px] text-white/75 touch-manipulation">
              <input
                type="checkbox"
                checked={autoPickFromQueue}
                onChange={(e) => {
                  if (analyticsLeagueId) {
                    sendProductAnalyticsBeacon(DRAFT_ROOM.AUTOPICK_QUEUE, {
                      leagueId: analyticsLeagueId,
                      enabled: e.target.checked,
                    })
                  }
                  onAutoPickFromQueueChange(e.target.checked)
                }}
                disabled={!autoPickEnabled}
                data-testid="draft-queue-autopick-toggle"
                className="rounded border-white/20 w-4 h-4"
              />
              Auto-pick from queue
            </label>
            <label className="min-h-[44px] flex cursor-pointer items-center gap-2 px-2 py-2 rounded-lg hover:bg-white/5 text-[11px] text-white/75 touch-manipulation">
              <input
                type="checkbox"
                checked={awayMode}
                onChange={(e) => {
                  if (analyticsLeagueId) {
                    sendProductAnalyticsBeacon(DRAFT_ROOM.AWAY_MODE, {
                      leagueId: analyticsLeagueId,
                      enabled: e.target.checked,
                    })
                  }
                  onAwayModeChange(e.target.checked)
                }}
                disabled={!autoPickEnabled}
                data-testid="draft-queue-away-toggle"
                className="rounded border-white/20 w-4 h-4"
              />
              <UserMinus className="h-3.5 w-3.5" />
              Away mode
            </label>
          </div>
        </details>
      ) : (
        <div className="flex flex-wrap gap-2 border-b border-white/8 p-2.5">
          {onAiReorder && (
            <>
              {onAiReorderEnabledChange && (
                <label className="min-h-[44px] flex cursor-pointer items-center gap-2 px-2 py-2 rounded-lg hover:bg-white/5 text-[11px] text-cyan-100/85 touch-manipulation">
                  <input
                    type="checkbox"
                    checked={aiReorderEnabled}
                    onChange={(e) => {
                      if (analyticsLeagueId) {
                        sendProductAnalyticsBeacon(DRAFT_ROOM.AI_REORDER_EXPLAIN_TOGGLE, {
                          leagueId: analyticsLeagueId,
                          enabled: e.target.checked,
                        })
                      }
                      onAiReorderEnabledChange(e.target.checked)
                    }}
                    data-testid="draft-queue-ai-reorder-toggle"
                    className="rounded border-cyan-300/40 w-4 h-4"
                  />
                  AI explanation for reorder
                </label>
              )}
              <button
                type="button"
                onClick={() => {
                  if (analyticsLeagueId) {
                    sendProductAnalyticsBeacon(DRAFT_ROOM.AI_QUEUE_REORDER, {
                      leagueId: analyticsLeagueId,
                      queueLen: queue.length,
                    })
                  }
                  onAiReorder()
                }}
                disabled={aiReorderLoading || !aiReorderEnabled || queue.length < 2}
                data-testid="draft-queue-ai-reorder"
                className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-cyan-300/35 bg-cyan-500/10 px-3 py-2.5 text-xs text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-50 touch-manipulation"
              >
                <Zap className="h-3.5 w-3.5" />
                {aiReorderLoading ? 'Reordering…' : 'Auto reorder'}
              </button>
            </>
          )}
          <label className="min-h-[44px] flex cursor-pointer items-center gap-2 px-2 py-2 rounded-lg hover:bg-white/5 text-[11px] text-white/75 touch-manipulation">
            <input
              type="checkbox"
              checked={autoPickFromQueue}
              onChange={(e) => {
                if (analyticsLeagueId) {
                  sendProductAnalyticsBeacon(DRAFT_ROOM.AUTOPICK_QUEUE, {
                    leagueId: analyticsLeagueId,
                    enabled: e.target.checked,
                  })
                }
                onAutoPickFromQueueChange(e.target.checked)
              }}
              disabled={!autoPickEnabled}
              data-testid="draft-queue-autopick-toggle"
              className="rounded border-white/20 w-4 h-4"
            />
            Auto-pick from queue
          </label>
          <label className="min-h-[44px] flex cursor-pointer items-center gap-2 px-2 py-2 rounded-lg hover:bg-white/5 text-[11px] text-white/75 touch-manipulation">
            <input
              type="checkbox"
              checked={awayMode}
              onChange={(e) => {
                if (analyticsLeagueId) {
                  sendProductAnalyticsBeacon(DRAFT_ROOM.AWAY_MODE, {
                    leagueId: analyticsLeagueId,
                    enabled: e.target.checked,
                  })
                }
                onAwayModeChange(e.target.checked)
              }}
              disabled={!autoPickEnabled}
              data-testid="draft-queue-away-toggle"
              className="rounded border-white/20 w-4 h-4"
            />
            <UserMinus className="h-3.5 w-3.5" />
            Away mode
          </label>
        </div>
      )}
      {!autoPickEnabled && (
        <p
          className={`border-b border-white/8 px-2 py-1 leading-snug ${
            rs ? 'text-[9px] text-amber-200/75' : 'text-[10px] text-amber-200/90'
          }`}
          data-testid="draft-queue-autopick-disabled-note"
        >
          Commissioner has disabled auto-pick for this draft.
        </p>
      )}
      {aiReorderExplanation && (
        <p className="border-b border-white/8 px-2 py-1.5 text-[10px] text-cyan-100/90" title="AI reorder explanation">
          {aiReorderExplanation}
        </p>
      )}
      {aiReorderExecutionMode && (
        <p className="border-b border-white/8 px-2 py-1.5 text-[10px] text-white/60" data-testid="draft-queue-execution-mode">
          Execution: {aiReorderExecutionMode === 'ai_explained' ? 'rules engine + AI explanation' : 'instant rules automation'}
        </p>
      )}
      <div className="flex-1 overflow-auto overscroll-contain p-2.5">
        {queue.length === 0 ? (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 px-4 py-8 text-center">
            <div
              className={`flex h-14 w-14 items-center justify-center rounded-2xl border ${
                rs ? 'border-cyan-400/25 bg-cyan-500/8' : 'border-white/10 bg-white/[0.03]'
              }`}
              aria-hidden
            >
              <ListOrdered className={`h-7 w-7 ${rs ? 'text-cyan-200/70' : 'text-white/45'}`} />
            </div>
            <p className={`text-sm font-semibold ${rs ? 'text-cyan-100/90' : 'text-white/85'}`}>
              No players in your queue
            </p>
            <p className="max-w-[260px] text-[11px] leading-relaxed text-white/50">
              Add to queue from player list
            </p>
          </div>
        ) : showFilteredEmptyState ? (
          <div className="space-y-1 rounded-xl border border-dashed border-white/15 bg-white/[0.03] px-3 py-5 text-center">
            <p className="text-[11px] font-semibold text-white/80">No queue matches</p>
            <p className="text-[10px] text-white/55">Adjust search, position, or sort to see queued players.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {displayQueue.map(({ entry, queueIndex }, displayIndex) => {
              const meta = resolveMeta(entry)
              const adpText = formatNumber(meta.adp)
              const aiAdpText = formatNumber(meta.aiAdp)
              return (
              <li
                key={`${entry.playerName}-${entry.playerId ?? queueIndex}`}
                data-testid={`draft-queue-item-${displayIndex}`}
                draggable={canReorderVisually}
                onDragStart={() => {
                  if (!canReorderVisually) return
                  setDragIndex(displayIndex)
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (!canReorderVisually) return
                  if (dragIndex != null && dragIndex !== displayIndex) {
                    const from = displayQueue[dragIndex]
                    const to = displayQueue[displayIndex]
                    if (from && to) {
                      onReorder(from.queueIndex, to.queueIndex)
                    }
                    setDragIndex(null)
                  }
                }}
                className={`flex items-center justify-between gap-2 rounded-xl border border-white/12 bg-[linear-gradient(180deg,rgba(10,18,40,0.94),rgba(7,14,30,0.98))] px-3 py-2.5 text-[11px] min-h-[58px] ${
                  dragIndex === displayIndex ? 'opacity-60' : 'hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={`shrink-0 touch-none ${canReorderVisually ? 'text-white/40' : 'text-white/20'}`} aria-hidden><GripVertical className="h-4 w-4" /></span>
                  <PlayerAvatar
                    headshotUrl={meta.headshotUrl}
                    teamLogoUrl={meta.teamLogoUrl}
                    teamAbbr={entry.team}
                    position={entry.position}
                    displayName={entry.playerName}
                    size={32}
                    testIdBase={`draft-queue-avatar-${displayIndex}`}
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{entry.playerName}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px]">
                      <span className="rounded border border-white/15 bg-white/5 px-1.5 py-[1px] text-white/75">
                        {entry.position}
                      </span>
                      {entry.team ? (
                        <span className="rounded border border-white/15 bg-white/5 px-1.5 py-[1px] text-white/65">{entry.team}</span>
                      ) : null}
                      {adpText ? (
                        <span className="rounded border border-cyan-300/35 bg-cyan-500/12 px-1.5 py-[1px] text-cyan-100">ADP {adpText}</span>
                      ) : null}
                      {aiAdpText ? (
                        <span className="rounded border border-violet-300/30 bg-violet-500/10 px-1.5 py-[1px] text-violet-100">AI ADP {aiAdpText}</span>
                      ) : null}
                      {meta.injuryStatus ? (
                        <span className="rounded border border-amber-400/35 bg-amber-500/12 px-1.5 py-[1px] text-amber-100">
                          {meta.injuryStatus}
                        </span>
                      ) : null}
                      {meta.experienceBadge ? (
                        <span className="rounded border border-cyan-400/25 bg-cyan-500/10 px-1.5 py-[1px] text-cyan-50">
                          {meta.experienceBadge}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!canReorderVisually) return
                      const previous = displayQueue[displayIndex - 1]
                      if (!previous) return
                      onReorder(queueIndex, previous.queueIndex)
                    }}
                    disabled={!canReorderVisually || displayIndex === 0}
                    data-testid={`draft-queue-move-up-${displayIndex}`}
                    className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-white/50 hover:bg-white/10 hover:text-white/80 disabled:opacity-40 touch-manipulation"
                    aria-label={`Move ${entry.playerName} up`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!canReorderVisually) return
                      const next = displayQueue[displayIndex + 1]
                      if (!next) return
                      onReorder(queueIndex, next.queueIndex)
                    }}
                    disabled={!canReorderVisually || displayIndex === displayQueue.length - 1}
                    data-testid={`draft-queue-move-down-${displayIndex}`}
                    className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-white/50 hover:bg-white/10 hover:text-white/80 disabled:opacity-40 touch-manipulation"
                    aria-label={`Move ${entry.playerName} down`}
                  >
                    ↓
                  </button>
                  {canDraft && onDraftFromQueue && queueIndex === 0 && (
                    <button
                      type="button"
                      onClick={() => onDraftFromQueue(entry)}
                      data-testid="draft-queue-draft-button"
                    className="min-h-[44px] inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/35 bg-cyan-500/12 px-3 py-2 text-xs text-cyan-100 hover:bg-cyan-500/20 touch-manipulation"
                    >
                      <Play className="h-3.5 w-3.5" /> Draft
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemove(queueIndex)}
                    data-testid={`draft-queue-remove-${displayIndex}`}
                    className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-white/50 hover:bg-white/10 hover:text-white/80 touch-manipulation"
                    aria-label={`Remove ${entry.playerName} from queue`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </li>
            )})}
          </ul>
        )}
        {!canReorderVisually && displayQueue.length > 1 ? (
          <p className="mt-2 text-[10px] text-white/45" data-testid="draft-queue-reorder-disabled-note">
            Reorder is available when Sort is set to Queue order and no search/filter is active.
          </p>
        ) : null}
      </div>
    </section>
  )
}
