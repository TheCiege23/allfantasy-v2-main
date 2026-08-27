/**
 * A league opened from the new shell must not land on the old one.
 *
 * `/core` exists to replace `/league/{id}`. Three screens inside the new shell
 * still linked straight out to the legacy page, so the primary route into a
 * league bypassed the replacement entirely — the Portfolio row, the "Open your
 * league" button at the end of an import, and the triage list.
 *
 * Found the honest way: the first ESPN league ever imported was opened from
 * Portfolio and arrived on `/league/{id}?view=matchups`.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const DIR = resolve(process.cwd(), 'components/core-app/screens')
const read = (f: string) => readFileSync(resolve(DIR, f), 'utf8').replace(/\r\n/g, '\n')
const SCREENS = readdirSync(DIR).filter((f) => f.endsWith('.tsx'))

/*
 * The marker is the interpolated href, not the bare path: prose mentioning
 * /league/{id} is documentation, and a test that fires on a comment teaches
 * people to write worse comments.
 */
const LEGACY_HREF = '/league/${'

describe('⚠ no core screen opens the legacy league page', () => {
  it('routes every league link through /core', () => {
    const offenders: string[] = []
    for (const file of SCREENS) {
      read(file)
        .split('\n')
        .forEach((line, i) => {
          if (!line.includes(LEGACY_HREF)) return
          /*
           * ⚠ AN EXPLICIT ?view= IS A DELIBERATE DEEP LINK, NOT THIS DEFECT.
           * DashTradeBand asks for `?view=legacy` and DashUserOs for
           * `?view=decide` — both name a legacy view that /core does not carry
           * yet. Failing those would force someone to delete a working link to
           * get the suite green.
           */
          if (line.includes('?view=')) return
          offenders.push(`${file}:${i + 1}`)
        })
    }
    expect(offenders).toEqual([])
  })

  it('names the three that were fixed, so a revert is loud', () => {
    expect(read('Portfolio.tsx')).toContain('/core?league=${l.leagueId}')
    expect(read('ImportV4.tsx')).toContain('/core?league=${phase.leagueId}')
    expect(read('Dash3ATriage.tsx')).toContain('/core?league=${l.id}')
  })

  it('says why the import button matters more than the others', () => {
    // It is the first thing a manager sees of a league they just imported.
    expect(read('ImportV4.tsx')).toContain('THE LAST STEP OF AN IMPORT MUST NOT LAND ON THE OLD SURFACE')
  })
})

describe('⚠ the target actually renders', () => {
  it('is the shape /core reads a league id from', () => {
    /*
     * `activeKey` falls back to 'home' when there is no path segment, and
     * `selectedLeagueId` reads the `league` search param — so `/core?league=<id>`
     * is the one URL that reaches LeagueHome. A path like `/core/league/<id>`
     * would render the home queue with no league selected.
     */
    const page = readFileSync(
      resolve(process.cwd(), 'app/core/[[...screen]]/page.tsx'),
      'utf8',
    ).replace(/\r\n/g, '\n')
    expect(page).toContain("typeof sp.league === 'string' ? sp.league : null")
    expect(page).toContain("const activeKey: CoreNavKey = navKey ?? 'home'")
    expect(page).toContain("activeKey === 'home' && selectedLeagueId")
  })
})
