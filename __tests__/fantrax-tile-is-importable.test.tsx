/**
 * "Fantrax still says coming soon, it should be live."
 *
 * The flag alone was never the question — an `available: true` tile that renders
 * no usable field is worse than an honest "soon", because the dead end is only
 * discovered after the click. These assertions are about what a real user sees
 * and can do on the screen, not about the config value.
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

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

import ImportV4 from '@/components/core-app/screens/ImportV4'

/** What the discover route returns for Fantrax: the league's TEAMS. */
const CREAM_BOWL_TEAMS = [
  'Scorescotty',
  'Yourdyinggrandpa',
  'Ciege82',
  'loganhall',
].map((name) => ({
  sourceId: `fantrax-league:v2kzedypmm8jp61b|${name}`,
  name,
  season: '2026',
  totalTeams: 4,
}))

beforeEach(() => {
  discoverProviderLeagues.mockReset()
  fetchImportPreview.mockReset()
  submitImportCreation.mockReset()
  discoverProviderLeagues.mockResolvedValue({ ok: false, error: 'needs an identifier' })
})

function fantraxTile(): HTMLElement {
  const tile = screen
    .getAllByRole('button')
    .find((b) => b.textContent?.includes('Fantrax'))
  if (!tile) throw new Error('no Fantrax tile rendered')
  return tile
}

describe('the Fantrax tile', () => {
  it('is selectable, with no "soon" badge and no blocked reason', () => {
    render(<ImportV4 />)
    const tile = fantraxTile()

    expect(tile).not.toBeDisabled()
    expect(tile.getAttribute('data-available')).toBe('true')
    expect(tile.textContent).not.toMatch(/soon/i)
    /* The sentence that sent people away. */
    expect(tile.textContent).not.toMatch(/not switched on yet/i)
  })

  /**
   * ⚠ THE DEAD END THIS GUARDS. Selecting Fantrax used to render no field at
   * all, so the tile could be enabled and the flow still impossible to finish.
   */
  it('renders a league-ID field when selected, not a snapshot-id field', async () => {
    render(<ImportV4 />)
    fireEvent.click(fantraxTile())

    const label = await screen.findByText(/Fantrax league ID/i)
    expect(label).toBeTruthy()

    const input = document.querySelector('input[placeholder*="fantrax.com"], input[placeholder*="v2kzedypmm8jp61b"]')
    expect(input).toBeTruthy()
    expect(screen.queryByText(/snapshot id/i)).toBeNull()
  })

  /**
   * ⚠ THE TILE MUST NOT PROMISE AUTOMATIC DISCOVERY. Every provider with
   * discovery got "Finds your leagues automatically", and turning Fantrax on
   * inherited that line — but Fantrax cannot enumerate an account without the
   * Secret ID. It takes a league id and lists that league's teams.
   */
  it('says what it actually needs, not "finds your leagues automatically"', () => {
    render(<ImportV4 />)
    const tile = fantraxTile()
    expect(tile.textContent).not.toMatch(/finds your leagues automatically/i)
    expect(tile.textContent).toMatch(/League ID/i)
  })

  /**
   * ⚠ THE CSV DOOR WAS CONDITIONED ON FANTRAX BEING UNAVAILABLE, so making
   * Fantrax work deleted the only pointer to the uploader. An export still
   * carries seasons the live API does not expose.
   */
  it('still offers the CSV uploader once Fantrax is chosen', async () => {
    render(<ImportV4 />)
    /*
     * ⚠ MATCHED ON THE ELEMENT, NOT ON THE TEXT. The first version asserted the
     * phrase was gone, and the UPLOADER ITSELF says "Have a Fantrax CSV export"
     * in its own <summary> — so once it rendered there were two matches and
     * queryByText threw. It passed locally and failed in CI, which is the worst
     * shape a test can have.
     *
     * ⚠ AND THE CLASS IS NOT ENOUGH EITHER: the uploader's own <summary> also
     * carries `af-im-fx-link`. What identifies the POINTER is where it points.
     */
    expect(document.querySelector('a[href="/import?provider=fantrax"]')).toBeTruthy()
    fireEvent.click(fantraxTile())
    await waitFor(() => expect(screen.queryByText(/Fantrax league ID/i)).toBeTruthy())
    /* The pointer gives way to the uploader itself, rather than to nothing. */
    expect(document.querySelector('a[href="/import?provider=fantrax"]')).toBeNull()
    expect(document.querySelector('input[type="file"]')).toBeTruthy()
  })

  /**
   * ⚠ AND IT MUST NOT ASK FOR THE SECRET ID. That is a credential; the whole
   * reason discovery is shaped around a public league id is to avoid it.
   */
  it('promises never to ask for the Secret ID', async () => {
    render(<ImportV4 />)
    fireEvent.click(fantraxTile())
    const help = await screen.findByText(/Never your Fantrax password or Secret ID/i)
    expect(help).toBeTruthy()
  })
})

describe('picking a team, which is what Fantrax discovery returns', () => {
  async function discoverTeams() {
    render(<ImportV4 />)
    fireEvent.click(fantraxTile())
    await waitFor(() => expect(screen.queryByText(/Fantrax league ID/i)).toBeTruthy())

    discoverProviderLeagues.mockResolvedValue({
      ok: true,
      data: { leagues: CREAM_BOWL_TEAMS, accountLabel: 'Cream Bowl' },
    })

    const input = document.querySelector('.af-im-field input') as HTMLInputElement
    expect(input).toBeTruthy()
    fireEvent.change(input, { target: { value: 'v2kzedypmm8jp61b' } })
    /*
     * ⚠ MATCH THE SUBMIT BUTTON EXACTLY. A loose /find/i matcher hit the SLEEPER
     * TILE, whose subtitle reads "Finds your leagues automatically" — which
     * silently switched provider back to Sleeper and made every assertion below
     * describe the wrong screen.
     */
    fireEvent.click(screen.getByRole('button', { name: /^Find my leagues$/i }))
    await waitFor(() => expect(screen.getByText('Ciege82')).toBeTruthy())
    /* Still on Fantrax — see above. */
    expect(screen.queryByText(/Fantrax league ID/i)).toBeTruthy()
  }

  it('asks which team is yours, rather than calling them leagues', async () => {
    await discoverTeams()
    expect(screen.getByText(/Which team is yours in Cream Bowl\?/i)).toBeTruthy()
    expect(screen.queryByText(/Leagues we found/i)).toBeNull()
  })

  /**
   * ⚠ TICKING TWO TEAMS WOULD IMPORT THE SAME LEAGUE TWICE, the second time
   * attributed to someone else's roster. The rows are mutually exclusive, so the
   * multi-select affordances must not render at all.
   */
  it('offers no tick boxes and no import-all button', async () => {
    await discoverTeams()
    /* Scoped to the picker: the CSV uploader below has its own checkbox, and
       that one is not a multi-select affordance. */
    expect(
      document.querySelectorAll('.af-im-league-list input[type="checkbox"]').length,
    ).toBe(0)
    expect(screen.queryByText(/Import \d+ leagues?/i)).toBeNull()
  })

  it('labels the action as claiming a team, not importing a league', async () => {
    await discoverTeams()
    const buttons = screen.getAllByRole('button').map((b) => b.textContent ?? '')
    expect(buttons.some((t) => /This is my team/i.test(t))).toBe(true)
  })
})
