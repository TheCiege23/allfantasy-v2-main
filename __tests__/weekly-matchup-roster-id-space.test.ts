import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { buildRosterIdMap, rosterIdsMatch } from '@/lib/core-app/rosterIdMatch'

/**
 * Which providers may write `WeeklyMatchup`, and the measured reason MFL still may not.
 *
 * 🛑 THE INVARIANT, UPDATED 2026-09-03 — READ THE DATE BEFORE TRUSTING THIS COMMENT.
 * `WeeklyMatchup.rosterId` is an Int. Until 2026-09-03 every reader joined it back to a team
 * with a NAIVE string map:
 *
 *     const teamBy = new Map(teams.map((t) => [t.externalId, t]))
 *     teamBy.get(String(row.rosterId))
 *
 * which only round-trips when `String(Number(teamId)) === teamId` — true for Sleeper, ESPN,
 * Yahoo and Fantrax (plain integers) and false for MFL (zero-padded franchise ids, e.g. "0001").
 *
 * That naive join is GONE from the readers now — see `lib/core-app/rosterIdMatch.ts`
 * (`buildRosterIdMap`/`rosterIdsMatch`), used by leagueScoreboard.ts, allPlay.ts,
 * dash3aPanels.ts and leagueHome.ts. It registers a numeric-normalized alias for an all-digits
 * externalId alongside the raw one, so `String(row.rosterId)` finds an MFL team too, and is a
 * no-op for the four providers that were already fine.
 *
 * ✅ AND AS OF 2026-09-12 MFL CAN WRITE MATCHUPS. This paragraph said it could not, and called
 * the schema change "PREPARED but NOT APPLIED" — but that migration had ALREADY been applied to
 * production on 2026-09-03, hours after the sentence was written. Verified against the live
 * database rather than against the migration's own header or this comment, because neither is a
 * schema measurement: `information_schema` reports `WeeklyMatchup.rosterId data_type=text`.
 *
 * ⚠ `MflAdapter` STILL STORES `source_team_id: team.franchiseId` VERBATIM, and that is now the
 * CORRECT behaviour rather than the blocker it was. A text column round-trips "0001", so team
 * identity never has to change — which is what made the "unpad at import" option expensive and
 * is why it is now moot rather than merely unchosen.
 *
 * 🛑 SO THIS FILE'S JOB CHANGED, AND THE GUARD DID NOT DISAPPEAR — IT MOVED. It used to prove
 * the writer was absent. It now proves the one rule that keeps the writer's rows readable: that
 * `mflMatchupParity` never canonicalises the padded id. Every sibling collector does canonicalise
 * and is right to, so the MFL exception looks like an inconsistency to anyone tidying — and that
 * tidy is the failure this guards.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')

/**
 * Source with comments stripped.
 *
 * 🛑 A SOURCE-TEXT ASSERTION IS TRIPPED BY THE PROSE THAT EXPLAINS IT. The MFL
 * writer's own header warns that it must never canonicalise the way its siblings
 * do — and names the pattern while doing so. A test forbidding that pattern
 * therefore matches the very comment warning against it, and fails on a
 * perfectly correct file. Measured here 2026-09-12; the same shape bit a
 * `tokenExpiresAt` assertion elsewhere in this repo.
 */
const codeOnly = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')

/** The join a NAIVE reader performs, reduced to the one thing that breaks it for MFL. */
const survivesTheJoin = (externalId: string) => String(Number(externalId)) === externalId

