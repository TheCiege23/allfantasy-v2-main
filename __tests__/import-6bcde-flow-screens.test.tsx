/**
 * Handoffs 6b (ESPN connect), 6c (importing), 6d (done) and 6e (connected
 * accounts), as build rules rather than as pixels — same standard as the 6a suite.
 *
 * ⚠ THE RULES WORTH PINNING HERE ARE THE HONESTY ONES. Three of these four screens
 * specify a number or a state the backend does not produce, and the interesting
 * failure mode is not "the layout drifted" — it is someone later filling one of
 * those gaps with a plausible constant. 6c's ring must stay a real fraction, 6d's
 * red "needs you" must never render at zero, and 6e's ACTION NEEDED must stay the
 * only row that shouts.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

import { ImportProgress, type ImportStep } from '@/components/core-app/import/ImportProgress'
import { ChimmyNote } from '@/components/core-app/import/ChimmyNote'
import { ImportDone, type ImportDoneStat } from '@/components/core-app/import/ImportDone'
import { ConnectedPlatforms } from '@/components/core-app/import/ConnectedPlatforms'
import { EspnConnectPanel } from '@/components/core-app/import/EspnConnectPanel'
import { IMPORT_PROVIDER_UI_OPTIONS } from '@/lib/league-import/provider-ui-config'

/*
 * ⚠ NEVER HARDCODE HOW MANY PLATFORMS ARE LIVE. These assertions originally read
 * "2 of 6" and "33%", which broke the day Yahoo was measured (import_runs
 * provider='yahoo' = 0, ever) and switched off. The component derives the
 * denominator from config precisely so it survives that; a test that does not
 * derive it just becomes a second place to edit — and the failure looks like a
 * regression rather than a config change.
 */
const LIVE = IMPORT_PROVIDER_UI_OPTIONS.filter((o) => o.available)
const YAHOO_LIVE = LIVE.some((o) => o.provider === 'yahoo')

function steps(states: Array<ImportStep['state']>): ImportStep[] {
  return states.map((state, i) => ({
    key: `s${i}`,
    title: `Step ${i + 1}`,
    detail: 'detail',
    state,
  }))
}

describe('6c — the ring is a real fraction of real steps', () => {
  /**
   * ⚠ THE CAPTURE SHOWS 62% AND NOTHING IN THIS FLOW CAN PRODUCE 62. The commit
   * endpoint is synchronous and returns no job id, so any percentage that is not a
   * count of completed calls is invented. This repo already shipped and reverted a
   * hardcoded 40%; these cases are what stop it coming back.
   */
  it.each([
    [['queued', 'queued', 'queued'], '0%'],
    [['done', 'working', 'queued'], '33%'],
    [['done', 'done', 'working'], '67%'],
    [['done', 'done', 'done'], '100%'],
  ] as const)('%s reads %s', (states, expected) => {
    render(<ImportProgress providerLabel="Sleeper" steps={steps([...states])} />)
    expect(screen.getByText(expected)).toBeTruthy()
  })

  /**
   * Handoff rule 2: the ring and the checklist must not drift. They cannot here —
   * both read the same `completed` count — and this is the test that says so.
   */
  it('never shows a percentage the checklist does not justify', () => {
    render(<ImportProgress providerLabel="Sleeper" steps={steps(['done', 'queued', 'queued'])} />)
    const done = document.querySelectorAll('.af-prog-step[data-state="done"]').length
    const total = document.querySelectorAll('.af-prog-step').length
    expect(screen.getByText(`${Math.round((done / total) * 100)}%`)).toBeTruthy()
  })

  /** Handoff rule 3: only the running step animates. */
  it('marks exactly one step as working', () => {
    render(<ImportProgress providerLabel="Sleeper" steps={steps(['done', 'working', 'queued'])} />)
    expect(document.querySelectorAll('.af-prog-step[data-state="working"]').length).toBe(1)
  })

  /**
   * ⚠ NO FABRICATED CHIMMY ASIDE. The capture carries one; it is a cross-roster
   * analysis of leagues that have not finished being written, and nothing on this
   * screen can compute it. A hardcoded sentence would be a fake insight on the one
   * screen whose promise is that the numbers are real.
   */
  it('does not render an invented assistant aside', () => {
    render(<ImportProgress providerLabel="Sleeper" steps={steps(['done', 'working', 'queued'])} />)
    expect(screen.queryByText(/Kincaid/i)).toBeNull()
  })
})

