/**
 * The contract panel used to fall back to a hash of the player id.
 *
 * This is worth locking down because the wrong answer is a wrong *claim about a league's rules*:
 * a salary and a dead-money figure nobody agreed to, rendered next to a real player. All six IDP
 * cap tables hold zero rows in production, so the fallback fired for every player every time.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

import { IDPPlayerModal } from '@/app/idp/components/IDPPlayerModal'
import type { IdpSalaryRecordJson } from '@/app/idp/hooks/useIdpTeamCap'

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock('@/hooks/useAfSubGate', () => ({
  useAfSubGate: () => ({ handleApiResponse: async () => true }),
}))
vi.mock('@/app/components/PlayerImage', () => ({ PlayerImage: () => null }))

// The card fetch is a separate concern; keep it out of these assertions.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => ({ ok: false, json: async () => null })) as never,
)

const CONTRACT: IdpSalaryRecordJson = {
  id: 'c1',
  leagueId: 'lg',
  rosterId: 'r1',
  playerId: '12556',
  playerName: 'Real Defender',
  position: 'LB',
  isDefensive: true,
  salary: 18.5,
  contractYears: 3,
  yearsRemaining: 2,
  contractStartYear: 2025,
  status: 'active',
  acquisitionMethod: 'draft',
  isFranchiseTagged: false,
  cutPenaltyCurrent: 9.25,
}

function renderModal(contract: IdpSalaryRecordJson | null) {
  return render(
    <IDPPlayerModal
      open
      onOpenChange={() => {}}
      leagueId="lg"
      rosterId="r1"
      playerId="12556"
      name="Real Defender"
      position="LB"
      team="BUF"
      sport="NFL"
      week={5}
      players={{}}
      contract={contract}
    />,
  )
}

describe('IDPPlayerModal contract panel', () => {
  it('states the absence instead of a salary when there is no contract row', () => {
    renderModal(null)
    expect(screen.getByTestId('idp-contract-absent')).toBeTruthy()
    // The fabricated panel always printed a "$<n>M / year" line. Nothing may print one now.
    expect(screen.queryByText(/\/ year/)).toBeNull()
    expect(screen.queryByText(/Cut penalty/)).toBeNull()
    expect(screen.queryByText(/Years remaining/)).toBeNull()
  })

  it('never renders the cap actions without a contract', () => {
    renderModal(null)
    expect(screen.queryByTestId('idp-contract-cut')).toBeNull()
    expect(screen.queryByTestId('idp-contract-extend')).toBeNull()
    expect(screen.queryByTestId('idp-contract-tag')).toBeNull()
  })

  it('renders the real figures when a contract row exists', () => {
    renderModal(CONTRACT)
    expect(screen.queryByTestId('idp-contract-absent')).toBeNull()
    expect(screen.getByText('$18.5M')).toBeTruthy()
    // 2 years remaining from a 2025 start expires in 2026, and dead money is the stored value.
    expect(screen.getByText(/2026/)).toBeTruthy()
    expect(screen.getByText('$9.3M')).toBeTruthy()
    expect(screen.getByTestId('idp-contract-cut')).toBeTruthy()
  })
})
