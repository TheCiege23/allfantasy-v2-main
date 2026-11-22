import React from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZombieOverridePanel } from '@/app/zombie/components/commissioner/ZombieOverridePanel'

/** "Adjust Winnings" is gone from the commissioner panel; the other overrides stay. */

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ teams: [] }) })))
})
afterEach(() => vi.unstubAllGlobals())

describe('ZombieOverridePanel', () => {
  it('offers no winnings adjustment, and still offers the status override and item awards', () => {
    render(<ZombieOverridePanel leagueId="L" canEdit />)
    expect(screen.queryByText('Adjust Winnings')).toBeNull()
    expect(screen.getByText('Override Player Status')).toBeTruthy()
    expect(screen.getByText('Award Item')).toBeTruthy()
  })
})
