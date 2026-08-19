import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProjectionValue } from '@/components/league/ProjectionValue'
import LeaguePulseCard from '@/components/decision-os/LeaguePulseCard'
import { buildLeagueHomePulse } from '@/lib/decision-os/league-pulse'
import { getSourceLabel, resolveProjectionAvailability } from '@/lib/league/dataHonesty'

// Honesty Pack: missing data renders as missing — never as a plausible fabricated number,
// never as a green check, never under a "Live" label. Pulse sufficiency has exactly ONE
// owner (buildLeagueHomePulse); the card renders the engine's explicit unavailable state.

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

describe('buildLeagueHomePulse sufficiency (the single contract)', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')
  const team = (overrides: Record<string, unknown> = {}) => ({
    id: 'team-1',
    platformUserId: 'sleeper-1',
    claimedByUserId: null,
    ...overrides,
  })

  it('returns an insufficient-data pulse when no team has been claimed by a real user', () => {
    const result = buildLeagueHomePulse({
      league: { id: 'league-1', teamCount: 10, lifecycleState: 'in_season' },
      teams: Array.from({ length: 10 }, (_, i) => team({ id: `team-${i}`, platformUserId: `sleeper-${i}` })),
      now,
    })
    expect(result.status).toBe('insufficient-data')
    expect(result.metrics.some((m) => m.label === 'Health')).toBe(false)
    expect(result.insufficientData?.title).toBe('No claimed teams yet')
  })

  it('does not mistake an imported platformUserId for a real claim', () => {
    const result = buildLeagueHomePulse({
      league: { id: 'league-2', teamCount: 2, lifecycleState: 'in_season' },
      teams: [team({ id: 'a', platformUserId: 'sleeper-a' }), team({ id: 'b', platformUserId: 'sleeper-b' })],
      now,
    })
    expect(result.status).toBe('insufficient-data')
  })

  it('still computes a normal score once at least one team is genuinely claimed', () => {
    const result = buildLeagueHomePulse({
      league: { id: 'league-3', teamCount: 2, lifecycleState: 'in_season' },
      teams: [
        team({ id: 'a', platformUserId: 'sleeper-a', claimedByUserId: 'user-a' }),
        team({ id: 'b', platformUserId: 'sleeper-b', claimedByUserId: 'user-b' }),
      ],
      now,
    })
    expect(result.status).not.toBe('insufficient-data')
    expect(result.metrics.some((m) => m.label === 'Health')).toBe(true)
  })
})

describe('LeaguePulseCard presents the engine decision (layers cannot disagree)', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')

  it('renders the honest unavailable panel for an insufficient-data pulse, without a health claim', () => {
    const pulse = buildLeagueHomePulse({
      league: { id: 'league-x', teamCount: 4, lifecycleState: 'in_season' },
      teams: [{ id: 't1', platformUserId: 'sleeper-1', claimedByUserId: null }],
      now,
    })
    render(<LeaguePulseCard pulse={pulse} variant="league" compact />)
    expect(screen.getByText('No claimed teams yet')).toBeInTheDocument()
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument()
  })

  it('renders a status label for a scoreable league', () => {
    const pulse = buildLeagueHomePulse({
      league: { id: 'league-y', teamCount: 2, lifecycleState: 'in_season' },
      teams: [
        { id: 'a', platformUserId: 'sleeper-a', claimedByUserId: 'user-a' },
        { id: 'b', platformUserId: 'sleeper-b', claimedByUserId: 'user-b' },
      ],
      now,
    })
    render(<LeaguePulseCard pulse={pulse} variant="league" compact />)
    expect(screen.getByText(pulse.statusLabel)).toBeInTheDocument()
    expect(screen.queryByText('No claimed teams yet')).not.toBeInTheDocument()
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
