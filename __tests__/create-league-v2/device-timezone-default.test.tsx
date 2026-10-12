/**
 * A fresh create starts on the device's timezone (2026-10-12) instead of America/New_York. A form
 * restored from this tab and an import keep their own; a device zone off the standard list still
 * shows as selected; and the server accepts it.
 */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const deviceZone = vi.hoisted(() => ({ value: 'Europe/London' as string | null }))

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (key: string) => key, language: 'en' }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/create-league-v2/device-timezone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/create-league-v2/device-timezone')>()),
  readDeviceTimezone: () => deviceZone.value,
}))
vi.mock('@/components/create-league-v2/CreateLeagueWizard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/create-league-v2/CreateLeagueWizard')>()),
  CreateLeagueWizard: ({ state }: { state: { timezone: string } }) => <output data-testid="tz">{state.timezone}</output>,
}))
vi.mock('@/components/create-league-v2/CreateLeagueVideoTile', () => ({
  CreateLeagueVideoTile: ({ testId }: { testId: string }) => <button data-testid={testId} />,
}))

import { CreateLeagueV2Client } from '@/app/create-league/v2/CreateLeagueV2Client'
import { DraftStep } from '@/components/create-league-v2/CreateLeagueWizard'
import { timezoneOptions } from '@/lib/create-league-v2/device-timezone'
import { DEFAULT_V2_STATE, persistV2State, clearPersistedV2State } from '@/lib/create-league-v2/state'
import { submitCreateLeagueV2 } from '@/lib/create-league-v2/submit'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'

const tz = () => screen.getByTestId('tz').textContent

describe('a fresh create starts on the device timezone', () => {
  beforeEach(() => {
    clearPersistedV2State()
    deviceZone.value = 'Europe/London'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) }) as Response))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    clearPersistedV2State()
  })

  it('takes the device zone, including one off the standard list', async () => {
    render(<CreateLeagueV2Client userId="u1" />)
    await waitFor(() => expect(tz()).toBe('Europe/London'))
  })

  it('stays on New York when the device cannot say', async () => {
    deviceZone.value = null
    render(<CreateLeagueV2Client userId="u1" />)
    await waitFor(() => expect(tz()).toBe('America/New_York'))
  })

  it('a form restored from this tab keeps the timezone it had', async () => {
    persistV2State({ ...DEFAULT_V2_STATE, leagueType: 'redraft', timezone: 'America/Denver' })
    render(<CreateLeagueV2Client userId="u1" />)
    await waitFor(() => expect(tz()).toBe('America/Denver'))
  })

  it('an import keeps its own timezone', async () => {
    render(<CreateLeagueV2Client userId="u1" importTemplate={{ ...DEFAULT_V2_STATE, leagueType: 'redraft', timezone: 'America/Phoenix' }} />)
    await waitFor(() => expect(tz()).toBe('America/Phoenix'))
  })
})

describe('device timezone helpers', () => {
  it('readDeviceTimezone accepts a real IANA zone and refuses anything else', async () => {
    // The module mock above replaces readDeviceTimezone for the page tests; test the real one.
    const { readDeviceTimezone } = await vi.importActual<typeof import('@/lib/create-league-v2/device-timezone')>('@/lib/create-league-v2/device-timezone')
    expect(readDeviceTimezone(() => 'America/Chicago')).toBe('America/Chicago')
    expect(readDeviceTimezone(() => 'Not/A_Zone')).toBeNull()
    expect(readDeviceTimezone(() => undefined)).toBeNull()
    expect(readDeviceTimezone(() => { throw new Error('no Intl') })).toBeNull()
  })

  it('timezoneOptions puts an unlisted current zone first and leaves listed ones alone', () => {
    expect(timezoneOptions('Europe/London')[0]).toBe('Europe/London')
    expect(timezoneOptions('America/Chicago').filter((z) => z === 'America/Chicago')).toHaveLength(1)
    expect(timezoneOptions('America/Chicago')[0]).toBe('America/New_York')
  })

  it('the Draft step shows an unlisted device zone as the selected option', () => {
    render(<DraftStep state={{ ...DEFAULT_V2_STATE, leagueType: 'redraft', scoringPresetId: 'fb_half_ppr', timezone: 'Europe/London' }} onChange={vi.fn()} fieldErrors={null} />)
    expect((screen.getByTestId('g30-timezone') as HTMLSelectElement).value).toBe('Europe/London')
  })

  it('the server accepts a device zone off the standard list, for the league and the draft', async () => {
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return { ok: true, json: async () => ({ success: true, league: { id: 'l1' }, homepageUrl: '/league/l1' }) } as Response
    }))
    try {
      await submitCreateLeagueV2({ ...DEFAULT_V2_STATE, leagueType: 'redraft', scoringPresetId: 'fb_half_ppr', name: 'London League', nameTouched: true, draftDate: '2026-11-08', draftTime: '20:00', timezone: 'Europe/London' })
      expect(bodies[0].timezone).toBe('Europe/London')
      expect((bodies[0].conceptSetup as Record<string, unknown>).draftTimezone).toBe('Europe/London')
      expect(validateCreatePayload(bodies[0]).ok).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
