#!/usr/bin/env node
/**
 * READ-ONLY. How big a table is before you build an index on it (2026-11-14).
 *
 *   railway run node scripts/check-table-sizes.mjs                     # the trade-history index tables
 *   railway run node scripts/check-table-sizes.mjs some_table Another  # any tables, by their SQL name
 *
 * A plain CREATE INDEX blocks WRITES (not reads) to its table until the build finishes, and the build
 * time grows with the table. This prints the planner's row estimate (pg_class.reltuples — no table
 * scan) and the on-disk size, and only ever reads the catalog. It prints the database HOST so you can
 * see which database you asked, and never the URL.
 */
import { PrismaClient } from '@prisma/client'

const tables = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const names = tables.length ? tables : ['dw_transaction_facts', 'LeagueTrade']

function host() {
  try {
    return new URL(process.env.DIRECT_URL || process.env.DATABASE_URL || '').hostname || '(unknown)'
  } catch {
    return '(unparseable URL)'
  }
}

const prisma = new PrismaClient()
try {
  console.log(`check-table-sizes: reading catalog on ${host()} (read-only)`)
  const rows = await prisma.$queryRaw`
    SELECT c.relname AS table,
           GREATEST(c.reltuples, 0)::bigint AS est_rows,
           pg_size_pretty(pg_relation_size(c.oid)) AS table_size,
           pg_size_pretty(pg_indexes_size(c.oid)) AS indexes_size,
           pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY(${names})
    ORDER BY c.relname`
  const found = new Set(rows.map((r) => r.table))
  for (const r of rows) {
    console.log(`  ${r.table}: ~${Number(r.est_rows).toLocaleString('en-US')} rows, table ${r.table_size}, indexes ${r.indexes_size}, total ${r.total_size}`)
  }
  for (const n of names) if (!found.has(n)) console.log(`  ${n}: not found (names are case-sensitive)`)
  console.log('  (row counts are the planner estimate: -1/0 means the table has not been analyzed yet)')
} catch (err) {
  console.error('check-table-sizes failed:', err instanceof Error ? err.message.split('\n').slice(-1)[0] : err)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