describe('6d — stats are real counts, or they are absent', () => {
  const base = {
    providerLabel: 'Sleeper',
    leagueHref: '/core?league=abc',
    onImportAnother: () => {},
  }

  /**
   * ⚠ HANDOFF RULE 1, AND IT IS THE ONE MOST LIKELY TO BE LOST. A red 0 reports a
   * problem that does not exist. At zero the card must turn `--good`.
   */
  it('never paints a zero "needs you" as bad', () => {
    const stats: ImportDoneStat[] = [
      { key: 'leagues', value: 1, label: 'league imported' },
      { key: 'needs', value: 0, label: 'left for you to do', tone: 'good' },
    ]
    render(<ImportDone {...base} stats={stats} />)
    const zero = screen.getByText('0').closest('.af-done-stat')
    expect(zero?.getAttribute('data-tone')).toBe('good')
    expect(zero?.getAttribute('data-tone')).not.toBe('bad')
  })

  it('paints a real outstanding count as bad', () => {
    const stats: ImportDoneStat[] = [
      { key: 'needs', value: 2, label: 'things need you', tone: 'bad' },
    ]
    render(<ImportDone {...base} stats={stats} />)
    expect(screen.getByText('2').closest('.af-done-stat')?.getAttribute('data-tone')).toBe('bad')
  })

  /**
   * ⚠ /core, NOT /dashboard. The handoff's primary button says "Go to my
   * dashboard" and leads to 3a; in this repo /core is the canonical home and
   * /dashboard is the surface it replaces.
   */
  it('sends the finished import to /core', () => {
    render(<ImportDone {...base} stats={[]} />)
    expect(screen.getByText(/Open your league/i).closest('a')?.getAttribute('href')).toBe(
      '/core?league=abc',
    )
  })

  it('falls back to /core when the run wrote nothing to open', () => {
    render(<ImportDone {...base} leagueHref={null} stats={[]} />)
    expect(screen.getByText(/Go to AllFantasy/i).closest('a')?.getAttribute('href')).toBe('/core')
  })

  /** Handoff rule 3: the secondary path stays reachable. */
  it('keeps "add another platform" available beside the primary path', () => {
    render(<ImportDone {...base} stats={[]} />)
    expect(screen.getByRole('button', { name: /Add another platform/i })).toBeTruthy()
  })
})

describe('6e — connected accounts', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          auths: [
            { platform: 'espn', hasEspnCookies: true, updatedAt: '2026-08-01T00:00:00.000Z' },
            /* A Yahoo row with no token: a connect that started and never finished. */
            { platform: 'yahoo', hasOauthToken: false },
          ],
        }),
      })) as unknown as typeof fetch,
    )
  })

  /**
   * ⚠ HANDOFF RULE 1 — ONLY `ACTION NEEDED` GETS A BORDER AND A CTA. If every
   * connected row also shouted, the one row that needs attention would be invisible.
   */
  it('gives the CTA and the coloured row only to ACTION NEEDED', async () => {
    render(<ConnectedPlatforms sleeperUsername="guap" />)
    await waitFor(() => expect(document.querySelectorAll('.af-ca-row').length).toBeGreaterThan(2))

    const yahoo = [...document.querySelectorAll('.af-ca-row')].find((r) =>
      /Yahoo/.test(r.textContent ?? ''),
    )!
    /* Off in config ⇒ the row is coming-soon and carries no CTA, which is rule 1
       working rather than a regression. Only the live case can assert the rest. */
    expect(yahoo.getAttribute('data-status')).toBe(YAHOO_LIVE ? 'action-needed' : 'coming-soon')
    if (!YAHOO_LIVE) {
      expect(yahoo.querySelector('.af-ca-fix')).toBeNull()
      return
    }
    /* Matched on the BUTTON, not the text: the row's method line also says
       "re-authorize to complete it", so a text match finds two nodes. */
    expect(within(yahoo as HTMLElement).getByRole('link', { name: /Re-authorize/i })).toBeTruthy()

    const espn = [...document.querySelectorAll('.af-ca-row')].find((r) =>
      /ESPN/.test(r.textContent ?? ''),
    )!
    expect(espn.getAttribute('data-status')).toBe('connected')
    expect(within(espn as HTMLElement).queryByRole('link', { name: /Re-authorize/i })).toBeNull()
    expect(espn.querySelector('.af-ca-fix')).toBeNull()
  })

  /**
   * Handoff rule 2: every row states its connection METHOD in plain language,
   * because the method is what re-authorizing will look like.
   */
  it('names how each platform is connected, not just that it is', async () => {
    render(<ConnectedPlatforms sleeperUsername="guap" />)
    expect(await screen.findByText(/Connected by username/i)).toBeTruthy()
    expect(screen.getByText(/Connected with your ESPN cookies · stored encrypted/i)).toBeTruthy()
    /* The "started but never finished" wording is the Yahoo action-needed case. */
    if (YAHOO_LIVE) expect(screen.getByText(/never finished/i)).toBeTruthy()
    else expect(screen.getByText(/Not available yet/i)).toBeTruthy()
  })

  /** Handoff rule 5: "Add a platform" re-enters the connect flow, not a settings form. */
  it('sends "Add a platform" into the import flow', async () => {
    render(<ConnectedPlatforms sleeperUsername="guap" />)
    const add = await screen.findByText(/Add a platform/i)
    expect(add.closest('a')?.getAttribute('href')).toBe('/import')
  })

  /**
   * ⚠ AND IT DOES NOT INVENT LEAGUE COUNTS. The capture reads "3 leagues ·
   * connected by username"; nothing on this surface knows that number without a new
   * endpoint, so it is absent rather than guessed.
   */
  it('states no league count it cannot source', async () => {
    render(<ConnectedPlatforms sleeperUsername="guap" />)
    await screen.findByText(/Connected by username/i)
    expect(screen.queryByText(/\d+ leagues? ·/)).toBeNull()
  })
})

