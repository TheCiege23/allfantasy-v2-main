/**
 * The Sleeper player seed had no trigger, and could not safely be given one.
 *
 * `SleeperPlayerSeedService` is complete, correct and unreachable — no route,
 * no cron, no script. Calling it was never the fix: its shape is
 * `deleteMany({ sport, source })` then `createMany`, so running it in
 * production deletes every Sleeper-sourced player row and rebuilds it. There is
 * no safe moment for that on a live product, which is why nobody ever ran it.
 *
 * Worse, two writers already disagree about the unique key. The table is unique
 * on (sport, externalId, source); the uncalled seed writes the bare Sleeper id,
 * and `scripts/sync-rookies-from-sleeper.ts` — the one that gets run — writes
 * `sleeper:<id>`. A third writer picking either format would double every row it
 * touched.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')

const REFRESH = read('lib/sleeper/refreshSleeperPlayerRows.ts')
const CRON = read('app/api/cron/import-players/route.ts')
const SEED = read('lib/sleeper/SleeperPlayerSeedService.ts')
const ROOKIES = read('scripts/sync-rookies-from-sleeper.ts')

describe('⚠ the two existing writers really do disagree about the key', () => {
  it('the uncalled seed writes a bare id', () => {
    expect(SEED).toContain('externalId: player.playerId')
  })

  it('the script that actually runs writes a prefixed one', () => {
    expect(ROOKIES).toContain('const externalId = `sleeper:${p.player_id}`')
  })

  it('both claim the same source, so they share a unique namespace', () => {
    expect(SEED).toContain("const SLEEPER_SOURCE = 'sleeper'")
    expect(ROOKIES).toContain("source: 'sleeper'")
  })
})

describe('⚠ the refresh refuses to make the split worse', () => {
  it('matches on sleeperId rather than externalId', () => {
    // Updating whatever row is already there, in whatever format it was
    // written, is the only way a third writer avoids doubling the table.
    expect(REFRESH).toContain('sleeperId: { not: null }')
    expect(REFRESH).toContain('where: { id: row.id }')
  })

  it('creates in the format the live writer uses', () => {
    expect(REFRESH).toContain('externalId: `${SOURCE}:${id}`')
    expect(REFRESH).toContain('THE PREFIXED FORMAT, MATCHING THE WRITER THAT ACTUALLY RUNS')
  })

  it('⚠ never deletes, and says why', () => {
    /*
     * Sleeper drops retired and released players. Deleting our row would erase
     * a name that still appears in historical trades and rosters.
     */
    /* Asserted on the calls, not the word — the rationale above names it. */
    expect(REFRESH).not.toContain('prisma.sportsPlayer.deleteMany')
    expect(REFRESH).not.toContain('prisma.sportsPlayer.delete(')
    expect(REFRESH).toContain('LEFT ALONE')
  })
})

describe('⚠ a budget without staleness ordering starves the tail', () => {
  it('orders oldest first, so successive runs cover everything', () => {
    // The pairing lib/cron/runBudget.ts documents as mandatory: a fixed order
    // plus a budget does the first few rows forever and never reaches the rest.
    expect(REFRESH).toContain("orderBy: { fetchedAt: 'asc' }")
  })

  it('snapshots the queue before writing to it', () => {
    // Updating fetchedAt as it goes would otherwise reshuffle the ordering
    // underneath the loop.
    expect(REFRESH).toContain('ordering is a snapshot')
  })

  it('checks the budget between rows, never inside a write', () => {
    expect(REFRESH).toContain('if (isExhausted()) break')
  })

  it('does not spend a second full pass on creates', () => {
    expect(REFRESH).toContain('const createBudget = Math.max(0, limit - scanned)')
  })
})

describe('⚠ null is never zero, in either direction', () => {
  it('parses missing numbers to null', () => {
    // 0 means "has not played an NFL snap". Writing it for a missing value
    // manufactures rookies.
    expect(REFRESH).toContain('a non-finite value becomes null, never 0')
    expect(REFRESH).toContain('yearsExp: toFiniteNumber(p.years_exp)')
  })
})

describe('⚠ it rides on the cron, it is not the cron', () => {
  it('is a deferrable phase on the existing import-players run', () => {
    // NO NEW API ROUTE — the repo sits at the platform's route ceiling, and a
    // maintenance phase is not worth one.
    expect(CRON).toContain("deferredPhases.push('sleeperRows')")
    expect(CRON).toContain("await import('@/lib/sleeper/refreshSleeperPlayerRows')")
  })

  it('passes the handler budget in, rather than starting its own clock', () => {
    // The edge cuts the connection at 300s and answers 502 itself; a phase with
    // its own budget would overshoot the handler's.
    expect(CRON).toContain('isExhausted: () => budget.exhausted()')
  })

  it('never fails the import it rides on', () => {
    expect(CRON).toContain('sleeper row refresh failed')
  })

  it('reports itself in the response, so a silent no-op is visible', () => {
    // A phase attached to something that never fires looks wired up in code and
    // leaves the table empty in prod.
    expect(CRON).toContain('sleeperRows,')
  })

  it('is gated to NFL, like the other phases here', () => {
    expect(CRON).toContain('!dryRun && wantsNfl && budget.exhausted()')
  })
})
