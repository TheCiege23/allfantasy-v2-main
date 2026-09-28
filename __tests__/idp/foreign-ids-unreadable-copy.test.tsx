import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * What the IDP pages SAY about a Fleaflicker / MFL / Fantrax / Yahoo league.
 *
 * Since #1464 such a league's roster ids are stripped rather than read as Sleeper ids, so these
 * pages see an empty roster — and each used to describe that emptiness with words that are false
 * for it: "You don't roster any defensive players yet", "No rosters in this league carry a defender
 * yet", "No matchup on file for this league yet". The loaders now report `ids_unreadable`, and each
 * page maps it to the one shared sentence. Each control pins the old words where they are TRUE.
 */

vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'u-1' } } }) }))
vi.mock('@/hooks/useAfSubGate', () => ({
  useAfSubGate: () => ({ handleApiResponse: async () => true }),
}))

import { DefenseHubClient } from '@/app/idp/defense-hub/[leagueId]/DefenseHubClient'
import { TradeBoardSection } from '@/app/idp/defense-hub/[leagueId]/TradeBoardSection'
import { IDPMatchupView } from '@/app/idp/components/IDPMatchupView'
import { FOREIGN_IDS_UNREADABLE } from '@/lib/core-app/foreignIdSpaceCopy'

const serve = (payload: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => payload })),
  )

const HUB = (state: string) => ({
  state,
  projectedFor: null,
  coverage: { defenders: 0, projected: 0, priced: 0 },
  defenders: [],
  kickers: [],
  kickerValue: null,
  snaps: [],
  roles: [],
  tendencies: [],
  notes: [],
})

const BOARD = (state: string) => ({
  state,
  projectedFor: null,
  rows: [],
  kickerValue: null,
  kickers: [],
  coverage: { defenders: 0, projected: 0, priced: 0 },
  notes: [],
})

afterEach(() => vi.unstubAllGlobals())

describe('Defense Hub', () => {
  it('ids_unreadable reads as the shared sentence, not "you don’t roster any defensive players"', async () => {
    serve(HUB('ids_unreadable'))
    render(<DefenseHubClient leagueId="L1" />)
    expect(await screen.findByText(FOREIGN_IDS_UNREADABLE)).toBeTruthy()
    expect(screen.queryByText(/don’t roster any defensive players/)).toBeNull()
  })

  it('CONTROL: no_defenders keeps its own words', async () => {
    serve(HUB('no_defenders'))
    render(<DefenseHubClient leagueId="L1" />)
    expect(await screen.findByText('You don’t roster any defensive players yet')).toBeTruthy()
    expect(screen.queryByText(FOREIGN_IDS_UNREADABLE)).toBeNull()
  })
})

describe('League trade board', () => {
  it('ids_unreadable reads as the shared sentence, not "no rosters carry a defender"', async () => {
    serve(BOARD('ids_unreadable'))
    render(<TradeBoardSection leagueId="L1" />)
    expect(await screen.findByText(new RegExp(`^${FOREIGN_IDS_UNREADABLE}`))).toBeTruthy()
    expect(screen.queryByText(/carry a defender/)).toBeNull()
  })

  it('CONTROL: no_rostered_defenders keeps its own words', async () => {
    serve(BOARD('no_rostered_defenders'))
    render(<TradeBoardSection leagueId="L1" />)
    expect(await screen.findByText('No rosters in this league carry a defender yet.')).toBeTruthy()
  })
})

describe('IDP matchup', () => {
  const matchup = (state: string) => ({ state, season: null, week: null, you: null, opponent: null, notes: [] })

  it('ids_unreadable reads as the shared sentence, not "no matchup on file"', async () => {
    serve(matchup('ids_unreadable'))
    render(<IDPMatchupView leagueId="L1" />)
    expect(await screen.findByText(new RegExp(`^${FOREIGN_IDS_UNREADABLE}`))).toBeTruthy()
    expect(screen.queryByText(/No matchup on file/)).toBeNull()
  })

  it('CONTROL: no_matchup keeps its own words', async () => {
    serve(matchup('no_matchup'))
    render(<IDPMatchupView leagueId="L1" />)
    expect(await screen.findByText('No matchup on file for this league yet.')).toBeTruthy()
  })
})
