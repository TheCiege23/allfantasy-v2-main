import { describe, expect, it } from 'vitest'
import { chooseShareVideoFormat } from '@/lib/core-app/shareVideo'
import { collapseMirroredTradeRows } from '@/lib/core-app/tradeHistorySelection'
import { resolveRailMatchupMode } from '@/lib/core-app/railMatchupMode'

describe('completed trade history source selection', () => {
  it('shows one trade and orients the row to the signed-in manager', () => {
    const rows = [
      { transactionId: 'tx-1', history: { sleeperUsername: 'other' }, playersReceived: ['a'] },
      { transactionId: 'tx-1', history: { sleeperUsername: 'viewer' }, playersReceived: ['b'] },
      { transactionId: 'tx-2', history: { sleeperUsername: 'other' }, playersReceived: ['c'] },
    ]

    const result = collapseMirroredTradeRows(rows, 'viewer')

    expect(result).toHaveLength(2)
    expect(result[0]?.history.sleeperUsername).toBe('viewer')
    expect(result[0]?.playersReceived).toEqual(['b'])
  })
})

describe('League Wrapped animation format', () => {
  it('prefers MP4 when the browser can record it', () => {
    expect(chooseShareVideoFormat((mime) => mime === 'video/mp4')).toEqual({
      mime: 'video/mp4',
      extension: 'mp4',
    })
  })

  it('falls back to WebM and reports no format when recording is unavailable', () => {
    expect(chooseShareVideoFormat((mime) => mime === 'video/webm;codecs=vp8')).toEqual({
      mime: 'video/webm;codecs=vp8',
      extension: 'webm',
    })
    expect(chooseShareVideoFormat(() => false)).toBeNull()
  })
})

describe('matchup rail presentation mode', () => {
  it('shows guillotine rank even when the provider supplied an opponent id', () => {
    expect(resolveRailMatchupMode(true, true)).toBe('elimination')
  })

  it('keeps ordinary paired and unpaired leagues distinct', () => {
    expect(resolveRailMatchupMode(false, true)).toBe('head_to_head')
    expect(resolveRailMatchupMode(false, false)).toBe('unpaired')
  })
})