describe('6b — the ESPN panel never asks for a password', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ auths: [] }) })) as unknown as typeof fetch,
    )
  })

  /**
   * Handoff rule 1: the three paths are extension one-click, manual cookie paste,
   * or the not-logged-in blocker — never username/password.
   */
  it('offers cookies and an extension, never a login form', async () => {
    render(<EspnConnectPanel />)
    await waitFor(() => expect(document.querySelector('.af-espn-card')).toBeTruthy())
    expect(document.getElementById('espn-swid-input')).toBeTruthy()
    expect(document.getElementById('espn-s2-input')).toBeTruthy()
    expect(screen.queryByText(/ESPN password/i)).toBeNull()
    expect(document.querySelector('input[name="password"]')).toBeNull()
  })

  /**
   * Handoff rule 3: "stored encrypted" appears wherever cookie values are mentioned.
   * This is the trust language for a credential-adjacent flow, not a one-time
   * disclaimer, so more than one mention is the point.
   */
  it('repeats the stored-encrypted promise wherever cookies are named', async () => {
    render(<EspnConnectPanel />)
    await waitFor(() => expect(document.querySelector('.af-espn-card')).toBeTruthy())
    expect(screen.getAllByText(/stored encrypted/i).length).toBeGreaterThan(1)
  })

  /**
   * ⚠ HANDOFF RULE 4 — THE MOBILE FOOTNOTE IS LOAD BEARING. Extensions do not run
   * on most mobile browsers, so ESPN connect is desktop-only in practice and
   * someone on a phone has to be told rather than left to fail.
   */
  it('keeps the mobile footnote while there is still something to connect', async () => {
    render(<EspnConnectPanel />)
    await waitFor(() => expect(document.querySelector('.af-espn-card')).toBeTruthy())
    expect(screen.getByText(/Extensions don.t work on most mobile browsers/i)).toBeTruthy()
  })

  /**
   * ⚠ THE ONLY WORKING PATH IS NOT PUT BEHIND A DISCLOSURE. The extension is
   * unpublished, so the manual form is the sole way in today; the handoff's
   * "Paste cookies manually →" link assumes a world where one click works.
   */
  it('opens the manual form by default while the extension is unavailable', async () => {
    render(<EspnConnectPanel />)
    await waitFor(() => expect(document.querySelector('.af-espn-fallback')).toBeTruthy())
    expect(document.querySelector('.af-espn-fallback')?.getAttribute('data-open')).toBe('true')
    expect(document.querySelector('[data-testid="espn-manual-connect"]')).toBeTruthy()
  })

  /**
   * ⚠ NO DEAD "INSTALL THE EXTENSION" BUTTON. The extension is built but not
   * published, so there is nowhere to send anyone; a primary-styled link to nothing
   * is worse than saying so.
   */
  it('does not offer an install link while there is nowhere to install from', async () => {
    render(<EspnConnectPanel />)
    await waitFor(() => expect(document.querySelector('.af-espn-card')).toBeTruthy())
    expect(screen.queryByText(/^Install the extension/i)).toBeNull()
    expect(screen.getByText(/isn.t published yet/i)).toBeTruthy()
  })
})

