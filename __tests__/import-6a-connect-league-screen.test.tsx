/**
 * Handoff 6a — "Connect your league" — as build rules rather than as pixels.
 *
 * The screen was restyled to the 6a frame (pill row, one-row field, `?`
 * explainers, brand-coloured marks). None of that is asserted here: a snapshot of
 * class names would fail on the next legitimate restyle and would still not tell
 * anyone whether the screen WORKS. What is asserted is the six numbered build
 * rules from the handoff, each of which is a promise to a person standing in
 * front of the funnel.
 *
 * ⚠ RULE 3 IS THE ONE THAT CANNOT BE TESTED AGAINST THE REAL CONFIG. Every
 * provider in provider-ui-config is `available: true` today, so the disabled
 * pill, its "Coming soon" tag and the fallback strip render for nobody — and
 * code that renders for nobody is exactly the code that rots unnoticed and comes
 * back broken the day a provider is switched off. The config is mocked for that
 * block, which is the only way to exercise it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

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
import { IMPORT_PROVIDER_UI_OPTIONS } from '@/lib/league-import/provider-ui-config'

/*
 * ⚠ THE ESPN PANEL FETCHES ITS OWN STATUS ON MOUNT, and without a stub that promise
 * rejects — leaving the panel stuck on its "Checking your ESPN connection…" spinner
 * with no fields rendered. The first version of the ESPN assertion below failed for
 * exactly that reason and would have been easy to misread as the panel being broken.
 * An empty `auths` array is the honest default: not connected.
 */
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ auths: [] }) })) as unknown as typeof fetch,
  )
  discoverProviderLeagues.mockReset()
  fetchImportPreview.mockReset()
  submitImportCreation.mockReset()
  /* Silent: the screen runs a discovery on select for providers that support it,
     and a failure there is deliberately not surfaced (nobody asked a question). */
  discoverProviderLeagues.mockResolvedValue({ ok: false, error: 'needs an identifier' })
})

function pill(name: RegExp): HTMLElement {
  const found = screen
    .getAllByRole('button')
    .find((b) => name.test(b.textContent ?? ''))
  if (!found) throw new Error(`no pill matching ${name}`)
  return found
}

describe('6a rule 1 — the field follows the platform, and is never generic', () => {
  /**
   * ⚠ THE PLACEHOLDER MATTERS AS MUCH AS THE LABEL. A label reading "ESPN league
   * ID" over a box still showing `your-sleeper-username` is worse than no swap at
   * all: it tells you the right thing and shows you the wrong one.
   */
  const CASES: ReadonlyArray<[RegExp, RegExp, RegExp]> = [
    [/^S\s*Sleeper/, /Sleeper username/i, /sleeper-username/i],
    [/ESPN/, /ESPN league ID/i, /^123456$/],
    [/MFL/, /MFL league ID/i, /paste the league URL/i],
    [/Fantrax/, /Fantrax league ID/i, /fantrax\.com|v2kzedypmm8jp61b/i],
    [/Fleaflicker/, /Fleaflicker league ID/i, /206154/],
  ]

  it.each(CASES)('%s asks for its own identifier', async (pillName, label, placeholder) => {
    render(<ImportV4 />)
    fireEvent.click(pill(pillName))

    /*
     * Read the label ELEMENT rather than searching for its text: the `?`
     * explainer nested inside it puts the same words on three ancestors, and an
     * unanchored `findByText` matches all of them.
     *
     * ⚠ AND IT IS FOUND FROM THE INPUT, NOT BY POSITION. Fantrax renders a
     * SECOND `.af-im-field` above this one (the optional Secret ID), so the first
     * one in the document is not the identifier field on that provider — picking
     * by position asserted the wrong label and passed on five providers out of
     * six.
     */
    await waitFor(() => expect(document.querySelector('.af-im-field-row input')).toBeTruthy())
    const input = document.querySelector<HTMLInputElement>('.af-im-field-row input')!
    const labelEl = input.closest('.af-im-field')!.querySelector('.af-label')
    await waitFor(() => expect(labelEl?.textContent ?? '').toMatch(label))
    await waitFor(() => expect(input.placeholder).toMatch(placeholder))
    /* Never a generic "account" box. */
    expect(screen.queryByText(/^account$/i)).toBeNull()
  })

  /**
   * Yahoo is the exception the rule has to survive: it takes no identifier at
   * all, so it must NOT render a username box that would sit there doing nothing.
   */
  /*
   * ⚠ GATED ON CONFIG, NOT ON THE ASSUMPTION THAT YAHOO IS LIVE. Yahoo was
   * switched off after this suite was written (import_runs provider='yahoo' = 0,
   * ever), and a disabled pill ignores the click — so the assertion failed as if
   * the screen had regressed when the product had simply changed underneath it.
   */
  it('Yahoo asks for no identifier and says so, while it is live', async () => {
    const yahooLive = IMPORT_PROVIDER_UI_OPTIONS.some(
      (o) => o.provider === 'yahoo' && o.available,
    )
    render(<ImportV4 />)
    fireEvent.click(pill(/Yahoo/))
    if (!yahooLive) {
      /* Off: the pill must still be visible and must refuse the click. */
      expect(pill(/Yahoo/)).toBeDisabled()
      return
    }
    expect(await screen.findByText(/Yahoo account/i)).toBeTruthy()
    expect(screen.getByText(/there is no username to enter/i)).toBeTruthy()
  })
})

