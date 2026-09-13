// @vitest-environment node
/**
 * The landing "Connects to" strip must say what the import availability config says — no more, no
 * less. It was a hardcoded list in LandingV4 that kept advertising Fantrax and MFL as "soon" for two
 * weeks after both went live, and never listed Fleaflicker at all.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getLandingConnectPlatforms } from '@/components/core-app/screens/landingConnectPlatforms'
import { IMPORT_PROVIDER_UI_OPTIONS } from '@/lib/league-import/provider-ui-config'

describe('landing Connects-to strip', () => {
  it('lists every provider the import config knows, once, in config order', () => {
    expect(getLandingConnectPlatforms().map((p) => p.provider)).toEqual(
      IMPORT_PROVIDER_UI_OPTIONS.map((o) => o.provider),
    )
  })

  it('marks a provider the config switches off as soon, and one it switches on as live', () => {
    const strip = getLandingConnectPlatforms([
      { provider: 'sleeper', label: 'Sleeper', available: true },
      { provider: 'mfl', label: 'MyFantasyLeague (MFL)', available: false },
    ])
    expect(strip).toEqual([
      { provider: 'sleeper', name: 'Sleeper', state: 'live' },
      { provider: 'mfl', name: 'MFL', state: 'soon' },
    ])
  })

  /*
   * Explicit values, not derived from the config: deriving would pass whatever the table says. These
   * are the three the hardcoded strip got wrong. If one of them is switched off, this should fail so a
   * person confirms the landing page is meant to change with it.
   */
  it('shows Fantrax, MFL and Fleaflicker as live, matching the config today', () => {
    const byProvider = Object.fromEntries(getLandingConnectPlatforms().map((p) => [p.provider, p]))
    expect(byProvider.fantrax).toEqual({ provider: 'fantrax', name: 'Fantrax', state: 'live' })
    expect(byProvider.mfl).toEqual({ provider: 'mfl', name: 'MFL', state: 'live' })
    expect(byProvider.fleaflicker).toEqual({ provider: 'fleaflicker', name: 'Fleaflicker', state: 'live' })
  })

  it('LandingV4 renders the derived strip, not a list of its own', () => {
    const src = readFileSync(resolve(__dirname, '../components/core-app/screens/LandingV4.tsx'), 'utf8')
    // Positive control: this is the file that renders the strip.
    expect(src).toContain('af-lp-connect')
    expect(src).toContain('getLandingConnectPlatforms()')
    expect(src).not.toMatch(/state:\s*'(live|soon)'\s+as const/)
  })
})
