'use client'

import { useState, type Key, type ReactNode } from 'react'

const PAGE_SIZE = 50

/** Natural row height avoids measurement feedback when narrow cards wrap or images load. */
export function ProgressiveDraftPlayerList<T>({ items, itemKey, renderItem }: {
  items: T[]
  itemKey: (item: T) => Key
  renderItem: (item: T, index: number) => ReactNode
}) {
  const [page, setPage] = useState({ items, limit: PAGE_SIZE })
  // Search/filter/sort produces a new result set; always start it at the beginning.
  const limit = page.items === items ? page.limit : PAGE_SIZE
  if (page.items !== items) setPage({ items, limit: PAGE_SIZE })
  const shown = Math.min(limit, items.length)
  return <div className="w-full space-y-1" data-testid="draft-progressive-player-list">
    {items.slice(0, shown).map((item, index) => <div key={itemKey(item)}>{renderItem(item, index)}</div>)}
    {shown < items.length ? <button type="button"
      className="min-h-[44px] w-full rounded-lg border border-white/20 px-3 py-2 text-sm text-white/80"
      data-testid="draft-player-load-more"
      onClick={() => setPage({ items, limit: limit + PAGE_SIZE })}>
      Show more players ({shown} of {items.length})
    </button> : null}
  </div>
}
