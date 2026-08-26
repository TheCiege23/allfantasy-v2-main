/**
 * Three externalId shapes under one source, and the same man in several rows.
 *
 * `SportsPlayer` is unique on (sport, externalId, source). Three writers have
 * used three different shapes under `source: 'sleeper'` — the bare id,
 * `sleeper:<id>` and `sleeper_<id>` — and `backfillCanonical` documents one
 * production player carrying all three at once.
 *
 * The obvious fix is to normalise the column. That is the wrong one, and the
 * reason is written down in the code this dedupe reads from.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { pickBestSourceRow, type SourcePlayer } from '@/lib/canonical/sourceRowRanking'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')

const SCRIPT = read('scripts/dedupe-sleeper-player-rows.ts')
const RANKING = read('lib/canonical/sourceRowRanking.ts')
const CANONICAL = read('lib/canonical/backfillCanonical.ts')

function row(over: Partial<SourcePlayer>): SourcePlayer {
  return {
    id: 'r1', name: 'Bijan Robinson', sport: 'NFL', position: 'RB', team: 'ATL',
    externalId: 'sleeper:1', source: 'sleeper', sleeperId: '1',
    imageUrl: null, height: null, weight: null, status: null,
    fetchedAt: new Date('2026-01-01'), expiresAt: null,
    ...over,
  }
}

describe('the ranking prefers completeness, then recency', () => {
  it('takes the row with a headshot over a fresher one without', () => {
    // A fresher row with less in it is not the better row.
    const stale = row({ id: 'a', imageUrl: 'x.jpg', fetchedAt: new Date('2026-01-01') })
    const fresh = row({ id: 'b', imageUrl: null, fetchedAt: new Date('2026-08-01') })
    expect(pickBestSourceRow([fresh, stale]).id).toBe('a')
  })

  it('weights headshot over position over team', () => {
    const headshotOnly = row({ id: 'a', imageUrl: 'x.jpg', position: null, team: null })
    const posAndTeam = row({ id: 'b', imageUrl: null, position: 'RB', team: 'ATL' })
    expect(pickBestSourceRow([posAndTeam, headshotOnly]).id).toBe('a')
  })

  it('breaks a genuine tie on recency', () => {
    const older = row({ id: 'a', fetchedAt: new Date('2026-01-01') })
    const newer = row({ id: 'b', fetchedAt: new Date('2026-08-01') })
    expect(pickBestSourceRow([older, newer]).id).toBe('b')
  })

  it('is stable with a single row', () => {
    expect(pickBestSourceRow([row({ id: 'only' })]).id).toBe('only')
  })
})

describe('⚠ one ranking, reachable from a script', () => {
  it('lives in a pure module with no Prisma and no server-only', () => {
    // A script that had to import backfillCanonical would pull in a Prisma
    // client and an `@/` alias chain just to get an eight-line comparator.
    expect(RANKING).not.toContain("from '@/lib/prisma'")
    expect(RANKING).not.toContain("import 'server-only'")
  })

  it('is the same function the canonical backfill uses', () => {
    /*
     * If the two rankings disagreed, the dedupe would delete the row
     * backfillCanonical had already built a Player from, and the next backfill
     * would rebuild that player from a worse row without complaining.
     */
    expect(CANONICAL).toContain("import { pickBestSourceRow, type SourcePlayer } from './sourceRowRanking'")
    expect(CANONICAL).toContain('export { pickBestSourceRow, type SourcePlayer }')
    expect(SCRIPT).toContain("from '../lib/canonical/sourceRowRanking'")
  })
})

describe('⚠ what the dedupe refuses to do', () => {
  it('does not rewrite externalId', () => {
    // backfillCanonical says plainly that Player.providerIds keeps the RAW
    // externalId because the legacy SportsPlayer mirror looks rows up by it.
    expect(SCRIPT).toContain('THE FIX IS NOT TO REWRITE `externalId`')
    /* It reads the column and never writes one: no update path exists at all. */
    expect(SCRIPT).toContain('externalId: true')
    expect(SCRIPT).not.toContain('sportsPlayer.update')
    expect(SCRIPT).not.toContain('sportsPlayer.updateMany')
  })

  it('never touches a row whose sleeperId is null', () => {
    // Duplication cannot be proven without a shared key.
    expect(SCRIPT).toContain('if (!r.sleeperId) continue')
  })

  it('⚠ treats one sleeperId with two names as a fault, not a duplicate', () => {
    // That is two different people wearing one id, and deleting one of them is
    // not a dedupe's decision to make.
    expect(SCRIPT).toContain('conflicts.push({ sleeperId, names:')
    expect(SCRIPT).toContain('never touched')
  })

  it('is a census until told otherwise', () => {
    expect(SCRIPT).toContain("const WRITE = process.argv.includes('--write')")
    expect(SCRIPT).toContain('census only — nothing written')
  })

  it('says why deleting is safe here, rather than assuming it', () => {
    // Nothing in the schema declares a relation to SportsPlayer, so there is no
    // cascade and no orphan.
    expect(SCRIPT).toContain('nothing in the schema')
    expect(SCRIPT).toContain('Run backfillCanonical afterwards')
  })
})
