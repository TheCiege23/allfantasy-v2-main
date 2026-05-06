'use client'

/**
 * D.2 — Sleeper-style dense draft pool table (all sports).
 *
 * Column definitions come from **`buildSleeperPoolTableLayout`** →
 * **`lib/draft-room/draftSportStatColumns.ts`**. Stat cells use
 * **`getStatValueForDraftPlayer`** + **`formatDraftStatDisplay`** (em-dash for missing).
 *
 * Virtualized via @tanstack/react-virtual; horizontally scrollable when narrower than **`minWidth`**.
 */

import React, { useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { GitCompare, Plus } from 'lucide-react'

import { PlayerAvatar } from './PlayerAvatar'
import type { PlayerEntry } from './PlayerPanel'
import { normalizePlayer } from '@/lib/players/normalizePlayer'
import { getPlayerImage } from '@/lib/players/getPlayerImage'
import type { NflDraftProjectionSplits } from '@/lib/draft/analytics/nfl-draft-pool-projection-splits'
import {
  formatDraftStatDisplay,
  getStatValueForDraftPlayer,
  type DraftStatColumnDef,
  type DraftStatColumnOptions,
  type DraftStatPlayerSource,
} from '@/lib/draft-room/draftSportStatColumns'
import {
  buildSleeperPoolTableLayout,
  type SleeperColumnSpec,
  type SleeperPoolTableLayout,
} from '@/lib/draft-room/sleeperPoolTableLayout'
import {
  SLEEPER_POOL_TABLE_HEADER_HEIGHT,
  SLEEPER_POOL_TABLE_ROW_HEIGHT,
  cellTooltip,
} from './SleeperPoolTable.constants'
import {
  ariaSortValue,
  sortKeyForColumn,
  type PoolSortState,
} from './SleeperPoolSort'
import { aiAdpCellTitle, systemAdpCellTitle } from '@/lib/draft-room/adpReadinessCopy'

/** Re-export sizing constants for stories/tests that imported them from this module. */
export {
  SLEEPER_POOL_TABLE_COLUMNS,
  SLEEPER_POOL_TABLE_HEADER_HEIGHT,
  SLEEPER_POOL_TABLE_MIN_WIDTH,
  SLEEPER_POOL_TABLE_ROW_HEIGHT,
} from './SleeperPoolTable.constants'

export interface SleeperPoolTableProps {
  filtered: PlayerEntry[]
  draftedNames: Set<string>
  draftedPlayerIds?: ReadonlySet<string> | null
  selectedPlayer: PlayerEntry | null
  isPlayerQueued?: (player: PlayerEntry) => boolean
  isPlayerDrafted: (player: PlayerEntry) => boolean
  canDraft: boolean
  canNominate?: boolean
  useAiAdp: boolean
  draftSport: string
  /** Drives MLB pitcher/hitter, NHL goalie/skater, NFL IDP vs offense column sets (from position filter). */
  statColumnOptions?: DraftStatColumnOptions
  onDraftRequest: (player: PlayerEntry) => void
  onNominateRequest?: (player: PlayerEntry) => void
  onAddToQueue: (player: PlayerEntry) => void
  onPlayerSelect: (player: PlayerEntry) => void
  onCompareTap: (player: PlayerEntry) => void
  scrollRef: React.RefObject<HTMLDivElement | null>
  compareAnchor: PlayerEntry | null
  rowHeight?: number
  disableVirtualization?: boolean
  sortState?: PoolSortState | null
  onSortChange?: (columnKey: string) => void
}

function rowKey(p: PlayerEntry): string {
  return `${p.name.trim().toLowerCase()}|${p.position.trim().toLowerCase()}|${String(p.team ?? '').trim().toLowerCase()}`
}

/** Cell with consistent alignment + tabular numbers. */
function Cell({
  width,
  align,
  children,
  className = '',
  title,
}: {
  width: number
  align: 'left' | 'right'
  children: React.ReactNode
  className?: string
  title?: string
}) {
  return (
    <div
      style={{ width, minWidth: width, maxWidth: width }}
      className={`flex items-center px-2 ${align === 'right' ? 'justify-end tabular-nums' : 'justify-start'} ${className}`}
      title={title}
    >
      {children}
    </div>
  )
}

interface SleeperRowProps {
  player: PlayerEntry
  rank: number
  layout: SleeperPoolTableLayout
  statByKey: Map<string, DraftStatColumnDef>
  selected: boolean
  drafted: boolean
  queued: boolean
  canDraft: boolean
  canNominate: boolean
  useAiAdp: boolean
  draftSport: string
  isCompareAnchor: boolean
  rowHeight: number
  minWidth: number
  onSelect: () => void
  onCompareTap: () => void
  onAddToQueue: () => void
  onDraftRequest: () => void
  onNominateRequest?: () => void
  testIdBase: string
}

function SleeperRow(props: SleeperRowProps) {
  const {
    player: p,
    rank,
    layout,
    statByKey,
    selected,
    drafted,
    queued,
    canDraft,
    canNominate,
    useAiAdp,
    draftSport,
    isCompareAnchor,
    rowHeight,
    minWidth,
    onSelect,
    onCompareTap,
    onAddToQueue,
    onDraftRequest,
    onNominateRequest,
    testIdBase,
  } = props

  const normalized = useMemo(
    () =>
      normalizePlayer({
        display: p.display ?? undefined,
        name: p.name,
        position: p.position,
        team: p.team,
        adp: useAiAdp ? p.aiAdp ?? undefined : p.adp ?? undefined,
        byeWeek: p.byeWeek ?? undefined,
        sport: draftSport,
      }),
    [p, useAiAdp, draftSport],
  )

  const headshotUrl =
    getPlayerImage(normalized, draftSport) ??
    p.display?.assets?.headshotUrl ??
    p.unifiedProductView?.unified.headshotUrl ??
    null
  const teamLogoUrl = normalized.teamLogoUrl ?? null
  const splits: NflDraftProjectionSplits | null = p.nflDraftProjectionSplits ?? null

  const adpDisplay = p.adp != null ? p.adp.toFixed(1) : '—'
  const aiAdpDisplay = p.aiAdp != null ? p.aiAdp.toFixed(1) : '—'
  const byeDisplay = p.byeWeek != null ? String(p.byeWeek) : '—'

  const tipFor = (columnKey: string, statLabel: string, rawValue: number | null | undefined): string =>
    cellTooltip(p.name, statLabel, rawValue)

  const renderColumn = (col: SleeperColumnSpec) => {
    const statTestId = `${testIdBase}-${String(col.key).replace(/_/g, '-')}`

    switch (col.key) {
      case 'rk':
        return (
          <Cell key={col.key} width={col.width} align="right">
            <span className="text-white/55 text-[11px] font-medium" data-testid={`${testIdBase}-rk`}>
              {rank}
            </span>
          </Cell>
        )
      case 'player':
        return (
          <Cell key={col.key} width={col.width} align="left" className="gap-2">
            <PlayerAvatar
              headshotUrl={headshotUrl}
              displayName={p.name}
              teamLogoUrl={teamLogoUrl}
              teamAbbr={p.team ?? null}
              position={p.position}
              size={36}
              testIdBase={`${testIdBase}-avatar`}
              highlighted={selected}
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex min-w-0 items-center gap-1.5">
                <span
                  className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white/95"
                  data-testid={`${testIdBase}-name`}
                  title={
                    drafted
                      ? `${p.name} — already drafted`
                      : `${p.name}${p.position ? ` (${p.position}${p.team ? `, ${p.team}` : ''})` : ''} — click row to open detail`
                  }
                >
                  {p.name}
                </span>
                {drafted ? (
                  <span className="flex-shrink-0 rounded border border-white/15 bg-white/[0.05] px-1 py-px text-[9px] uppercase tracking-wider text-white/55">
                    Drafted
                  </span>
                ) : null}
              </div>
              <span className="truncate whitespace-nowrap text-[11px] text-white/55">
                <span className="font-semibold text-white/72">{p.position || '—'}</span>
                {p.team ? <span className="ml-1.5 text-white/45">{p.team}</span> : null}
              </span>
            </div>
          </Cell>
        )
      case 'adp':
        return (
          <Cell key={col.key} width={col.width} align="right">
            <span
              data-testid={`${testIdBase}-adp`}
              title={systemAdpCellTitle(p.adp != null && Number.isFinite(Number(p.adp)))}
            >
              {adpDisplay}
            </span>
          </Cell>
        )
      case 'aiAdp':
        return (
          <Cell key={col.key} width={col.width} align="right">
            <span
              data-testid={`${testIdBase}-ai-adp`}
              data-low-sample={p.aiAdpLowSample ? 'true' : 'false'}
              title={aiAdpCellTitle({
                hasValue: p.aiAdp != null && Number.isFinite(Number(p.aiAdp)),
                lowSample: Boolean(p.aiAdpLowSample),
                sampleSize: p.aiAdpSampleSize ?? null,
              })}
              className="inline-flex items-center gap-1"
            >
              {aiAdpDisplay}
              {p.aiAdpLowSample && p.aiAdp != null ? (
                <span
                  aria-hidden
                  data-testid={`${testIdBase}-ai-adp-low-sample`}
                  className="inline-block h-1.5 w-1.5 rounded-full bg-amber-300/70"
                />
              ) : null}
            </span>
          </Cell>
        )
      case 'bye':
        return (
          <Cell key={col.key} width={col.width} align="right">
            <span data-testid={`${testIdBase}-bye`} title={tipFor('bye', col.statLabel ?? 'bye week', p.byeWeek ?? null)}>
              {byeDisplay}
            </span>
          </Cell>
        )
      case 'actions':
        return (
          <Cell key={col.key} width={col.width} align="right" className="gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onCompareTap()
              }}
              aria-label={isCompareAnchor ? 'Clear compare selection' : `Compare ${p.name}`}
              data-testid={`${testIdBase}-compare`}
              className={`inline-flex h-7 w-7 items-center justify-center rounded border transition ${
                isCompareAnchor
                  ? 'border-amber-400/60 bg-amber-500/15 text-amber-100'
                  : 'border-white/15 bg-black/25 text-white/65 hover:border-white/28 hover:bg-white/10'
              }`}
            >
              <GitCompare className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                if (drafted) return
                onAddToQueue()
              }}
              disabled={drafted}
              aria-label={`Queue ${p.name}`}
              data-testid={`${testIdBase}-queue`}
              className={`inline-flex h-7 w-7 items-center justify-center rounded border transition ${
                drafted
                  ? 'cursor-not-allowed border-white/8 bg-black/20 text-white/25'
                  : queued
                    ? 'border-cyan-400/40 bg-cyan-500/15 text-cyan-100'
                    : 'border-white/15 bg-black/25 text-white/65 hover:border-cyan-400/25 hover:bg-white/10'
              }`}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            {canNominate && onNominateRequest ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onNominateRequest()
                }}
                data-testid={`${testIdBase}-nominate`}
                className="inline-flex h-7 items-center rounded border border-amber-400/45 bg-amber-500/15 px-2 text-[10px] font-semibold text-amber-100 hover:brightness-110"
              >
                Nominate
              </button>
            ) : (
              <button
                type="button"
                disabled={!canDraft || drafted}
                onClick={(e) => {
                  e.stopPropagation()
                  if (!canDraft || drafted) return
                  onDraftRequest()
                }}
                title={drafted ? 'Player already drafted' : !canDraft ? 'Not your turn' : 'Draft this player'}
                data-testid={`${testIdBase}-draft`}
                className={`inline-flex h-7 items-center rounded border px-2 text-[10px] font-semibold transition ${
                  drafted
                    ? 'cursor-not-allowed border-white/8 bg-white/[0.04] text-white/30'
                    : !canDraft
                      ? 'cursor-not-allowed border-white/10 bg-black/30 text-white/35'
                      : 'border-cyan-400/45 bg-gradient-to-br from-cyan-500/22 to-violet-600/18 text-cyan-50 hover:brightness-110'
                }`}
              >
                {drafted ? 'Drafted' : 'Draft'}
              </button>
            )}
          </Cell>
        )
      default: {
        const def = statByKey.get(col.key)
        if (!def) return null
        const raw = getStatValueForDraftPlayer(p as DraftStatPlayerSource, def)
        const display = formatDraftStatDisplay(raw, def)
        const tipRaw =
          col.key === 'pts' && splits
            ? splits.projectedPoints ?? null
            : col.key === 'avg' && splits
              ? splits.projectedPointsPerGame ?? null
              : raw
        return (
          <Cell key={col.key} width={col.width} align="right">
            <span data-testid={statTestId} title={tipFor(col.key, col.statLabel ?? def.label, tipRaw)}>
              {display}
            </span>
          </Cell>
        )
      }
    }
  }

  return (
    <div
      role="row"
      data-testid={testIdBase}
      data-drafted={drafted ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
      onClick={() => {
        if (drafted) return
        onSelect()
      }}
      style={{ height: rowHeight, minWidth }}
      className={`flex items-stretch border-b border-white/5 text-xs transition-colors ${
        drafted
          ? 'bg-black/40 text-white/35'
          : selected
            ? 'bg-cyan-500/12 text-white/90'
            : 'bg-transparent text-white/82 hover:bg-white/[0.05] cursor-pointer'
      }`}
    >
      {layout.columns.map((col) => renderColumn(col))}
    </div>
  )
}

