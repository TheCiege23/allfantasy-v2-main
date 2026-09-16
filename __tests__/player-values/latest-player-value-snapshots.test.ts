/**
 * The newest-row-per-player read, and the guard that keeps readers on it.
 *
 * The SQL itself was proven against staging (`ep-muddy-leaf`, 2026-09-16): 0 mismatches against the
 * old "fetch everything, keep the first" read over 120 players and all 13 returned fields, 1,560
 * rows down to 120, and an index-only backward probe per id. These tests pin the CONTRACT around it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { loadLatestPlayerValueSnapshots } from '@/lib/player-values/latestPlayerValueSnapshots'

function fakeClient(rows: unknown[] = []) {
  const calls: Prisma.Sql[] = []
  return {
    calls,
    client: {
      $queryRaw: async <T,>(q: Prisma.Sql) => {
        calls.push(q)
        return rows as T
      },
    },
  }
}

describe('loadLatestPlayerValueSnapshots', () => {
  it('does not touch the database for an empty id list', async () => {
    const { calls, client } = fakeClient()
    const out = await loadLatestPlayerValueSnapshots({
      sleeperIds: ['', ''],
      source: 'FANTASYCALC',
      format: 'DYNASTY',
      qbFormat: 'SUPERFLEX',
      client,
    })
    expect(out).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('stops at one row per id: LATERAL, newest first, LIMIT 1', async () => {
    const { calls, client } = fakeClient()
    await loadLatestPlayerValueSnapshots({
      sleeperIds: new Set(['1', '2']),
      source: 'FANTASYCALC',
      format: 'DYNASTY',
      qbFormat: 'SUPERFLEX',
      client,
    })
    const sql = calls[0]!.sql.replace(/\s+/g, ' ')
    expect(sql).toContain('CROSS JOIN LATERAL')
    expect(sql).toMatch(/ORDER BY p\."capturedAt" DESC LIMIT 1/)
    // Equality on every column of the unique index's prefix — what makes each probe one index seek.
    for (const col of ['"sleeperId" = ids.sid', '"source" = ', '"format" = ', '"qbFormat" = ']) {
      expect(sql).toContain(col)
    }
  })

  it('binds ids and the book as PARAMETERS, deduped — nothing is spliced into the SQL text', async () => {
    const { calls, client } = fakeClient()
    await loadLatestPlayerValueSnapshots({
      sleeperIds: ['7', '7', '', "8'; drop table x; --"],
      source: 'FANTASYCALC',
      format: 'REDRAFT',
      qbFormat: 'ONE_QB',
      client,
    })
    const q = calls[0]!
    expect(q.values).toEqual([['7', "8'; drop table x; --"], 'FANTASYCALC', 'REDRAFT', 'ONE_QB'])
    expect(q.sql).not.toContain('drop table')
    expect(q.sql).not.toContain('FANTASYCALC')
  })

  it('returns whatever the query returns, unchanged', async () => {
    const row = { sleeperId: '1', value: 5000, capturedAt: new Date('2026-09-15T10:00:00Z') }
    const { client } = fakeClient([row])
    const out = await loadLatestPlayerValueSnapshots({
      sleeperIds: ['1'],
      source: 'FANTASYCALC',
      format: 'DYNASTY',
      qbFormat: 'ONE_QB',
      client,
    })
    expect(out).toEqual([row])
  })
})

/*
 * ── 🛑 THE GUARD ─────────────────────────────────────────────────────────────────────────────────
 *
 * The unbounded read was not one bug, it was one pattern copied into ~10 files. Fixing six and
 * leaving the door open invites the eleventh. This fails when a `playerValueSnapshot.findMany` asks
 * for a LIST of players with no row bound, unless the file is named below with its reason.
 */
const ROOTS = ['lib', 'app', 'server']
const SKIP_DIRS = new Set(['node_modules', '.next', '__tests__'])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith('.next')) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

/** Each `playerValueSnapshot.findMany(` call's argument text, balanced on parentheses. */
function findManyCalls(src: string): string[] {
  const out: string[] = []
  const re = /playerValueSnapshot\s*\.\s*findMany\s*\(/g
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 1
    let i = m.index + m[0].length
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')') depth--
    }
    out.push(src.slice(m.index, i))
  }
  return out
}

