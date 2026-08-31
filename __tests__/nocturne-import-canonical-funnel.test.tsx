import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  NocturneImport,
  buildImportIntentPath,
} from '@/components/landing/nocturne/NocturneImport'
import { isImportProviderAvailable } from '@/lib/league-import/provider-ui-config'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }))
vi.mock('@/lib/landing-analytics', () => ({ trackLandingCtaClick: vi.fn() }))

const root = resolve(__dirname, '..')
function nextParam(dest: string): string {
  return new URL('http://local' + dest).searchParams.get('next') ?? ''
}

afterEach(() => {
  pushMock.mockClear()
})

describe('NocturneImport — canonical landing funnel (no legacy guest import)', () => {
  it('buildImportIntentPath prefills the Sleeper username via the existing /import contract', () => {
    expect(
      buildImportIntentPath({ id: 'sleeper', inputKind: 'username' }, '  gridiron_gary '),
    ).toBe('/import?provider=sleeper&username=gridiron_gary')
  })

  it('buildImportIntentPath prefills a leagueId for non-Sleeper providers', () => {
    expect(
      buildImportIntentPath({ id: 'espn', inputKind: 'league ID' }, '1948204'),
    ).toBe('/import?provider=espn&leagueId=1948204')
  })

  it('landing Sleeper submit → signup intent → canonical /import (never guest-import, never guest board)', () => {
    render(<NocturneImport variant="full" />)
    fireEvent.change(screen.getByTestId('nocturne-import-full-input'), {
      target: { value: 'gridiron_gary' },
    })
    fireEvent.click(screen.getByTestId('nocturne-import-full-submit'))

    expect(pushMock).toHaveBeenCalledTimes(1)
    const dest = pushMock.mock.calls[0]![0] as string

    // Unauthenticated visitor is sent to signup with the intent preserved…
    expect(dest.startsWith('/signup?')).toBe(true)
    // …and the username survives landing → signup intent → /import with Sleeper selected.
    expect(nextParam(dest)).toBe('/import?provider=sleeper&username=gridiron_gary')
    // No anonymous full import, no legacy guest board redirect.
    expect(dest).not.toContain('/dashboard/universal')
    expect(dest).not.toContain('/api/legacy/guest-import')
  })

  it('mini variant behaves identically (signup intent → canonical /import)', () => {
    render(<NocturneImport variant="mini" />)
    fireEvent.change(screen.getByTestId('nocturne-import-mini-input'), {
      target: { value: 'gridiron_gary' },
    })
    fireEvent.click(screen.getByTestId('nocturne-import-mini-submit'))
    const dest = pushMock.mock.calls[0]![0] as string
    expect(nextParam(dest)).toBe('/import?provider=sleeper&username=gridiron_gary')
  })

  /*
   * ⚠ THE AVAILABILITY TABLE FLIPPED, AND THIS TEST HELD THE OLD ONE. Fantrax,
   * MFL and Fleaflicker all shipped; YAHOO is the one that is deliberately off.
   * Read from lib/league-import/provider-ui-config.ts, which its own header
   * declares the authority for exactly this question.
   *
   * Kept as explicit values rather than derived from the config: deriving would
   * make this a tautology that passes whatever the table says, and the point of
   * a contract test is to fail when the table changes so a human confirms the
   * change was intended.
   */
  it('availability comes from the authoritative provider-ui-config (Yahoo is the one that is off)', () => {
    expect(isImportProviderAvailable('sleeper')).toBe(true)
    expect(isImportProviderAvailable('espn')).toBe(true)
    expect(isImportProviderAvailable('fantrax')).toBe(true)
    expect(isImportProviderAvailable('mfl')).toBe(true)
    expect(isImportProviderAvailable('fleaflicker')).toBe(true)
    expect(isImportProviderAvailable('yahoo')).toBe(false)
  })

  it('an unavailable provider is visibly marked "Coming soon" and cannot create an import intent', () => {
    render(<NocturneImport variant="full" />)
    // Yahoo, not Fantrax — Fantrax shipped. Yahoo is the deliberate hold-out.
    fireEvent.click(screen.getByTestId('nocturne-plat-chip-yahoo'))
    // Visibly identified as coming soon…
    expect(screen.getByTestId('nocturne-plat-chip-yahoo')).toHaveTextContent(/coming soon/i)
    // …and it cannot navigate/create a signup-import intent.
    fireEvent.change(screen.getByTestId('nocturne-import-full-input'), {
      target: { value: '1234567' },
    })
    const submit = screen.getByTestId('nocturne-import-full-submit')
    expect(submit).toBeDisabled()
    fireEvent.click(submit)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('shows all six intended platforms on the landing page', () => {
    render(<NocturneImport variant="full" />)
    for (const id of ['sleeper', 'espn', 'yahoo', 'mfl', 'fantrax', 'fleaflicker'] as const) {
      expect(screen.getByTestId(`nocturne-plat-chip-${id}`)).toBeInTheDocument()
    }
  })

  /*
   * ⚠ INVERTED, BECAUSE FLEAFLICKER SHIPPED. This asserted it was visible but
   * blocked. It is `available: true` in provider-ui-config now, so the old
   * assertions would only pass again if the provider were switched back off.
   * The coverage is kept by testing the same chip from the other side: still
   * visible, NOT marked coming soon, and selectable.
   */
  it('Fleaflicker is visible and selectable (it shipped)', () => {
    render(<NocturneImport variant="full" />)
    const chip = screen.getByTestId('nocturne-plat-chip-fleaflicker')
    expect(chip).toBeInTheDocument()
    expect(chip).toHaveTextContent(/fleaflicker/i)
    fireEvent.click(chip)
    expect(chip).not.toHaveTextContent(/coming soon/i)
  })

  it('the username survives the /import prefill contract (page → client → flow)', () => {
    const pageSrc = readFileSync(resolve(root, 'app/import/page.tsx'), 'utf8')
    const flowSrc = readFileSync(
      resolve(root, 'components/unified-import-ui/LeagueImportFlow.tsx'),
      'utf8',
    )
    // /import reads the username + provider params from the intent URL…
    expect(pageSrc).toContain('pickQuery(sp, "username")')
    expect(pageSrc).toContain('pickQuery(sp, "provider")')
    /*
     * The page hands off to ImportV4 now, and the prop is `initialAccount`
     * (ImportV4 seeds `useState(initialAccount ?? '')` from it). The prefill
     * contract this test guards is unchanged — only the receiving component and
     * the prop name moved.
     */
    expect(pageSrc).toContain('initialAccount={initialSleeperUsername}')
    // …and the canonical flow seeds the discovery input from the prefilled username.
    expect(flowSrc).toContain('useState(initialSleeperUsername)')
  })

  it('the landing funnel no longer touches the legacy guest import (code, not comments)', () => {
    const src = readFileSync(
      resolve(root, 'components/landing/nocturne/NocturneImport.tsx'),
      'utf8',
    )
    // Strip comments so the docstring (which explains the intent) can name the
    // legacy path without tripping the guard; only real code is checked.
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    expect(codeOnly).not.toContain('useLegacySleeperImport')
    expect(codeOnly).not.toContain('/api/legacy/guest-import')
    expect(codeOnly).not.toContain('/dashboard/universal')
  })
})