describe('6a rule 2 — the read / never-do split is on THIS screen', () => {
  it('states both halves before anything is typed', () => {
    render(<ImportV4 />)
    expect(screen.getByText(/What we read/i)).toBeTruthy()
    expect(screen.getByText(/Teams · rosters · matchups · scoring settings · past seasons/i)).toBeTruthy()
    expect(screen.getByText(/What we never do/i)).toBeTruthy()
    expect(
      screen.getByText(/Set lineups · make trades · post in chat · ask for your platform password/i),
    ).toBeTruthy()
  })
})

describe('6a rule 4 — the READ-ONLY chip and its explainer ride every step', () => {
  it('shows the chip with a real `?` affordance, not a hover-only title', () => {
    render(<ImportV4 />)
    expect(screen.getByText(/^Read-only$/i)).toBeTruthy()

    /*
     * ⚠ A `title` ATTRIBUTE IS NOT AN AFFORDANCE — it is invisible, never fires
     * on touch, and is what this chip used to carry. The explanation has to be
     * reachable by pressing something.
     */
    const opener = screen.getByRole('button', { name: /what read-only means/i })
    fireEvent.click(opener)
    expect(screen.getByRole('tooltip')).toBeTruthy()
    expect(screen.getByText(/never changes anything on Sleeper, ESPN or Yahoo/i)).toBeTruthy()
  })

  /**
   * ⚠ CLICKING IT USED TO CLOSE IT. Hover and click both drove one boolean, so a
   * mouse user — already hovering by the time they pressed — could only ever
   * toggle it shut. Both intents are tracked separately now; this is the
   * regression test for that.
   */
  it('stays open when a hovering pointer clicks it', () => {
    render(<ImportV4 />)
    const opener = screen.getByRole('button', { name: /what read-only means/i })
    fireEvent.mouseEnter(opener)
    fireEvent.click(opener)
    expect(screen.getByRole('tooltip')).toBeVisible()
  })
})

describe('6a rule 5 — import is never a forced gate', () => {
  it('keeps "Skip for now" reachable, and it lands on /core', () => {
    render(<ImportV4 />)
    const skip = screen.getByText(/Skip for now/i).closest('a')
    expect(skip).toBeTruthy()
    /*
     * ⚠ /core, NOT /dashboard. This flow belongs to the core app; sending someone
     * who declined to import to the surface /core replaces is how the escape
     * hatch reads as a wrong turn.
     */
    expect(skip?.getAttribute('href')).toBe('/core')
  })
})

describe('6a rule 6 — no platform password is ever asked for', () => {
  /**
   * ⚠ THIS ASSERTED `input[type="password"]` AND THAT WAS THE WRONG GUARD. Two
   * providers legitimately collect a masked credential that is NOT an account
   * password — Fantrax's read-only Secret ID, and ESPN's `SWID`/`espn_s2` browser
   * cookies (6b) — and both are masked precisely BECAUSE they are secrets. The old
   * assertion would have been satisfied by rendering an ESPN password box in plain
   * text, and broken by doing the right thing with a cookie field.
   *
   * The rule 6 actually states is about the ACCOUNT password: "No password field
   * for any platform … ESPN's private-league case is one-click via extension, not
   * a login form." So the assertion is on what the screen ASKS FOR.
   */
  const PASSWORD_PROMPT = /(your\s+)?(ESPN|Sleeper|Yahoo|MFL|Fantrax|Fleaflicker|platform|account)\s+password/i

  it.each([[/^S\s*Sleeper/], [/ESPN/], [/Yahoo/], [/MFL/], [/Fleaflicker/], [/Fantrax/]])(
    'never asks for an account password on %s',
    async (pillName) => {
      render(<ImportV4 />)
      fireEvent.click(pill(pillName))
      await waitFor(() => expect(document.querySelector('.af-im-field')).toBeTruthy())

      /* Every field's own label and placeholder — the only things that ask. */
      const asks = [...document.querySelectorAll<HTMLInputElement>('.af-im-field input, .af-espn-field input')]
        .flatMap((input) => [
          input.placeholder,
          input.closest('label')?.querySelector('.af-label')?.textContent ?? '',
        ])
        .join(' | ')
      expect(asks).not.toMatch(PASSWORD_PROMPT)
    },
  )

  /*
   * The two masked-but-not-a-password cases, pinned individually so that the
   * broadened rule above cannot be read as permission to add a real login form.
   */
  it('Fantrax offers the Secret ID as an option, and a league ID instead of it', async () => {
    render(<ImportV4 />)
    fireEvent.click(pill(/Fantrax/))
    await waitFor(() => expect(screen.queryByText(/Fantrax league ID/i)).toBeTruthy())
    expect(screen.getByText(/Never your Fantrax password or Secret ID/i)).toBeTruthy()
  })

  it('ESPN asks for cookies and promises never to ask for the password', async () => {
    render(<ImportV4 />)
    fireEvent.click(pill(/ESPN/))
    await waitFor(() => expect(document.querySelector('.af-im-espn')).toBeTruthy())
    expect(document.getElementById('espn-swid-input')).toBeTruthy()
    expect(document.getElementById('espn-s2-input')).toBeTruthy()
    expect(screen.getByText(/we never ask for your ESPN password/i)).toBeTruthy()
  })
})

