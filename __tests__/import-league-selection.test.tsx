/**
 * Handoff 4d — the league picker's count must describe what is TICKED.
 *
 * Build rule 3 says the button label reflects the live checked count. That
 * sounds cosmetic and is not: this is the last screen of the signup funnel, and
 * a button reading "Import 4 leagues" beside three ticked boxes is a promise the
 * next screen breaks. The static design preview (`?state=result`) renders no
 * leagues on purpose, so this behaviour cannot be exercised by loading the page —
 * it needs discovery mocked, which is what this file does.
 *
 * Mocks the client service rather than the network so the assertions are about
 * ImportV4's own selection logic, not about fetch plumbing.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const discoverProviderLeagues = vi.fn()
const submitImportCreation = vi.fn()
const fetchImportPreview = vi.fn()

vi.mock('@/lib/league-import/LeagueCreationImportSubmissionService', () => ({
  discoverProviderLeagues: (...a: unknown[]) => discoverProviderLeagues(...a),
  submitImportCreation: (...a: unknown[]) => submitImportCreation(...a),
  fetchImportPreview: (...a: unknown[]) => fetchImportPreview(...a),
}))

// next/link renders an <a> in jsdom without a router.
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

import ImportV4 from '@/components/core-app/screens/ImportV4'

const FOUR_LEAGUES = [
  { sourceId: 'l1', name: 'Dynasty Dragons', season: '2026', totalTeams: 12 },
  { sourceId: 'l2', name: 'Sunday Scaries', season: '2026', totalTeams: 10 },
  { sourceId: 'l3', name: 'The Bench Mob', season: '2026', totalTeams: 12 },
  { sourceId: 'l4', name: 'Retired 2023 keeper', season: '2023', totalTeams: 12 },
]

/**
 * ⚠ NO CLICK NEEDED — ImportV4 DISCOVERS ON MOUNT. For a provider that supports
 * discovery (Sleeper does, and is the default), an effect calls
 * discoverProviderLeagues with an empty identifier so a linked account lists its
 * leagues without the user pressing a button they need nothing from. Driving
 * this test through "Find my leagues" would have been testing a path real users
 * with a linked account never take.
 *
 * ⚠ THE PAYLOAD IS `res.data.leagues`, NOT `res.leagues`. Getting that wrong
 * yields an empty list and assertions that fail for a reason unrelated to what
 * they are testing.
 */
async function renderWithLeagues() {
  discoverProviderLeagues.mockResolvedValue({
    ok: true,
    data: { leagues: FOUR_LEAGUES, accountLabel: '@guap' },
  })
  render(<ImportV4 />)
  await waitFor(() => expect(screen.getByText('Dynasty Dragons')).toBeInTheDocument())
}

describe('handoff 4d — choosing which discovered leagues to import', () => {
  beforeEach(() => {
    discoverProviderLeagues.mockReset()
    submitImportCreation.mockReset()
    fetchImportPreview.mockReset()
  })

  it('starts with every discovered league ticked', async () => {
    await renderWithLeagues()
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes).toHaveLength(4)
    expect(boxes.every((b) => b.checked)).toBe(true)
  })

  /**
   * The departure from build rule 1 is deliberate and is asserted here so it
   * cannot be undone by accident: discovery carries no archived/status field, so
   * an archived league is indistinguishable from a current one. Defaulting it
   * unchecked would silently drop a league the user wanted.
   */
  it('does not guess that an older season is archived', async () => {
    await renderWithLeagues()
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    // "Retired 2023 keeper" is last, and is still ticked.
    expect(boxes[3].checked).toBe(true)
  })

  it('counts what is ticked, not what was found', async () => {
    await renderWithLeagues()
    expect(screen.getByRole('button', { name: /Import 4 leagues/i })).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('checkbox')[3])
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Import 3 leagues/i })).toBeInTheDocument()
    )

    fireEvent.click(screen.getAllByRole('checkbox')[2])
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Import 2 leagues/i })).toBeInTheDocument()
    )
  })

  it('says "league" not "leagues" when one is ticked', async () => {
    await renderWithLeagues()
    const boxes = screen.getAllByRole('checkbox')
    fireEvent.click(boxes[1])
    fireEvent.click(boxes[2])
    fireEvent.click(boxes[3])
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Import 1 league$/i })).toBeInTheDocument()
    )
  })

  it('refuses to run with nothing ticked, and says so', async () => {
    await renderWithLeagues()
    screen.getAllByRole('checkbox').forEach((b) => fireEvent.click(b))
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /Pick at least one league/i })
      expect(btn).toBeDisabled()
    })
    expect(submitImportCreation).not.toHaveBeenCalled()
  })

  /** The whole point of the selection: unticked leagues are never submitted. */
  it('only submits the ticked leagues', async () => {
    await renderWithLeagues()
    submitImportCreation.mockResolvedValue({ ok: true })

    fireEvent.click(screen.getAllByRole('checkbox')[3]) // untick the last one
    fireEvent.click(screen.getByRole('button', { name: /Import 3 leagues/i }))

    await waitFor(() => expect(submitImportCreation).toHaveBeenCalledTimes(3))
    const submitted = submitImportCreation.mock.calls.map((c) => c[1])
    expect(submitted).toEqual(['l1', 'l2', 'l3'])
    expect(submitted).not.toContain('l4')
  })
})
