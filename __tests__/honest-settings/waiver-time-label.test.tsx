/**
 * The settings window's waiver processing time says what it stores (2026-11-15).
 *
 * 🛑 It was labelled "league local" and saved the engine's UTC run time, so 03:00 picked in New York ran at 10 PM.
 * The label now says UTC and shows the league's clock time beside each choice.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { utcProcessTimeAsLocalLabel } from '@/lib/waivers/dailyWaiverSchedule'

vi.stubGlobal('fetch', vi.fn(async () => new Response('null', { status: 200 })))

describe('a UTC run time on the league clock', () => {
  const winter = new Date('2026-01-15T12:00:00Z')
  const summer = new Date('2026-07-15T12:00:00Z')
  it('converts, following daylight time', () => {
    expect(utcProcessTimeAsLocalLabel('03:00', 'America/New_York', winter)).toBe('10:00 PM')
    expect(utcProcessTimeAsLocalLabel('03:00', 'America/New_York', summer)).toBe('11:00 PM')
    expect(utcProcessTimeAsLocalLabel('12:00', 'America/Los_Angeles', winter)).toBe('4:00 AM')
  })
  it('an unreadable time shows nothing rather than a wrong time', () => {
    expect(utcProcessTimeAsLocalLabel('25:00', 'America/New_York')).toBeNull()
    expect(utcProcessTimeAsLocalLabel(null, 'America/New_York')).toBeNull()
  })
})

describe('the waivers tab', () => {
  it('labels the time UTC and shows the league\'s own clock time', async () => {
    const { WaiverLeagueSettingsPanel } = await import('@/app/league/[leagueId]/components/settings/WaiverLeagueSettingsPanel')
    render(<WaiverLeagueSettingsPanel leagueId="L1" initialData={{ timezone: 'America/Chicago', waiverType: 'faab' } as never} canEdit debouncedSave={vi.fn()} />)
    expect(screen.getByText('Waiver processing time (UTC)')).toBeTruthy()
    expect(screen.queryByText(/league local/)).toBeNull()
    expect(screen.getByTestId('waiver-time-local-03:00').textContent).toMatch(/(9|10):00 PM/)
  })
})
