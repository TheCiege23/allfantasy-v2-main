import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isImportProviderAvailable } from '@/lib/league-import/provider-ui-config'

const root = resolve(__dirname, '..')

describe('NocturneImport — canonical landing funnel (no legacy guest import)', () => {
  /*
   * ⚠ THE AVAILABILITY TABLE FLIPPED, AND THIS TEST HELD THE OLD ONE. Fantrax,
   * MFL and Fleaflicker all shipped, and Yahoo — the last one held off — was
   * switched on 2026-09-13, so every provider is available.
   * Read from lib/league-import/provider-ui-config.ts, which its own header
   * declares the authority for exactly this question.
   *
   * Kept as explicit values rather than derived from the config: deriving would
   * make this a tautology that passes whatever the table says, and the point of
   * a contract test is to fail when the table changes so a human confirms the
   * change was intended.
   */
  it('availability comes from the authoritative provider-ui-config (Yahoo is off until Yahoo approves access)', () => {
    expect(isImportProviderAvailable('sleeper')).toBe(true)
    expect(isImportProviderAvailable('espn')).toBe(true)
    expect(isImportProviderAvailable('fantrax')).toBe(true)
    expect(isImportProviderAvailable('mfl')).toBe(true)
    expect(isImportProviderAvailable('fleaflicker')).toBe(true)
    expect(isImportProviderAvailable('yahoo')).toBe(false)
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
})