describe('WeeklyMatchup rosterId must round-trip to a team externalId', () => {
  it.each([
    ['sleeper', '1'],
    ['sleeper', '12'],
    ['espn', '3'],
    ['fantrax', '7'],
  ])('%s id %s survives Int -> String under a naive join', (_provider, id) => {
    expect(survivesTheJoin(id)).toBe(true)
  })

  /*
   * The measurement, using the value the repo's own MFL fixtures actually contain. Not a
   * hypothetical: `Number('0001')` is 1 and `String(1)` is "1", which a NAIVE reader will not
   * match against "0001" — this is exactly the case `rosterIdMatch.ts` exists to handle, and
   * the next `describe` block proves it does.
   */
  it.each(['0001', '0002', '0010'])('MFL franchise id %s does NOT survive a naive join', (id) => {
    expect(survivesTheJoin(id)).toBe(false)
  })

  it('and the padded id is what MFL actually stores, verbatim', () => {
    const adapter = read('lib/league-import/adapters/mfl/MflAdapter.ts')
    expect(adapter).toContain('source_team_id: team.franchiseId')
    // Nothing normalizes it on the way in — the write-side decision is still open.
    expect(adapter).not.toMatch(/franchiseId[^\n]*padStart/)
    expect(adapter).not.toMatch(/franchiseId[^\n]*replace\(\/\^0\+/)
  })
})

describe('rosterIdMatch.ts actually resolves a zero-padded id, not just in theory', () => {
  it('buildRosterIdMap finds an MFL-style team by its Int-truncated rosterId', () => {
    const teams = [
      { externalId: '0001', name: 'Franchise One' },
      { externalId: '0012', name: 'Franchise Twelve' },
    ]
    const teamBy = buildRosterIdMap(teams, (t) => t.externalId)
    // What WeeklyMatchup.rosterId actually holds after the Int column has truncated it.
    expect(teamBy.get(String(1))?.name).toBe('Franchise One')
    expect(teamBy.get(String(12))?.name).toBe('Franchise Twelve')
    // The raw, unpadded lookup a non-MFL reader already relied on still works too.
    expect(teamBy.get('0001')?.name).toBe('Franchise One')
  })

  it('is a no-op for a non-numeric externalId, e.g. a Yahoo team key', () => {
    const teams = [{ externalId: '449.l.12345.t.3', name: 'Yahoo Team' }]
    const teamBy = buildRosterIdMap(teams, (t) => t.externalId)
    expect(teamBy.size).toBe(1)
    expect(teamBy.get('449.l.12345.t.3')?.name).toBe('Yahoo Team')
  })

  it('rosterIdsMatch agrees, for the direct-comparison call sites', () => {
    expect(rosterIdsMatch('0001', 1)).toBe(true)
    expect(rosterIdsMatch('12', 12)).toBe(true)
    expect(rosterIdsMatch('1', 2)).toBe(false)
    expect(rosterIdsMatch(null, 1)).toBe(false)
    expect(rosterIdsMatch(undefined, 1)).toBe(false)
  })

  /**
   * ⚠ `rosterId` ALSO ARRIVES AS A STRING NOW, from any reader sourced off
   * `AllPlayBoard`/`WeeklyMatchup` post text-column migration — not just as the
   * legacy Int this function was originally written against. A version that
   * only coerced `externalId` and compared it to the raw `rosterId` number
   * would silently return false for every one of these once `rosterId` is a
   * string (`1 === "1"` is false), which is exactly the bug this locks in.
   */
  it('rosterIdsMatch agrees when rosterId itself is already a string', () => {
    expect(rosterIdsMatch('0001', '1')).toBe(true)
    expect(rosterIdsMatch('12', '12')).toBe(true)
    expect(rosterIdsMatch('1', '2')).toBe(false)
    expect(rosterIdsMatch(null, '1')).toBe(false)
    expect(rosterIdsMatch(undefined, '1')).toBe(false)
  })

  it('and the four readers actually call it, not a reintroduced naive join', () => {
    for (const [file, expected] of [
      ['lib/core-app/leagueScoreboard.ts', 'buildRosterIdMap(teams, (t) => t.externalId)'],
      ['lib/core-app/allPlay.ts', 'buildRosterIdMap(teams, (t) => t.externalId)'],
      ['lib/core-app/leagueHome.ts', 'rosterIdsMatch(yours?.externalId, r.rosterId)'],
    ] as const) {
      const src = read(file)
      expect(src).toContain(expected)
      expect(src).not.toContain('new Map(teams.map((t) => [t.externalId, t]))')
    }
    const dash3a = read('lib/core-app/dash3aPanels.ts')
    expect(dash3a).toContain('buildRosterIdMap(')
    expect(dash3a).not.toContain("leagueTeams.map((t) => [String(t.externalId)")
  })
})

describe('the MFL matchup writer exists now, and the constraint moved INTO it', () => {
  /*
   * 🛑 THIS BLOCK USED TO ASSERT THE WRITER DID NOT EXIST, and it said of itself:
   * "If someone reconciles the id space and adds the collector, this test SHOULD
   * fail — the note above it is then wrong and must be updated in the same change.
   * That is the point: the constraint and its explanation move together, or
   * neither moves."
   *
   * That is exactly what happened on 2026-09-12, and it caught the change that did
   * it. `WeeklyMatchup.rosterId` became TEXT in production on 2026-09-03, which
   * removed the reason for the absence, and `mflMatchupParity` was built.
   *
   * ⚠ SO THE GUARD IS NOT DELETED — IT MOVES TO WHAT NOW MATTERS. The absence was
   * only ever protecting one invariant: that a zero-padded franchise id must never
   * be canonicalised, because "0001" -> 1 -> "1" never matches
   * `LeagueTeam.externalId` again and produces rows no reader can resolve. The
   * writer existing does not retire that risk; it relocates it to a single line
   * inside the writer, where it looks like an inconsistency somebody should tidy.
   */
  const index = read('lib/import-os/collector/index.ts')
  const writerSource = read('lib/import-os/collector/mflMatchupParity.ts')
  /* ⚠ Comments stripped — see `codeOnly`. The writer's own header names the very
     pattern the next test forbids, so asserting on raw source fails on a correct file. */
  const writer = codeOnly(writerSource)

  it('exports every matchup writer, MFL included', () => {
    expect(index).toContain('runExternalMatchupParity')
    expect(index).toContain('runFantraxMatchupParity')
    expect(index).toContain('runFleaflickerMatchupParity')
    expect(index).toContain('runMflMatchupParity')
  })

  it('🛑 the MFL writer does NOT canonicalise the franchise id', () => {
    /*
     * The one rule that keeps its rows readable. Every sibling collector maps ids
     * through `String(Number(x))` and is right to; this one must not, and a future
     * session tidying the inconsistency is the failure mode this guards.
     */
    expect(writer).not.toMatch(/String\(\s*Number\(/)
    expect(writer).not.toMatch(/parseInt\(/)
    expect(writer).not.toMatch(/\.replace\(\s*\/\^0\+/)
  })

  it('says WHY the id is written verbatim, where the next reader will hit it', () => {
    /* Deliberately the UNstripped source: this one asserts on the prose itself. */
    expect(writerSource).toContain('0001')
    expect(writerSource).toMatch(/NEVER NORMALISE, PAD OR UNPAD/)
  })

  it('self-control: codeOnly keeps code and drops prose', () => {
    /*
     * Without this, a stripper that returned '' would make every `not.toMatch`
     * above pass vacuously — the guard would be decoration.
     */
    expect(codeOnly('const a = 1 // note')).toContain('const a = 1')
    expect(codeOnly('/* String(Number(x)) */\nconst b = 2')).not.toContain('String(Number')
    expect(codeOnly('/* x */\nconst b = 2')).toContain('const b = 2')
    // a URL's // must survive, or the stripper eats real code
    expect(codeOnly("const u = 'https://x.test/a'")).toContain('https://x.test/a')
  })

  it('records that the column change is what unblocked it, with the evidence', () => {
    expect(index).toContain('0001')
    // The read-side fix stays dated so nobody mistakes this for the pre-2026-09-03 state.
    expect(index).toContain('RESOLVED 2026-09-03')
    expect(index).toContain('rosterIdMatch.ts')
    expect(index).toContain('APPLIED TO PRODUCTION 2026-09-03')
  })

  it('no longer claims MFL or Fleaflicker are absent', () => {
    /*
     * Both claims were true when written and are false now. Asserting their
     * ABSENCE as live prose is what stops the file drifting back into telling the
     * next session that shipped work is still blocked.
     */
    expect(index).toMatch(/MFL NOW HAS A WEEKLY-MATCHUP WRITER/)
    expect(index).toMatch(/FLEAFLICKER IS NO LONGER ABSENT/)
  })
})
