/**
 * 🛑 EVERY CALL ON `trade_decision_snapshots` NAMES ITS COLUMNS (2026-09-27).
 *
 * The Prisma client is generated from the schema at build; the database gets new columns only when a
 * migration is applied, which is a separate step. In between, a call with no `select` asks for every
 * column the client knows — a read with P2022, and an insert through its RETURNING clause — and each
 * caller here swallows the error: trade cards silently lose their frozen grades, the history backfill
 * silently recovers nothing. So:
 *   - a READ selects exactly `PUBLIC_RECEIPT_SELECT`, which may not contain a column a migration adds;
 *   - a WRITE selects only `{ id: true }`.
 * A new call site that does neither fails here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { PUBLIC_RECEIPT_SELECT } from '@/lib/league-trade-engine/tradeDecisionReceipt'

const ROOT = process.cwd()
const MIGRATION = 'prisma/migrations/20260927000000_trade_decision_snapshot_evaluation_receipts/migration.sql'
const ADDED = [...readFileSync(resolve(ROOT, MIGRATION), 'utf8').matchAll(/ADD COLUMN IF NOT EXISTS "(\w+)"/g)].map((m) => m[1]!)

const READS = ['findMany', 'findFirst', 'findUnique', 'findFirstOrThrow', 'findUniqueOrThrow']
const WRITES = ['create', 'update', 'upsert', 'delete']

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.(ts|tsx|mts)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

/** The argument text of a call starting at `open` (the index of its `(`), by paren balance. */
function callArgs(src: string, open: number): string {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')' && --depth === 0) return src.slice(open + 1, i)
  }
  return src.slice(open + 1)
}

/** Every Prisma call on a `tradeDecisionSnapshot` delegate in `src`: the delegate itself, or a variable bound to it on one line. */
export function snapshotCalls(src: string): Array<{ op: string; args: string }> {
  const receivers = new Set(['tradeDecisionSnapshot'])
  for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*[^\n;]*\btradeDecisionSnapshot\b[^\n;]*$/gm)) receivers.add(m[1]!)
  const out: Array<{ op: string; args: string }> = []
  const ops = [...READS, ...WRITES].join('|')
  for (const r of receivers) {
    for (const m of src.matchAll(new RegExp(`\\b${r}\\??\\.(${ops})\\(`, 'g'))) {
      out.push({ op: m[1]!, args: callArgs(src, m.index! + m[0].length - 1) })
    }
  }
  return out
}

const calls = [...['lib', 'app', 'server'].flatMap((d) => sourceFiles(resolve(ROOT, d)))]
  .map((file) => ({ file: relative(ROOT, file).replace(/\\/g, '/'), src: readFileSync(file, 'utf8') }))
  .filter(({ src }) => src.includes('tradeDecisionSnapshot'))
  .flatMap(({ file, src }) => snapshotCalls(src).map((c) => ({ file, ...c })))

describe('trade_decision_snapshots calls name their columns', () => {
  it('the migration adds the columns this guard is about', () => {
    expect(ADDED).toEqual(['surface', 'inputHash', 'evaluationReceipt'])
  })

  it('the public read set contains none of them', () => {
    expect(Object.keys(PUBLIC_RECEIPT_SELECT).filter((c) => ADDED.includes(c))).toEqual([])
  })

  it('finds the known call sites (a census that found nothing would pass everything below)', () => {
    const files = new Set(calls.map((c) => c.file))
    for (const f of [
      'lib/core-app/recentTrades.ts',
      'app/api/league/trades-panel/route.ts',
      'app/api/leagues/[leagueId]/trades/[tradeId]/route.ts',
      'app/api/leagues/[leagueId]/trades/handler.ts',
      'lib/league-trade-engine/tradeDecisionSnapshot.ts',
      'lib/league-trade-engine/historicalDecisionBackfill.ts',
      'lib/decision-os/trade/receiptStore.ts',
    ]) expect(files, f).toContain(f)
  })

  it.each(calls.filter((c) => READS.includes(c.op)).map((c) => [`${c.file} ${c.op}`, c.args] as const))(
    'read %s selects PUBLIC_RECEIPT_SELECT',
    (_where, args) => {
      expect(args).toMatch(/select:\s*PUBLIC_RECEIPT_SELECT\b/)
    },
  )

  it.each(calls.filter((c) => WRITES.includes(c.op)).map((c) => [`${c.file} ${c.op}`, c.args] as const))(
    'write %s returns only its id',
    (_where, args) => {
      expect(args).toMatch(/select:\s*\{\s*id:\s*true\s*\}/)
    },
  )

  it('positive control: the scanner sees a select-less read and a select-less create', () => {
    const src = `
      const store = (prisma as X).tradeDecisionSnapshot
      const rows = await store.findMany({ where: { tradeId: { in: ids } } })
      await tx.tradeDecisionSnapshot.create({ data: { a: 1 } })`
    const found = snapshotCalls(src)
    expect(found.map((c) => c.op).sort()).toEqual(['create', 'findMany'])
    expect(found.every((c) => !/select:/.test(c.args))).toBe(true)
  })
})
