/**
 * The SHAPE `crosswalk.get(id) ?? <id>` is banned from lib/.
 *
 * That fallback looked a foreign platform's roster id up as a Sleeper id — and Fleaflicker/MFL/Fantrax/
 * Yahoo ids are short numbers in Sleeper's range (44 of 248 on the one production Fleaflicker league
 * ARE real Sleeper ids, 2026-09-27). My Team, the matchup board and its projections named and priced
 * strangers through it. Every site now asks `sleeperLookupId` (rosterIdCrosswalk.ts), which returns
 * null for a foreign league's unmapped id.
 *
 * ⚠ A SHAPE, NOT A WORD. Forbidding the helper's absence would miss a new inline fallback; this forbids
 * the fallback itself, on any map named like a crosswalk, so the next surface that reaches for
 * `?? id` is stopped here instead of in production. `matchup.ts`'s three sites have no behavioural
 * harness (`getMatchupData` reads a dozen tables); this is what keeps them honest.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', 'lib')

/**
 * `<crosswalk>.get(<x>) ?? <identifier>` — a miss falling back to an id. A fallback to a literal
 * (`?? ''`, `?? null`) or to a guarded expression (`?? (…)`) resolves to nothing and is fine.
 */
const RAW_FALLBACK =
  /\b(sleeperIdByRosterId|crosswalk|sleeperIdByProviderId)\.get\([^)]*\)\s*\?\?\s*(?!['"`(]|null\b|undefined\b)[A-Za-z_$]/

/** The rule's own home defines `sleeperLookupId`, and documents the shape it replaced. */
const EXEMPT = new Set(['core-app/rosterIdCrosswalk.ts'])

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...tsFiles(full))
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

describe('no raw crosswalk fallback', () => {
  it('no module falls back from a crosswalk miss to the raw roster id', () => {
    const offenders: string[] = []
    for (const file of tsFiles(ROOT)) {
      const rel = file.slice(ROOT.length + 1).split('\\').join('/')
      if (EXEMPT.has(rel)) continue
      readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (RAW_FALLBACK.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
        })
    }
    expect(offenders).toEqual([])
  })

  it('the pattern catches the shape it bans, and only that (positive and negative controls)', () => {
    expect(RAW_FALLBACK.test('const x = sleeperIdByRosterId.get(id) ?? id')).toBe(true)
    expect(RAW_FALLBACK.test('byPlayer.get(crosswalk.get(id) ?? id)')).toBe(true)
    expect(RAW_FALLBACK.test('sleeperIdByRosterId.get(entry.playerId) ?? entry.playerId')).toBe(true)
    expect(RAW_FALLBACK.test('const x = sleeperLookupId(platform, id, sleeperIdByRosterId)')).toBe(false)
    // A miss that resolves to nothing is not a raw fallback.
    expect(RAW_FALLBACK.test("players.get(direct ? id : (crosswalk.get(id) ?? ''))")).toBe(false)
    expect(RAW_FALLBACK.test('crosswalk.get(id) ?? null')).toBe(false)
  })
})
