/**
 * Batch A.1 item 2 — every writer of imported roster data consults the shared decision.
 *
 * The Batch A closeout named three unconverted writers and reasoned that two were "lower risk".
 * That is an assumption, and the instruction was to prove reachability instead. These are the
 * proofs, plus the guards that keep the conversion from rotting.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { rollUpStatus } from '@/lib/league-import/resourceStatus'
import { mayReplaceStoredRoster } from '@/lib/league-import/rosterPayload'

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8')

const BOOTSTRAP = read('lib', 'league-import', 'sleeper', 'SleeperLeagueCreationBootstrapService.ts')
const C2C_COMMIT = read('lib', 'league-import', 'c2cMultiSourceCommit.ts')
const C2C_MERGE = read('lib', 'league-import', 'c2cMultiSourceMerge.ts')
const TO_EXISTING = read('lib', 'league-import', 'LeagueImportToExistingService.ts')
const LEGACY_SYNC = read('lib', 'sleeper-sync.ts')

describe('the shared decision is the only decision', () => {
  it('the bootstrap asks isAuthoritativeStatus rather than comparing strings', () => {
    expect(BOOTSTRAP).toMatch(/isAuthoritativeStatus\(r\.fetch_status\)/)
    /* A direct string comparison is the shape that lets writers drift apart. */
    expect(BOOTSTRAP).not.toMatch(/fetch_status === 'failed'/)
  })

  it('every converted writer stamps the observation through the shared helper', () => {
    for (const [name, src] of [
      ['bootstrap', BOOTSTRAP],
      ['c2cMultiSourceCommit', C2C_COMMIT],
      ['legacy sleeper-sync', LEGACY_SYNC],
    ] as const) {
      expect(src, name).toMatch(/withRosterObservation\(/)
    }
  })

  it('no converted writer writes a raw playerData that skips the stamp', () => {
    /* The stamp is applied to the payload variable actually persisted, not a sibling. */
    for (const src of [BOOTSTRAP, LEGACY_SYNC]) {
      expect(src).not.toMatch(/playerData: playerData as any/)
    }
    expect(C2C_COMMIT).not.toMatch(/playerData: \{\s*\n\s*players:/)
  })
})

describe('c2cMultiSourceCommit — a first import with an unobserved source', () => {
  it('rolls the two source reads up rather than trusting the union', () => {
    /*
     * A C2C roster is a union of a pro and a college read. If the college read failed, writing
     * the union unqualified states "this manager rosters exactly these players" — and because a
     * C2C manager legitimately may have an empty college side, nothing about the shape looks wrong.
     */
    expect(C2C_MERGE).toMatch(/rosterStatus: rollUpStatus\(\[/)
    expect(C2C_COMMIT).toMatch(/manager\.rosterStatus/)
  })

  it('the roll-up marks a half-observed merge as partial, which cannot replace stored data', () => {
    expect(rollUpStatus(['fetched', 'failed'])).toBe('partial')
    expect(mayReplaceStoredRoster('partial')).toBe(false)
  })

  it('a fully observed merge stays authoritative', () => {
    expect(rollUpStatus(['fetched', 'fetched_empty'])).toBe('fetched')
    expect(mayReplaceStoredRoster('fetched')).toBe(true)
  })
})

describe('LeagueImportToExistingService — proven covered by delegation, not assumed', () => {
  it('performs NO roster write of its own', () => {
    /*
     * The Batch A closeout listed this as unconverted. Call-site analysis shows it has zero
     * prisma writes of any kind — it reads rosters and delegates persistence — so converting it
     * would have meant editing a file that cannot write. Pinned so a future direct write here
     * fails loudly instead of bypassing the taxonomy.
     */
    expect(TO_EXISTING).not.toMatch(/prisma\.roster\.(create|update|upsert|createMany|updateMany)/)
    expect(TO_EXISTING).not.toMatch(/prisma\.\w+\.(create|update|upsert)\(/)
  })

  it('delegates to the converted bootstrap', () => {
    expect(TO_EXISTING).toMatch(/bootstrapLeagueFromImport\(/)
    const alias = read('lib', 'league-import', 'LeagueCreationBootstrapService.ts')
    expect(alias).toMatch(/bootstrapLeagueFromNormalizedImport\(/)
  })
})

describe('legacy sleeper-sync — reachable, and fail-closed at the fetch', () => {
  it('is reachable from a live route, so it was converted rather than dismissed', () => {
    const route = read('app', 'api', 'league', 'sleeper-sync', 'route.ts')
    expect(route).toMatch(/syncSleeperLeague/)
  })

  it('aborts before any write when the roster fetch fails', () => {
    /*
     * This is why its status is always authoritative: Sleeper serves every roster in ONE
     * response and a non-ok abort precedes every write — unlike Yahoo's per-team `allSettled`
     * or Fleaflicker's catch-to-empty, which is where the false-empty writes came from.
     */
    expect(LEGACY_SYNC).toMatch(/if \(!rostersRes\.ok\) throw new Error\('Failed to fetch rosters'\)/)
    const throwIdx = LEGACY_SYNC.indexOf("if (!rostersRes.ok) throw")
    const writeIdx = LEGACY_SYNC.indexOf('prisma.roster.')
    expect(throwIdx).toBeGreaterThan(-1)
    expect(writeIdx).toBeGreaterThan(throwIdx)
  })

  it('records fetched_empty for a genuinely empty roster rather than leaving it blank', () => {
    /*
     * "No observation" and "observed and genuinely empty" are exactly the two things this batch
     * separates. A legacy writer that omits the record makes its rows indistinguishable from
     * pre-batch rows for every reader that asks.
     */
    expect(LEGACY_SYNC).toMatch(/players\.length > 0 \? 'fetched' : 'fetched_empty'/)
  })
})

describe('no import writer bypasses the taxonomy', () => {
  it('leaves no un-stamped prisma.roster write in the import surface', () => {
    const writers = [
      ['SleeperLeagueCreationBootstrapService', BOOTSTRAP],
      ['c2cMultiSourceCommit', C2C_COMMIT],
      ['sleeper-sync', LEGACY_SYNC],
    ] as const

    for (const [name, src] of writers) {
      const writes = src.match(/prisma\.roster\.(create|update|upsert)\(/g) ?? []
      if (writes.length === 0) continue
      /* Every writer with a roster write must also carry the stamp. */
      expect(src, `${name} writes rosters but never stamps an observation`).toMatch(
        /withRosterObservation\(/,
      )
    }
  })
})
