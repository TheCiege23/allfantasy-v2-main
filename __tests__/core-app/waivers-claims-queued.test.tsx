import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

import { Waivers } from '@/components/core-app/screens/Waivers'
import type { WaiversData } from '@/lib/core-app/waivers'
import { waiversMessages } from '@/lib/core-app/messages/waivers'

/**
 * The Claims queued tile had a second line only at zero ("nothing pending"). With claims pending it
 * stood a line short of its neighbours, an empty band under the number. It now says when they act.
 */

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function data(count: number): WaiversData {
  return {
    league: { id: 'L1', name: 'Sunday Night Redraft', platform: 'sleeper', format: null, platformLeagueId: 'S1' },
    budget: { available: false, reason: 'x' },
    waiverPriority: { available: false, reason: 'x' },
    rosterLoad: { available: false, reason: 'x' },
    claimsQueued: { available: true, data: { count } },
    waiverType: { available: false, reason: 'x' },
    processTime: { available: false, reason: 'x' },
    tiebreak: { available: false, reason: 'x' },
    claimLimits: { available: false, reason: 'x' },
  } as unknown as WaiversData
}

const tileText = (count: number) => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})) as never)
  const { container } = render(<Waivers data={data(count)} edge={null} edgeAccess={null} />)
  const tile = [...container.querySelectorAll('[data-tile="claims"], .af-wv-tile')].find((t) => /Claims queued/i.test(t.textContent ?? ''))
  return tile?.querySelector('.af-wv-tile-sub')?.textContent ?? null
}

describe('Waivers — Claims queued tile', () => {
  it('says pending claims wait for the next run', () => {
    expect(tileText(2)).toBe('wait for the next run')
    cleanup()
    expect(tileText(1)).toBe('waits for the next run')
  })

  it('still says nothing is pending at zero', () => {
    expect(tileText(0)).toBe('nothing pending')
  })

  it('has the line in Spanish too', () => {
    expect(waiversMessages.es.claimsPending(3)).toBe('esperan la próxima ejecución')
    expect(waiversMessages.es.claimsPending(1)).toBe('espera la próxima ejecución')
  })
})
