import { describe, expect, it } from 'vitest'

import { getPlatformLanding } from '@/lib/league-import/platformLandingCopy'
import { TOOL_CONFIG } from '@/lib/seo-landing/config'

/*
 * Copy that promises what the Fantrax integration does not do.
 *
 *  - A live Fantrax import reads ONE season (`importFantraxLeague` fetches the current league only);
 *    past seasons exist only where an earlier snapshot or CSV upload happens to match.
 *  - Fantrax draft results are fetched and RETURNED but never stored (`FantraxLeague` has no draft
 *    column — see the `draft` field on `FantraxImportOutcome`), and a live import writes no
 *    transactions, so no Fantrax trades reach AllFantasy either.
 */
describe('Fantrax copy does not overclaim', () => {
  it('the Fantrax import landing does not promise past seasons from a league-id import', () => {
    const landing = getPlatformLanding('fantrax')!
    const built = landing.steps[landing.steps.length - 1]
    expect(built).not.toMatch(/past seasons/i)
    expect(built).toMatch(/rosters/i)
  })

  it('the league-transfer page does not promise Fantrax draft history or trades', () => {
    const page = TOOL_CONFIG['league-transfer']
    const text = page.description
    /* Either Fantrax is not in the "everything copied over" sentence, or the sentence is qualified. */
    expect(text).not.toMatch(/Fantrax to AllFantasy with manager names, settings, rosters, draft history, playoffs, and trades copied over/)
    expect(text).toMatch(/where the platform (provides|publishes)/i)
  })
})