/**
 * 6b — ESPN connects on THIS screen.
 *
 * ⚠ THE REGRESSION THIS EXISTS FOR is a link, not a layout: "Connect ESPN in
 * Settings →" navigated away mid-import, so the user arrived at Settings with no
 * league id in hand and had to find their way back and start over.
 */
describe('6b — ESPN connect is in the import flow, not a trip to Settings', () => {
  it('renders the connect panel inline as soon as ESPN is chosen', async () => {
    render(<ImportV4 />)
    fireEvent.click(pill(/ESPN/))
    await waitFor(() => expect(document.querySelector('.af-im-espn')).toBeTruthy())
    /* And it leads — before the league-ID field, not after a failed import. */
    const block = document.querySelector('.af-im-espn')!
    const field = document.querySelector('.af-im-field-row')!
    expect(block.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('never sends the user to /settings to connect ESPN', async () => {
    render(<ImportV4 />)
    fireEvent.click(pill(/ESPN/))
    await waitFor(() => expect(document.querySelector('.af-im-espn')).toBeTruthy())
    expect(document.querySelector('a[href="/settings"]')).toBeNull()
    expect(screen.queryByText(/Connect ESPN in Settings/i)).toBeNull()
  })

  /*
   * ⚠ AND IT MUST NOT SEND THEM TO /leagues EITHER — League Sync carries no ESPN
   * control at all, which is what the link pointed at before Settings did.
   */
  it('does not point ESPN at League Sync', async () => {
    render(<ImportV4 />)
    fireEvent.click(pill(/ESPN/))
    await waitFor(() => expect(document.querySelector('.af-im-espn')).toBeTruthy())
    expect(screen.queryByText(/Connect your accounts in League Sync/i)).toBeNull()
  })
})

/**
 * ⚠ THE DORMANT PATH. Every provider is live today, so nothing below renders
 * against the real config — which is exactly why it is worth pinning.
 */
describe('6a rule 3 — an unreleased provider is visible, disabled and explained', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@/lib/league-import/provider-ui-config', () => ({
      IMPORT_PROVIDER_UI_OPTIONS: [
        { provider: 'sleeper', label: 'Sleeper', available: true, supportsDiscovery: true, supportedSports: ['NFL'] },
        { provider: 'fleaflicker', label: 'Fleaflicker', available: false, supportedSports: ['NFL'] },
      ],
      getImportProviderLabel: (p: string) => (p === 'sleeper' ? 'Sleeper' : 'Fleaflicker'),
      isImportProviderAvailable: (p: string) => p === 'sleeper',
      supportsImportProviderDiscovery: (p: string) => p === 'sleeper',
      getImportProviderSupportedSports: () => ['NFL'],
    }))
  })

  it('renders it, refuses the click, tags it and explains the block', async () => {
    const { ImportV4: Scoped } = await import('@/components/core-app/screens/ImportV4')
    render(<Scoped />)

    const blocked = screen
      .getAllByRole('button')
      .find((b) => /Fleaflicker/.test(b.textContent ?? ''))!

    /* Visible — never hidden. */
    expect(blocked).toBeTruthy()
    /* Not clickable. */
    expect(blocked).toBeDisabled()
    expect(blocked.getAttribute('data-available')).toBe('false')
    /* Tagged on the pill itself. */
    expect(within(blocked).getByText(/Coming soon/i)).toBeTruthy()

    /* And the fallback strip carries the reason, rather than leaving a dead pill
       with no explanation beside it. */
    fireEvent.click(blocked)
    expect(blocked.getAttribute('data-active')).not.toBe('true')
  })

  it('shows the fallback strip when the blocked provider is the selected one', async () => {
    const { ImportV4: Scoped } = await import('@/components/core-app/screens/ImportV4')
    render(<Scoped defaultProvider="fleaflicker" />)

    expect(screen.getByText(/Fleaflicker selected\?/i)).toBeTruthy()
    expect(screen.getByText(/isn't available yet — coming soon\./i)).toBeTruthy()
    /* No field to type into for a provider that cannot be used. */
    expect(document.querySelector('.af-im-field-row input')).toBeNull()
  })
})
