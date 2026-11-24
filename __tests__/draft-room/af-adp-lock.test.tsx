import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { AfAdpLockContext, afAdpLockOf } from '@/components/app/draft-room/afAdpLock'
import { SleeperPoolTable } from '@/components/app/draft-room/SleeperPoolTable'
import { decideCoreDepth } from '@/lib/core-app/coreDepthAccess'

const lock = decideCoreDepth('af_intelligence', { live: true, startsAt: new Date('2026-10-15T04:00:00Z'), hasPlan: false })
const open = decideCoreDepth('af_intelligence', { live: true, startsAt: new Date('2026-10-15T04:00:00Z'), hasPlan: true })

describe('AF ADP lock in the draft rooms', () => {
  it('reads the lock off a pool response, and only a locked one', () => {
    expect(afAdpLockOf({ entries: [], afIntelligenceLock: lock })).toEqual(lock)
    expect(afAdpLockOf({ entries: [], afIntelligenceLock: open })).toBeNull()
    expect(afAdpLockOf({ entries: [] })).toBeNull()
    expect(afAdpLockOf(null)).toBeNull()
  })

  const row = { id: 'p1', name: 'Player One', position: 'RB', team: 'BUF', adp: 20.4 }
  const render = (value: typeof lock | null) =>
    renderToStaticMarkup(
      <AfAdpLockContext.Provider value={value}>
        <SleeperPoolTable
          {...({
            filtered: [row], draftedNames: new Set(), selectedPlayer: null, isPlayerQueued: () => false, isPlayerDrafted: () => false,
            canDraft: true, useAiAdp: false, draftSport: 'NFL', onDraftRequest: () => {}, onAddToQueue: () => {}, onPlayerSelect: () => {},
            onCompareTap: () => {}, scrollRef: { current: null }, compareAnchor: null, disableVirtualization: true, onSortChange: () => {},
          } as never)}
        />
      </AfAdpLockContext.Provider>,
    )

  it('a locked viewer keeps the AF ADP column, with ONE upgrade link in its header and a lock in each cell', () => {
    const html = render(lock)
    expect(html.match(/data-testid="af-adp-lock-cta"/g)).toHaveLength(1)
    expect(html).toContain('data-ios-purchase')
    expect(html).toContain('🔒')
  })

  it('no lock and no AF ADP: the column stays hidden, as before (positive control)', () => {
    const html = render(null)
    expect(html).not.toContain('af-adp-lock-cta')
    expect(html).not.toContain('sleeper-pool-table-header-afAdp')
  })
})