const MemoSleeperRow = React.memo(SleeperRow)

export function SleeperPoolTable(props: SleeperPoolTableProps) {
  const {
    filtered,
    selectedPlayer,
    isPlayerQueued,
    isPlayerDrafted,
    canDraft,
    canNominate = false,
    useAiAdp,
    draftSport,
    statColumnOptions,
    onDraftRequest,
    onNominateRequest,
    onAddToQueue,
    onPlayerSelect,
    onCompareTap,
    scrollRef,
    compareAnchor,
    rowHeight = SLEEPER_POOL_TABLE_ROW_HEIGHT,
    disableVirtualization = false,
    sortState = null,
    onSortChange,
  } = props

  const layout = useMemo(
    () => buildSleeperPoolTableLayout(draftSport, statColumnOptions),
    [draftSport, statColumnOptions],
  )

  const statByKey = useMemo(() => new Map(layout.statDefs.map((d) => [d.key, d])), [layout.statDefs])

  const selectedKey = selectedPlayer ? rowKey(selectedPlayer) : null
  const compareKey = compareAnchor ? rowKey(compareAnchor) : null

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
    enabled: !disableVirtualization,
  })

  const items = virtualizer.getVirtualItems()
  const totalSize = disableVirtualization ? filtered.length * rowHeight : virtualizer.getTotalSize()

  const minWidth = layout.minWidth

  return (
    <div
      role="table"
      aria-label="Draft pool players"
      data-testid="sleeper-pool-table"
      style={{ minWidth }}
      className="select-none"
    >
      <div
        role="row"
        data-testid="sleeper-pool-table-header"
        className="sticky top-0 z-10 flex items-center border-b border-white/10 bg-[#0a1228] text-[10px] font-semibold uppercase tracking-wider text-white/55"
        style={{ height: SLEEPER_POOL_TABLE_HEADER_HEIGHT, minWidth }}
      >
        {layout.columns.map((col) => {
          const ariaSort = sortState ? ariaSortValue(col.key, sortState, draftSport) : 'none'
          const isActiveSort = ariaSort !== 'none'
          const sortable = Boolean(onSortChange) && sortKeyForColumn(col.key, draftSport) != null

          const indicator = isActiveSort ? (ariaSort === 'ascending' ? '▲' : '▼') : null

          if (sortable) {
            const sortHint = isActiveSort
              ? ` · click to sort ${ariaSort === 'ascending' ? 'descending' : 'ascending'}`
              : ' · click to sort'
            const buttonTitle = `${col.title ?? col.label}${sortHint}`
            return (
              <Cell key={col.key} width={col.width} align={col.align}>
                <button
                  type="button"
                  aria-sort={ariaSort}
                  aria-label={col.title ?? col.label}
                  title={buttonTitle}
                  data-testid={`sleeper-pool-table-header-${col.key}`}
                  data-sort-active={isActiveSort ? 'true' : 'false'}
                  onClick={() => onSortChange?.(col.key)}
                  className={`inline-flex items-center gap-1 rounded px-1 py-px transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/45 ${
                    isActiveSort
                      ? 'text-cyan-100 underline decoration-cyan-300/55 decoration-2 underline-offset-[3px]'
                      : 'text-white/55 hover:text-white/85'
                  }`}
                >
                  <span>{col.label}</span>
                  {indicator ? (
                    <span aria-hidden className="text-[8px] leading-none text-cyan-300/85">
                      {indicator}
                    </span>
                  ) : null}
                </button>
              </Cell>
            )
          }

          // Non-sortable column (actions, or sort handlers disabled).
          return (
            <Cell key={col.key} width={col.width} align={col.align} title={col.title}>
              <span data-testid={`sleeper-pool-table-header-${col.key}`}>{col.label}</span>
            </Cell>
          )
        })}
      </div>

      <div
        style={{
          height: `${totalSize}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {disableVirtualization ? (
          filtered.map((p, idx) => {
            const k = rowKey(p)
            const drafted = isPlayerDrafted(p)
            const queued = Boolean(isPlayerQueued?.(p))
            return (
              <MemoSleeperRow
                key={p.id ?? k}
                player={p}
                rank={idx + 1}
                layout={layout}
                statByKey={statByKey}
                selected={selectedKey === k}
                drafted={drafted}
                queued={queued}
                canDraft={canDraft}
                canNominate={canNominate}
                useAiAdp={useAiAdp}
                draftSport={draftSport}
                isCompareAnchor={compareKey === k}
                rowHeight={rowHeight}
                minWidth={minWidth}
                onSelect={() => onPlayerSelect(p)}
                onCompareTap={() => onCompareTap(p)}
                onAddToQueue={() => onAddToQueue(p)}
                onDraftRequest={() => onDraftRequest(p)}
                onNominateRequest={onNominateRequest ? () => onNominateRequest(p) : undefined}
                testIdBase={`sleeper-pool-row-${idx}`}
              />
            )
          })
        ) : (
          items.map((virtualRow) => {
            const p = filtered[virtualRow.index]
            if (!p) return null
            const k = rowKey(p)
            const drafted = isPlayerDrafted(p)
            const queued = Boolean(isPlayerQueued?.(p))
            return (
              <div
                key={p.id ?? k}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                data-index={virtualRow.index}
              >
                <MemoSleeperRow
                  player={p}
                  rank={virtualRow.index + 1}
                  layout={layout}
                  statByKey={statByKey}
                  selected={selectedKey === k}
                  drafted={drafted}
                  queued={queued}
                  canDraft={canDraft}
                  canNominate={canNominate}
                  useAiAdp={useAiAdp}
                  draftSport={draftSport}
                  isCompareAnchor={compareKey === k}
                  rowHeight={rowHeight}
                  minWidth={minWidth}
                  onSelect={() => onPlayerSelect(p)}
                  onCompareTap={() => onCompareTap(p)}
                  onAddToQueue={() => onAddToQueue(p)}
                  onDraftRequest={() => onDraftRequest(p)}
                  onNominateRequest={onNominateRequest ? () => onNominateRequest(p) : undefined}
                  testIdBase={`sleeper-pool-row-${virtualRow.index}`}
                />
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