describe('the Chimmy aside carries only what the caller derived', () => {
  /**
   * ⚠ THE COMPONENT OWNS NO COPY. The handoff's examples ("you have Kincaid on
   * three of these four teams") are analytical claims nothing in the import flow
   * can compute. If a default sentence is ever added here, this fails.
   */
  it('renders nothing at all when a screen has no aside to show', () => {
    render(<ImportProgress providerLabel="Sleeper" steps={steps(['done', 'working', 'queued'])} />)
    expect(document.querySelector('.af-chimmy-note')).toBeNull()
  })

  it("renders the caller's line when there is one", () => {
    render(
      <ImportProgress
        providerLabel="Sleeper"
        steps={steps(['done', 'working', 'queued'])}
        note={<>Nothing on Sleeper changes while this runs.</>}
      />,
    )
    expect(document.querySelector('.af-chimmy-note')).toBeTruthy()
    expect(screen.getByText(/Nothing on Sleeper changes/i)).toBeTruthy()
  })

  it("never ships the handoff's sample insight as a default", () => {
    render(<ChimmyNote>a derived line</ChimmyNote>)
    expect(screen.queryByText(/Kincaid/i)).toBeNull()
    expect(screen.getByText('a derived line')).toBeTruthy()
  })
})

describe('6d — "Open in {Platform}" is resolved, not constructed', () => {
  const base = {
    providerLabel: 'Sleeper',
    leagueHref: '/core?league=abc',
    onImportAnother: () => {},
    stats: [] as ImportDoneStat[],
  }

  it("renders the deep link as an external, safely-rel'd anchor", () => {
    render(
      <ImportDone
        {...base}
        sourceLink={{ href: 'https://sleeper.com/leagues/123', label: 'Open in Sleeper' }}
      />,
    )
    const a = screen.getByText(/Open in Sleeper/i).closest('a')!
    expect(a.getAttribute('href')).toBe('https://sleeper.com/leagues/123')
    expect(a.getAttribute('target')).toBe('_blank')
    /* noopener matters: this is a link to a third party opened from our page. */
    expect(a.getAttribute('rel')).toMatch(/noopener/)
  })

  /**
   * ⚠ NULL IS A REAL ANSWER. resolveSourceLink returns null for an unknown platform
   * or an unresolvable id, and the button must then be absent rather than pointing
   * somewhere invented.
   */
  it('renders no button when the resolver produced no link', () => {
    render(<ImportDone {...base} sourceLink={null} />)
    expect(screen.queryByText(/^Open in/i)).toBeNull()
  })
})

describe('6e — the completion bar counts live platforms', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          auths: [{ platform: 'espn', hasEspnCookies: true }, { platform: 'yahoo', hasOauthToken: false }],
        }),
      })) as unknown as typeof fetch,
    )
  })

  /**
   * Sleeper (from the profile) + ESPN (cookies present) = 2 connected. Yahoo's row
   * has no token, so it is action-needed rather than connected. Six live platforms.
   */
  it('reports a real fraction and a matching percentage', async () => {
    render(<ConnectedPlatforms sleeperUsername="guap" />)
    await waitFor(() => expect(document.querySelector('.af-ca-progress')).toBeTruthy())

    /* Sleeper (profile) + ESPN (cookies present) are connected in this fixture. */
    const connected = 2
    const total = LIVE.length
    const pct = Math.round((connected / total) * 100)
    expect(screen.getByText(new RegExp(`${connected} of ${total} live platforms connected`, 'i'))).toBeTruthy()
    expect(screen.getByText(`${pct}%`)).toBeTruthy()

    const bar = document.querySelector('[role="progressbar"]')!
    expect(bar.getAttribute('aria-valuenow')).toBe(String(connected))
    expect(bar.getAttribute('aria-valuemax')).toBe(String(total))
  })

  /**
   * ⚠ THE DENOMINATOR IS NOT A HARDCODED 6. The handoff writes "of 6" because all
   * six are live today; switching one off must move the denominator, not leave
   * someone reported as 5-of-6 for a platform they cannot connect.
   */
  it('takes the denominator from the live-provider config', async () => {
    render(<ConnectedPlatforms sleeperUsername={null} />)
    await waitFor(() => expect(document.querySelector('.af-ca-progress')).toBeTruthy())
    /*
     * ⚠ ROWS ARE NOT THE DENOMINATOR. Counting `.af-ca-row` counts every platform
     * INCLUDING the coming-soon ones, which is exactly the number the bar must not
     * use — a switched-off platform is not something you have failed to connect.
     * This asserted "of 6" against a bar correctly saying "of 5".
     */
    expect(document.querySelectorAll('.af-ca-row').length).toBeGreaterThan(LIVE.length)
    expect(screen.getByText(new RegExp(`of ${LIVE.length} live platforms`, 'i'))).toBeTruthy()
  })
})
