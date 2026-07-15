import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { LegacySnapshotCard } from '@/app/dashboard/components/LegacySnapshotCard'

/**
 * Regression coverage for the dead Archetype tile (AF_DATA_PROVENANCE_AUDIT.md demo risk #5).
 *
 * A 4th "Archetype" tile used to always render "—" (no managerArchetype field ever existed).
 * It was removed, leaving three real tiles (AF Rank / Tier / XP) plus an honest "import to
 * unlock" empty state. These tests certify the tile is gone and the empty state is honest.
 */

// The card calls consumeDashboardRankRefreshPending() in an effect (reads session storage);
// pin it to false so the "just refreshed" indicator never confounds the assertions.
vi.mock('@/lib/import/dashboardRankRefresh', () => ({
  consumeDashboardRankRefreshPending: vi.fn(() => false),
}))

describe('LegacySnapshotCard (provenance #5)', () => {
  it('renders three real tiles with real values and NO Archetype tile', () => {
    render(
      <LegacySnapshotCard
        rankPayload={{ levelName: 'Grizzled Vet', tier: 'Gold', xpTotal: 42000, imported: true }}
      />
    )

    expect(within(screen.getByTestId('legacy-stat-rank')).getByText('Grizzled Vet')).toBeInTheDocument()
    expect(within(screen.getByTestId('legacy-stat-tier')).getByText('Gold')).toBeInTheDocument()
    expect(within(screen.getByTestId('legacy-stat-xp')).getByText('42000')).toBeInTheDocument()

    // The dead tile is gone.
    expect(screen.queryByText('Archetype')).not.toBeInTheDocument()
    // With real data present, the empty-state CTA does not show.
    expect(screen.queryByTestId('legacy-snapshot-import-cta')).not.toBeInTheDocument()
  })

  it('shows the honest "import to unlock" CTA (not a fabricated tile) when there is no data', () => {
    render(<LegacySnapshotCard rankPayload={null} />)

    const cta = screen.getByTestId('legacy-snapshot-import-cta')
    expect(cta).toBeInTheDocument()
    expect(cta).toHaveTextContent(/import a sleeper league to unlock/i)

    // Still no Archetype tile, and the CTA carries the honest empty state (the "—" in the stat
    // tiles is an empty marker shown alongside the CTA, not a value presented as real data).
    expect(screen.queryByText('Archetype')).not.toBeInTheDocument()
  })

  it('reads rank from tierName / careerTierName fallbacks (never renders "[object Object]")', () => {
    render(<LegacySnapshotCard rankPayload={{ rank: { careerTierName: 'Rookie', careerTier: 'Bronze' } }} />)
    expect(within(screen.getByTestId('legacy-stat-rank')).getByText('Rookie')).toBeInTheDocument()
    expect(within(screen.getByTestId('legacy-stat-tier')).getByText('Bronze')).toBeInTheDocument()
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument()
    expect(screen.queryByText('Archetype')).not.toBeInTheDocument()
  })
})
