'use client'

import Link from 'next/link'
import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { MyLeaguesHistoryRow } from '@/lib/core-app/myLeagues'

const VIRTUALIZE_AT = 60
const ROW_HEIGHT = 50
const VIEW_HEIGHT = 520
const INITIAL_WINDOW_ROWS = Math.ceil(VIEW_HEIGHT / ROW_HEIGHT) + 8

function platformLabel(platform: string): string {
  const key = platform.toLowerCase()
  if (key === 'allfantasy') return 'AllFantasy'
  if (key === 'espn') return 'ESPN'
  if (key === 'mfl') return 'MFL'
  return key.charAt(0).toUpperCase() + key.slice(1)
}

function HistoryLink({ row }: { row: MyLeaguesHistoryRow }) {
  return (
    <Link href="/core/career" className="af-ml-hist-row">
      <span className="af-ml-hist-name">{row.name}</span>
      <span className="af-ml-hist-meta af-num">
        {row.season ?? '—'} · {platformLabel(row.platform)}
      </span>
    </Link>
  )
}

/**
 * Keeps a large imported career searchable without placing hundreds of links in
 * the DOM at once. Short histories remain plain server-rendered links; long
 * histories render a stable first window for hydration and recycle rows while
 * the user scrolls.
 */
export function LeagueHistoryVirtualList({ rows }: { rows: MyLeaguesHistoryRow[] }) {
  if (rows.length <= VIRTUALIZE_AT) {
    return (
      <div className="af-ml-hist" role="list" aria-label={`${rows.length} past seasons`}>
        {rows.map((row) => (
          <div role="listitem" key={row.id}>
            <HistoryLink row={row} />
          </div>
        ))}
      </div>
    )
  }

  return <VirtualHistoryList rows={rows} />
}

function VirtualHistoryList({ rows }: { rows: MyLeaguesHistoryRow[] }) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    initialRect: { width: 0, height: VIEW_HEIGHT },
  })
  const measuredItems = virtualizer.getVirtualItems()
  // A scroll element does not exist during server rendering. Keep the first
  // viewport useful before hydration instead of shipping an empty list shell.
  const visibleItems = measuredItems.length
    ? measuredItems
    : rows.slice(0, INITIAL_WINDOW_ROWS).map((_, index) => ({
        index,
        size: ROW_HEIGHT,
        start: index * ROW_HEIGHT,
      }))

  return (
    <>
      <div
        ref={scrollRef}
        className="af-ml-hist af-ml-hist--virtual"
        role="list"
        aria-label={`${rows.length} past seasons. Scroll to browse all results.`}
        tabIndex={0}
      >
        <div className="af-ml-hist-canvas" style={{ height: virtualizer.getTotalSize() }}>
          {visibleItems.map((item) => {
            const row = rows[item.index]
            return (
              <div
                key={row.id}
                role="listitem"
                className="af-ml-hist-item"
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
              >
                <HistoryLink row={row} />
              </div>
            )
          })}
        </div>
      </div>
      <p className="af-ml-hist-note">
        Showing all {rows.length} matching seasons in a fast scrolling list.
      </p>
      <noscript>
        <p className="af-ml-hist-note">Turn on JavaScript to browse this large career history.</p>
      </noscript>
    </>
  )
}