/** A read of a player LIST with no bound on how many dated rows come back per player. */
function isUnboundedHistoryRead(call: string): boolean {
  const byIdList = /sleeperId\s*:\s*\{\s*in\s*:/.test(call)
  const bounded = /\btake\s*:/.test(call) || /\bdistinct\s*:/.test(call)
  return byIdList && !bounded
}

/**
 * Known, deliberate, and each one a decision rather than an oversight.
 */
const ALLOWED: Record<string, string> = {
  // Filters no book at all — "newest across every format" is its own semantic question, not a
  // mechanical swap. Left for a deliberate change.
  'lib/core-app/recentTrades.ts': 'no book filter; semantics need a decision',
  // Same shape twice (counterparty values, incoming ranks): no format or QB-format filter, so
  // "newest" is newest across books. Found by THIS guard — a grep census had missed the file.
  'lib/trade-intel/tradeContextNotes.ts': 'no book filter; semantics need a decision',
  // Takes an injected client whose test doubles implement only `findMany`.
  'lib/trade-market/completedTradeObservations.ts': 'injected client; tests fake findMany',
}

describe('🛑 no reader fetches the whole snapshot history for a player list', () => {
  const root = resolve(process.cwd())
  const files = ROOTS.flatMap((r) => walk(join(root, r)))
  const offenders = files
    .map((f) => ({ file: relative(root, f).replace(/\\/g, '/'), src: readFileSync(f, 'utf8') }))
    .filter(({ src }) => findManyCalls(src).some(isUnboundedHistoryRead))
    .map(({ file }) => file)

  it('[control] the detector flags the old shape and passes the bounded ones', () => {
    const old = `prisma.playerValueSnapshot.findMany({ where: { sleeperId: { in: ids }, format }, orderBy: { capturedAt: 'desc' } })`
    const nested = `prisma.playerValueSnapshot\n  .findMany({ where: { sleeperId: { in: [...ids] }, format: fmt(x) }, orderBy: { capturedAt: 'desc' } }).catch(() => [])`
    expect(findManyCalls(old).some(isUnboundedHistoryRead)).toBe(true)
    // Balanced-paren extraction must reach past `fmt(x)` and still see the whole call.
    expect(findManyCalls(nested)).toHaveLength(1)
    expect(findManyCalls(nested).some(isUnboundedHistoryRead)).toBe(true)
    expect(findManyCalls(old.replace('orderBy', 'take: 40, orderBy')).some(isUnboundedHistoryRead)).toBe(false)
    expect(findManyCalls(old.replace('orderBy', "distinct: ['sleeperId'], orderBy")).some(isUnboundedHistoryRead)).toBe(false)
  })

  it('[control] the scan actually read the tree', () => {
    expect(files.length).toBeGreaterThan(500)
    expect(files.some((f) => f.replace(/\\/g, '/').endsWith('lib/core-app/rosterGrade.ts'))).toBe(true)
  })

  it('only the allowlisted files still do it', () => {
    expect(offenders.sort()).toEqual(Object.keys(ALLOWED).sort())
  })

  it('the migrated readers use the helper', () => {
    for (const f of [
      'lib/decision-os/world/port.ts',
      'lib/core-app/rosterGrade.ts',
      'lib/core-app/dash34.ts',
      'lib/core-app/trades.ts',
      'lib/core-app/tradesBoard.ts',
      'lib/trade-intel/managerPremium.ts',
      'lib/trade-intel/trajectory.ts',
    ]) {
      const src = readFileSync(join(root, f), 'utf8')
      expect(src, f).toContain('loadLatestPlayerValueSnapshots(')
      expect(findManyCalls(src), f).toEqual([])
    }
  })

  it('valueLedger reads a POPULATION through the helper and keeps findMany only for the whole book', () => {
    const src = readFileSync(join(root, 'lib/trade-intel/valueLedger.ts'), 'utf8')
    expect(src).toContain('loadLatestPlayerValueSnapshots(')
    const calls = findManyCalls(src)
    expect(calls).toHaveLength(1)
    // The remaining call must be the no-population branch: no id list in it at all.
    expect(calls[0]).not.toMatch(/sleeperId\s*:\s*\{\s*in/)
  })
})
