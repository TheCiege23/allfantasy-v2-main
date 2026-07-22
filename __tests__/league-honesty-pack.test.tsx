import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProjectionValue } from '@/components/league/ProjectionValue'
import {
  getSourceLabel,
  hasLeaguePulseData,
  resolveChecklistSignal,
  resolveProjectionAvailability,
} from '@/lib/league/dataHonesty'

// Honesty Pack 1A: missing data renders as missing — never as a plausible fabricated number,
// never as a green check, never under a "Live" label.

describe('ProjectionValue', () => {
  it('does not fabricate a missing projection', () => {
    render(
      <ProjectionValue
        projection={{ state: 'unavailable', value: null, source: null, reason: 'provider_missing' }}
      />
    )
    expect(screen.getByLabelText('Projection unavailable')).toHaveTextContent('—')
    expect(screen.queryByText(/baseline/i)).not.toBeInTheDocument()
  })

  it('preserves a real zero projection', () => {
    render(<ProjectionValue projection={{ state: 'available', value: 0, source: 'provider' }} />)
    expect(screen.getByText('0.0')).toBeInTheDocument()
  })

  it('renders a real provider projection', () => {
    render(<ProjectionValue projection={{ state: 'available', value: 17.4, source: 'provider' }} />)
    expect(screen.getByText('17.4')).toBeInTheDocument()
  })

  it('labels an approved derived projection as derived', () => {
    render(
      <ProjectionValue projection={{ state: 'available', value: 12.3, source: 'allfantasy-derived' }} />
    )
    expect(screen.getByText('AllFantasy derived projection')).toBeInTheDocument()
  })
})

describe('resolveProjectionAvailability', () => {
  it('provider value wins; zero is real; unapproved derived is unavailable', () => {
    expect(resolveProjectionAvailability({ providerProjection: 0 })).toMatchObject({
      state: 'available', value: 0, source: 'provider',
    })
    expect(
      resolveProjectionAvailability({ derivedProjection: 9.9, derivedProjectionApproved: false })
    ).toMatchObject({ state: 'unavailable', reason: 'provider_missing' })
    expect(
      resolveProjectionAvailability({ derivedProjection: 9.9, derivedProjectionApproved: true })
    ).toMatchObject({ state: 'available', source: 'allfantasy-derived' })
    expect(resolveProjectionAvailability({ providerSynced: false })).toMatchObject({
      state: 'unavailable', reason: 'not_synced',
    })
  })
})

describe('hasLeaguePulseData', () => {
  it('does not show League Pulse without real data', () => {
    expect(
      hasLeaguePulseData({ activityCount: 0, transactionCount: 0, signalCount: 0, lastActivityAt: null })
    ).toBe(false)
    expect(hasLeaguePulseData({})).toBe(false)
  })

  it('renders when a real signal exists', () => {
    expect(hasLeaguePulseData({ activityCount: 1 })).toBe(true)
    expect(hasLeaguePulseData({ managerDnaPresent: true })).toBe(true)
    expect(hasLeaguePulseData({ lastActivityAt: '2026-07-21T00:00:00Z' })).toBe(true)
  })
})

describe('resolveChecklistSignal', () => {
  it('never defaults to complete; unknown is not green', () => {
    expect(resolveChecklistSignal('Standings up to date', undefined).state).toBe('unknown')
    expect(resolveChecklistSignal('Standings up to date', null).state).toBe('unknown')
    expect(resolveChecklistSignal('Waivers reviewed', false).state).toBe('incomplete')
    expect(resolveChecklistSignal('Waivers reviewed', true).state).toBe('complete')
  })
})

describe('getSourceLabel', () => {
  it('"Live from" appears only for live data', () => {
    expect(getSourceLabel({ sourceName: 'Sleeper', freshness: 'live' })).toBe('Live from Sleeper')
    expect(getSourceLabel({ sourceName: 'Sleeper', freshness: 'recent' })).toBe('Synced from Sleeper')
    expect(getSourceLabel({ sourceName: 'Sleeper', freshness: 'recent' })).not.toMatch(/^Live/)
  })

  it('stale data receives previously-synced wording', () => {
    expect(getSourceLabel({ sourceName: 'Sleeper', freshness: 'stale' })).toBe('Previously synced from Sleeper')
  })

  it('mixed-source data receives combined wording; unavailable says so', () => {
    expect(getSourceLabel({ freshness: 'mixed' })).toBe('Combined league data')
    expect(getSourceLabel({ freshness: 'unavailable' })).toBe('Data unavailable')
  })
})
