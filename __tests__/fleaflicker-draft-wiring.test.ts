// @vitest-environment node
/**
 * The draft mapper is WIRED: the fetch service asks for the board, and the adapter
 * turns it into `draft_picks` with an honest coverage state.
 *
 * 🛑 WHY THIS FILE EXISTS SEPARATELY FROM THE MAPPER SUITE. `mapFleaflickerDraftBoard`
 * can be perfect and still do nothing in production — the failure this repo records
 * as "helper tests pass on unwired features", and the one that shipped two matchup
 * collectors with zero callers earlier the same day. These tests go through the
 * ADAPTER, so removing the call site turns them red while every mapper test stays
 * green.
 *
 * ⚠ `FleaflickerAdapter` IS AN OBJECT LITERAL, NOT A CLASS. It is exported as
 * `export const FleaflickerAdapter: ILeagueImportAdapter = { async normalize(raw) }`,
 * so it is called as `FleaflickerAdapter.normalize(...)`. The first draft of this
 * file did `new FleaflickerAdapter()` and every adapter test died with "is not a
 * constructor" — eight red tests that said nothing about the wiring under test.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { FleaflickerAdapter } from '@/lib/league-import/adapters/fleaflicker/FleaflickerAdapter'
import type { FleaflickerImportPayload } from '@/lib/league-import/fleaflicker/types'

/**
 * ⚠ CRLF IS NORMALISED ON READ, FOR EVERY SOURCE AND FIXTURE THIS FILE INSPECTS.
 * This checkout stores sources with CRLF on disk (294 CR bytes in the fetch service),
 * so a regex anchored on `\n` silently cannot match and reports a correct file as
 * broken. Normalising once here makes every source assertion below line-ending-blind,
 * rather than patching each regex and missing one.
 */
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const fx = (n: string) => JSON.parse(read(`contracts/fleaflicker/fixtures/${n}`))

const STANDINGS = fx('standings.NFL.json')
const ROSTERS = fx('rosters.NFL.json')
const BOARD = fx('draftBoard.NFL.2019.json')
const LIST = fx('draftBoard.NFL.2020.json')

function normalize(draftBoard: FleaflickerImportPayload['draftBoard']) {
  return FleaflickerAdapter.normalize({
    sport: 'NFL',
    season: 2019,
    standings: STANDINGS,
    rosters: ROSTERS,
    rules: null,
    draftBoard,
  } as FleaflickerImportPayload)
}

describe('the adapter populates draft_picks from the board', () => {
  it('a BOARD becomes picks — no longer the hardcoded []', async () => {
    const r = await normalize(BOARD)
    expect(r.draft_picks.length).toBeGreaterThan(0)
  })

  it('a LIST becomes picks through the same wiring', async () => {
    const r = await normalize(LIST)
    expect(r.draft_picks.length).toBeGreaterThan(0)
  })

  it('pick_no survives the wiring as the OVERALL number', async () => {
    /* The mapper suite proves this; this proves nothing in between re-derives it. */
    const r = await normalize(BOARD)
    const late = r.draft_picks.filter((p) => p.round > 1)
    expect(late.length).toBeGreaterThan(0)
    for (const p of late) expect(p.pick_no).toBeGreaterThan(16)
  })

  it('carries the import season onto each pick', async () => {
    const r = await normalize(BOARD)
    expect(r.draft_picks.length).toBeGreaterThan(0)
    expect(r.draft_picks.every((p) => p.season === 2019)).toBe(true)
  })
})

describe('🛑 the three ways draft_picks can be empty are reported differently', () => {
  /*
   * An empty array means three different things here, and only coverage can tell
   * them apart. Collapsing them turns "we could not ask" into "this league never
   * drafted" — the more confident and the more wrong of the two.
   */
  it('the call FAILED (null) -> missing, "did not answer"', async () => {
    const r = await normalize(null)
    expect(r.draft_picks).toEqual([])
    expect(r.coverage.draftHistory.state).toBe('missing')
    expect(r.coverage.draftHistory.note).toMatch(/did not answer/)
  })

  it('the board was EMPTY ({}) -> missing, "empty draft board"', async () => {
    const r = await normalize({})
    expect(r.draft_picks).toEqual([])
    expect(r.coverage.draftHistory.state).toBe('missing')
    expect(r.coverage.draftHistory.note).toMatch(/empty draft board/)
  })

  it('and those two notes are NOT the same sentence', async () => {
    const failed = (await normalize(null)).coverage.draftHistory.note
    const empty = (await normalize({})).coverage.draftHistory.note
    expect(failed).toBeTruthy()
    expect(empty).toBeTruthy()
    expect(failed).not.toBe(empty)
  })

  it('a real board -> full', async () => {
    const r = await normalize(BOARD)
    expect(r.coverage.draftHistory.state).toBe('full')
  })
})

describe('the fetch service actually asks for the board', () => {
  /*
   * Source assertion with comments stripped — the service's own comments name the
   * endpoint while explaining it, so raw source would satisfy these on a file where
   * the call had been deleted.
   */
  const stripComments = (text: string) =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
      .join('\n')

  const code = stripComments(read('lib/league-import/fleaflicker/FleaflickerLeagueFetchService.ts'))

  it('self-control: the stripper keeps code and drops prose', () => {
    /*
     * Without this, the service's own comment naming `fetchFleaflickerDraftBoard(`
     * would satisfy the call-site assertions below on a file where the call was gone.
     */
    expect(code).toContain('fetchFleaflickerLeagueForImport')
    expect(stripComments('/* fetchFleaflickerDraftBoard(x) */\nconst a = 1')).not.toContain(
      'fetchFleaflickerDraftBoard(',
    )
    expect(stripComments('const a = 1 // note')).toContain('const a = 1')
    expect(stripComments("const u = 'https://x.test/a'")).toContain('https://x.test/a')
  })

  it('the import payload builder calls the draft fetcher', () => {
    expect(code).toMatch(/fetchFleaflickerDraftBoard\(sport, leagueId, season\)/)
  })

  it('and it fails SOFT to null, so a draft outage cannot kill an import', () => {
    expect(code).toMatch(
      /fetchFleaflickerDraftBoard\(sport, leagueId, season\)\.catch\(\(\) => null\)/,
    )
  })

  it('and the board is returned on the payload, not fetched and dropped', () => {
    expect(code).toMatch(/\n\s*draftBoard,\n/)
  })

  it('the draft URL carries `season`, unlike the rules URL beside it', () => {
    /*
     * The two sit together on purpose. Rules 400 if sent a season; the draft board
     * needs one. A shared builder would break one of them.
     */
    expect(code).toMatch(/FetchLeagueDraftBoard\?sport=/)
    expect(code).toMatch(/&season=\$\{season\}&draft_number=/)
    const rulesLine = code.split('\n').find((l) => l.includes('FetchLeagueRules?'))
    expect(rulesLine).toBeDefined()
    expect(rulesLine).not.toMatch(/season/)
  })
})
