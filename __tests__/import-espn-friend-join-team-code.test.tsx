/**
 * A leaguemate on a phone, following their commissioner's invite link into a PUBLIC ESPN league the
 * commissioner already imported.
 *
 * The no-cookie "pick your team" import refuses that league on purpose (`LEAGUE_RUN_BY_COMMISSIONER`):
 * a picked team proves nothing, and the league is run by a person. That refusal used to be the end —
 * "ask them for the league's invite link", which is the link they had just used. Now it re-opens the
 * preview with the team-code panel, and once the code is on their team the ordinary (proven) import
 * joins them to their own team in the commissioner's copy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))

const discoverProviderLeagues = vi.fn()
const submitImportCreation = vi.fn()
const fetchImportPreview = vi.fn()

vi.mock('@/lib/league-import/LeagueCreationImportSubmissionService', () => ({
  discoverProviderLeagues: (...a: unknown[]) => discoverProviderLeagues(...a),
  submitImportCreation: (...a: unknown[]) => submitImportCreation(...a),
  fetchImportPreview: (...a: unknown[]) => fetchImportPreview(...a),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

import ImportV4 from '@/components/core-app/screens/ImportV4'

const MANAGERS = [
  { rosterId: '1', teamName: 'Commish Crushers', displayName: 'Tribal', isCommissionerTeam: true },
  { rosterId: '4', teamName: 'Friend FC', displayName: 'Pat' },
]
const UNPROVEN = {
  ok: true,
  data: {
    league: { name: 'Beef League' },
    importable: false,
    importBlockedReason: 'We could read this league, but not prove you have a team in it.',
    managers: MANAGERS,
  },
}
const PROVEN = { ok: true, data: { league: { name: 'Beef League' }, managers: MANAGERS } }
const RUN_BY_COMMISSIONER = {
  ok: false,
  status: 409,
  code: 'LEAGUE_RUN_BY_COMMISSIONER',
  error:
    "This league is already on AllFantasy, set up by its commissioner. Ask them for the league's invite link — or connect ESPN and import again to join with your team.",
}

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** The team-code endpoint (code, then "found"), and an empty answer for everything else on the page. */
function stubFetch() {
  const teamCodeBodies: Array<Record<string, unknown>> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/import-espn')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        teamCodeBodies.push(body)
        return body.check
          ? reply({ ok: true, code: 'K9X2', found: true, teamName: 'Friend FC' })
          : reply({ ok: true, code: 'K9X2', leagueId: '777' })
      }
      return reply({ auths: [] })
    }),
  )
  return teamCodeBodies
}

async function pickMemberTeamAndImport() {
  render(<ImportV4 defaultProvider="espn" initialLeagueSourceId="777" />)
  fireEvent.click(await screen.findByTestId('import-espn-run-by-member'))
  fireEvent.click(await screen.findByTestId('import-preview-team-4'))
  fireEvent.click(screen.getByTestId('import-commit'))
}

beforeEach(() => {
  discoverProviderLeagues.mockReset().mockResolvedValue({ ok: false, error: 'needs an identifier' })
  fetchImportPreview.mockReset()
  submitImportCreation.mockReset()
})

describe('ESPN leaguemate joining a league their commissioner already imported', () => {
  it('turns the refusal into the team-code panel, then joins with an ordinary proven import', async () => {
    const teamCodeBodies = stubFetch()
    fetchImportPreview
      .mockResolvedValueOnce(UNPROVEN) // first look
      .mockResolvedValueOnce(UNPROVEN) // re-opened after the refusal
      .mockResolvedValueOnce(PROVEN) // after the code is found on their team
    submitImportCreation
      .mockResolvedValueOnce(RUN_BY_COMMISSIONER)
      .mockResolvedValueOnce({ ok: true, data: { leagueId: 'L-commish', name: 'Beef League', joinedExisting: true } })

    await pickMemberTeamAndImport()

    // Join mode: the panel, no "who's the commissioner?" question, no dead-end error.
    const join = await screen.findByTestId('import-espn-join-proof')
    expect(join.textContent).toMatch(/already set this league up on AllFantasy/)
    expect(await screen.findByText('K9X2')).toBeTruthy()
    expect(screen.queryByTestId('import-espn-run-by')).toBeNull()
    expect(screen.queryByText(/Ask them for the league's invite link/)).toBeNull()
    const commitBtn = screen.getByTestId('import-commit') as HTMLButtonElement
    expect(commitBtn.disabled).toBe(true)
    expect(commitBtn.textContent).toBe('Confirm your team first')
    expect(teamCodeBodies[0]).toEqual({ mode: 'team_code', leagueId: '777' })

    // Code found → the preview re-runs and the gate now sees proof.
    fireEvent.click(screen.getByTestId('espn-team-code-check'))
    await screen.findByText('Ready to import')
    expect(fetchImportPreview).toHaveBeenCalledTimes(3)
    expect(screen.queryByTestId('import-espn-join-proof')).toBeNull()

    // The second commit is the PROVEN path: no "member" answer, no picked team for the server to trust.
    fireEvent.click(screen.getByTestId('import-commit'))
    await waitFor(() => expect(submitImportCreation).toHaveBeenCalledTimes(2))
    const extras = submitImportCreation.mock.calls[1][4] as Record<string, unknown> | undefined
    expect(extras?.espnLeagueRunBy).toBeUndefined()
    expect(extras?.claimSourceTeamId).toBeUndefined()
    // …while the first one was the no-cookie member attempt.
    expect(submitImportCreation.mock.calls[0][4]).toMatchObject({ espnLeagueRunBy: 'member', claimSourceTeamId: '4' })
  })

  it('control: any other refusal is still shown as an error, with no join panel', async () => {
    stubFetch()
    fetchImportPreview.mockResolvedValue(UNPROVEN)
    submitImportCreation.mockResolvedValueOnce({
      ok: false,
      status: 409,
      code: 'TEAM_ALREADY_CLAIMED',
      error: 'Someone on AllFantasy already claimed that team.',
    })

    await pickMemberTeamAndImport()

    expect(await screen.findByText(/already claimed that team/)).toBeTruthy()
    expect(screen.queryByTestId('import-espn-join-proof')).toBeNull()
    expect(fetchImportPreview).toHaveBeenCalledTimes(1)
  })
})
