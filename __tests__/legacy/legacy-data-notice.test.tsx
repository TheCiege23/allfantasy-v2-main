// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LegacyDataNotice, LegacyUnavailableValue } from '@/components/legacy/LegacyDataNotice'
import type { LegacyDataStatus } from '@/lib/legacy/dataStatus'

const baseStatus: LegacyDataStatus = {
  state: 'unavailable',
  confidence: 'unknown',
  source: 'sleeper',
  lastUpdatedAt: null,
  message: 'Projection unavailable.',
  retryable: false,
}

describe('LegacyDataNotice', () => {
  it('renders the honest message for an unavailable state', () => {
    render(<LegacyDataNotice status={baseStatus} />)
    expect(screen.getByText('Data unavailable')).toBeDefined()
    expect(screen.getByText('Projection unavailable.')).toBeDefined()
  })

  it('renders failed states as alerts', () => {
    render(
      <LegacyDataNotice
        status={{ ...baseStatus, state: 'failed', message: 'We could not load this.', retryable: true }}
      />,
    )
    expect(screen.getByRole('alert')).toBeDefined()
  })

  it('renders a stale state with the last-updated timestamp', () => {
    render(
      <LegacyDataNotice
        status={{
          ...baseStatus,
          state: 'stale',
          message: 'Data may be outdated.',
          lastUpdatedAt: '2026-07-01T12:00:00.000Z',
        }}
      />,
    )
    expect(screen.getByText('Data may be outdated')).toBeDefined()
    expect(screen.getByText(/Last updated/)).toBeDefined()
  })

  it('renders a partial state with retry wired', () => {
    const onRetry = vi.fn()
    render(
      <LegacyDataNotice
        status={{ ...baseStatus, state: 'partial', message: '2 of 5 seasons imported.', retryable: true }}
        onRetry={onRetry}
      />,
    )
    expect(screen.getByText('Some data is missing')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders an external action link without implying AF performs the action', () => {
    render(
      <LegacyDataNotice
        status={{
          ...baseStatus,
          state: 'not_supported',
          message: 'Lineup changes happen on Sleeper.',
          externalActionRequired: true,
          externalActionLabel: 'Open in Sleeper',
          externalActionUrl: 'https://sleeper.com/leagues/123',
        }}
      />,
    )
    const link = screen.getByRole('link', { name: 'Open in Sleeper' })
    expect(link.getAttribute('href')).toBe('https://sleeper.com/leagues/123')
    expect(link.getAttribute('target')).toBe('_blank')
  })
})

describe('LegacyDataNotice — URL and timestamp safety', () => {
  it('never renders a javascript: URL as a link', () => {
    render(
      <LegacyDataNotice
        status={{
          ...baseStatus,
          externalActionRequired: true,
          externalActionLabel: 'Open in Sleeper',
          externalActionUrl: 'javascript:alert(1)',
        }}
      />,
    )
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('never renders an http: (non-https) or malformed URL as a link', () => {
    const { rerender } = render(
      <LegacyDataNotice
        status={{
          ...baseStatus,
          externalActionRequired: true,
          externalActionLabel: 'Open in Sleeper',
          externalActionUrl: 'http://sleeper.com/x',
        }}
      />,
    )
    expect(screen.queryByRole('link')).toBeNull()
    rerender(
      <LegacyDataNotice
        status={{
          ...baseStatus,
          externalActionRequired: true,
          externalActionLabel: 'Open in Sleeper',
          externalActionUrl: 'not a url',
        }}
      />,
    )
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('does not throw or render garbage for an invalid lastUpdatedAt', () => {
    render(<LegacyDataNotice status={{ ...baseStatus, lastUpdatedAt: 'not-a-date' }} />)
    expect(screen.queryByText(/Last updated/)).toBeNull()
  })
})

describe('LegacyUnavailableValue', () => {
  it('does not render zero for unavailable data', () => {
    render(<LegacyUnavailableValue value={null} label="Score unavailable" />)
    expect(screen.queryByText('0')).toBeNull()
    expect(screen.getByLabelText('Score unavailable')).toBeDefined()
  })

  it('renders a real zero as 0 (a measured zero is not missing data)', () => {
    render(<LegacyUnavailableValue value={0} />)
    expect(screen.getByText('0')).toBeDefined()
  })
})
