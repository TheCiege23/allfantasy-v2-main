import { describe, expect, it } from 'vitest'

import {
  DELAY_INTERVAL_MULTIPLE,
  connectionDetail,
  connectionLabel,
  isConnectionFault,
  resolveConnectionState,
  type ConnectionInputs,
} from '@/lib/live/connectionState'

/*
 * What the live screens may claim about their own connection.
 *
 * ⚠ THE FAILURE THIS REPLACES WAS SILENT ON BOTH SURFACES. A failed poll was
 * caught and discarded, so a browser with no network kept rendering "Live" over
 * numbers that had stopped moving. The only tell was the age label climbing, and
 * only for someone already watching it.
 */

const LIVE_POLL = 20_000

function inputs(over: Partial<ConnectionInputs> = {}): ConnectionInputs {
  return {
    online: true,
    consecutiveFailures: 0,
    anyLive: false,
    ageSeconds: 5,
    pollIntervalMs: LIVE_POLL,
    ...over,
  }
}

describe('resolveConnectionState', () => {
  it('is idle when nothing is in play', () => {
    expect(resolveConnectionState(inputs())).toBe('idle')
  })

  it('is live when a game is in play and the feed is keeping up', () => {
    expect(resolveConnectionState(inputs({ anyLive: true }))).toBe('live')
  })

  it('reports offline when the browser says it has no network', () => {
    expect(resolveConnectionState(inputs({ online: false, anyLive: true }))).toBe('offline')
  })

  /*
   * ⚠ `navigator.onLine === true` IS NOT EVIDENCE OF A WORKING CONNECTION — it is
   * equally true on captive hotel wifi and on a LAN with no route out. The value
   * is believed only in the negative, so `true` must not suppress a fault the
   * failure count has actually observed.
   */
  it('still reports reconnecting when the browser claims to be online but polls fail', () => {
    expect(resolveConnectionState(inputs({ online: true, consecutiveFailures: 2 }))).toBe(
      'reconnecting',
    )
  })

  it('treats an unknown online status as no opinion rather than offline', () => {
    expect(resolveConnectionState(inputs({ online: null, anyLive: true }))).toBe('live')
  })

  it('offline outranks a failing poll, because it explains it', () => {
    expect(resolveConnectionState(inputs({ online: false, consecutiveFailures: 3 }))).toBe(
      'offline',
    )
  })

  it('reports reconnecting after a single failure', () => {
    expect(resolveConnectionState(inputs({ consecutiveFailures: 1 }))).toBe('reconnecting')
  })

  it('reports delayed when a live feed has gone quiet past the cadence', () => {
    const stale = (LIVE_POLL * DELAY_INTERVAL_MULTIPLE) / 1000 + 1
    expect(resolveConnectionState(inputs({ anyLive: true, ageSeconds: stale }))).toBe('delayed')
  })

  /*
   * ⚠ THE MOST IMPORTANT NEGATIVE HERE. Since the payload gained a validator, a
   * 304 means the feed was NOT re-read — so on a quiet slate a climbing age is
   * correct and expected. Flagging it would put "Delayed" on the screen every
   * Tuesday and teach people to ignore the badge by the Sunday it matters.
   */
  it('does NOT report delayed on a quiet slate, however old the payload is', () => {
    expect(resolveConnectionState(inputs({ anyLive: false, ageSeconds: 86_400 }))).toBe('idle')
  })

  /*
   * ⚠ THE BAR TRACKS THE CADENCE, NOT A CONSTANT. A longer poll interval is a
   * choice (low-data mode), not the feed being late — a fixed threshold would
   * accuse the feed of exactly what we told it to do.
   */
  it('widens the staleness bar when the poll interval is longer', () => {
    const age = (LIVE_POLL * DELAY_INTERVAL_MULTIPLE) / 1000 + 1
    expect(resolveConnectionState(inputs({ anyLive: true, ageSeconds: age }))).toBe('delayed')
    expect(
      resolveConnectionState(inputs({ anyLive: true, ageSeconds: age, pollIntervalMs: 60_000 })),
    ).toBe('live')
  })

  it('makes no delay claim when the payload could not be dated', () => {
    expect(resolveConnectionState(inputs({ anyLive: true, ageSeconds: null }))).toBe('live')
  })

  it('a failing poll outranks a merely stale one', () => {
    const stale = (LIVE_POLL * DELAY_INTERVAL_MULTIPLE) / 1000 + 1
    expect(
      resolveConnectionState(inputs({ anyLive: true, ageSeconds: stale, consecutiveFailures: 1 })),
    ).toBe('reconnecting')
  })
})

describe('labels and detail', () => {
  it('names every state', () => {
    expect(connectionLabel('offline')).toBe('Offline')
    expect(connectionLabel('reconnecting')).toBe('Reconnecting')
    expect(connectionLabel('delayed')).toBe('Delayed')
    expect(connectionLabel('live')).toBe('Live')
    expect(connectionLabel('idle')).toBe('Idle')
  })

  it('explains only the faults', () => {
    expect(connectionDetail('live')).toBeNull()
    expect(connectionDetail('idle')).toBeNull()
    for (const state of ['offline', 'reconnecting', 'delayed'] as const) {
      expect(connectionDetail(state)).toBeTruthy()
    }
  })

  /*
   * ⚠ EVERY FAULT MESSAGE SAYS WHAT IS STILL TRUE OF WHAT IS ON SCREEN. The
   * scores are real, just old. A notice that only announced the break would leave
   * the reader unsure whether to believe any number in front of them.
   */
  it('each fault message accounts for the scores still on screen', () => {
    expect(connectionDetail('offline')).toMatch(/last we received/i)
    expect(connectionDetail('reconnecting')).toMatch(/last scores we received/i)
    expect(connectionDetail('delayed')).toMatch(/may be behind/i)
  })

  it('classifies which states are faults', () => {
    expect(isConnectionFault('offline')).toBe(true)
    expect(isConnectionFault('reconnecting')).toBe(true)
    expect(isConnectionFault('delayed')).toBe(true)
    expect(isConnectionFault('live')).toBe(false)
    expect(isConnectionFault('idle')).toBe(false)
  })
})
