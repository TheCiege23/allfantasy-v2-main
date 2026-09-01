import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every table a migration creates must have a Prisma model — or be named here with a reason.
 *
 * ── 🛑 THE FAILURE THIS PREVENTS IS A `DROP TABLE` NOBODY MEANT TO WRITE ────────────────────
 * `prisma migrate dev` replays the migration history into a shadow database, diffs the result
 * against `schema.prisma`, and generates a migration for the difference. A table that exists in
 * the history but has no model is a difference — so Prisma proposes **dropping it**, as a normal,
 * expected-looking migration. Applied, that destroys a live table.
 *
 * `tournament_shell_grants` is exactly this today: the migration is applied in production (its own
 * header says "🛑 PARKED, NOT APPLIED", which was wrong), and `TournamentShellGrant` is in no
 * schema. Nothing in this repo could see it — `lib/prisma/schema-drift.ts` detects only the
 * opposite direction, P2022, "the schema has something the database lacks".
 *
 * ── ⚠ COMMENTS ARE STRIPPED FIRST, AND THAT IS NOT FUSSINESS ────────────────────────────────
 * The probe that found this reported a table called `so`, from the line
 *
 *     -- Uses CREATE TABLE IF NOT EXISTS so this migration is safe to re-run if the table
 *
 * A guard that reports prose as a missing table is a guard people learn to ignore, which is worse
 * than no guard. So `--` lines and block comments go before anything is matched.
 */

const PRISMA_DIR = path.join(process.cwd(), 'prisma')

/** `--` to end of line, and block comments. Order matters: block first, then line. */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

/** Tables the migration history leaves in existence, in order, honouring later DROPs. */
function tablesCreatedByMigrations(): Map<string, string> {
  const migrationsDir = path.join(PRISMA_DIR, 'migrations')
  const created = new Map<string, string>()
  for (const dir of readdirSync(migrationsDir)) {
    const file = path.join(migrationsDir, dir, 'migration.sql')
    if (!existsSync(file)) continue
    const sql = stripSqlComments(readFileSync(file, 'utf8'))
    for (const m of sql.matchAll(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+"?([A-Za-z_][\w]*)"?/gi)) {
      created.set(m[1]!, dir)
    }
    // A table dropped later is not drift — it is gone on purpose.
    for (const m of sql.matchAll(/DROP\s+TABLE(?:\s+IF\s+EXISTS)?\s+"?([A-Za-z_][\w]*)"?/gi)) {
      created.delete(m[1]!)
    }
  }
  return created
}

/** Every table name `schema.prisma` claims: `@@map("x")` targets plus bare model names. */
function tablesModelled(): Set<string> {
  const schema = readFileSync(path.join(PRISMA_DIR, 'schema.prisma'), 'utf8')
  const out = new Set<string>()
  for (const m of schema.matchAll(/@@map\("([^"]+)"\)/g)) out.add(m[1]!)
  for (const m of schema.matchAll(/^model\s+(\w+)\s*\{/gm)) out.add(m[1]!)
  return out
}

/**
 * Known orphans, each with the reason it is not a model yet.
 *
 * ⚠ THIS LIST ONLY SHRINKS. A new entry means someone shipped a migration without a model, which
 * is the thing this file exists to catch — so adding one is a deliberate act with a name on it,
 * not a way past a red test.
 */
const KNOWN_ORPHANS: Record<string, string> = {
  // Shipped 2026-08-31, applied in production despite its own header saying PARKED. The feature's
  // panels exist under app/tournament-hub/, so the model is owed rather than the table unwanted.
  tournament_shell_grants: 'tournament grants — feature is live, model never added',
  // All five from 20260410143800_fix_schema_drift, which created tables to match a schema that
  // has since moved on. Predate this guard; nothing reads them.
  supplemental_drafts: 'pre-existing, 20260410143800_fix_schema_drift',
  supplemental_draft_picks: 'pre-existing, 20260410143800_fix_schema_drift',
  dispersal_draft_rosters: 'pre-existing, 20260410143800_fix_schema_drift',
  dispersal_asset_pool: 'pre-existing, 20260410143800_fix_schema_drift',
  dispersal_draft_participants: 'pre-existing, 20260410143800_fix_schema_drift',
  draft_intro_views: 'pre-existing, 20260510120000_draft_intro_view_foundation',
}

describe('migration tables have Prisma models', () => {
  it('the parser ignores SQL comments', () => {
    // The positive control, and a real regression: an earlier probe reported a table called `so`
    // from "-- Uses CREATE TABLE IF NOT EXISTS so this migration is safe to re-run".
    const sql = `
      -- Uses CREATE TABLE IF NOT EXISTS so this migration is safe to re-run
      /* CREATE TABLE "commented_out" (id TEXT); */
      CREATE TABLE "genuinely_created" (id TEXT);
    `
    const found = [...stripSqlComments(sql).matchAll(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+"?([A-Za-z_][\w]*)"?/gi)].map((m) => m[1])
    expect(found).toEqual(['genuinely_created'])
  })

  it('finds a real number of tables — a parser that matches nothing would pass everything', () => {
    // Without this, a broken regex makes the whole suite vacuously green: zero tables found means
    // zero orphans found. The exact count drifts, so this asserts a floor, not a figure.
    expect(tablesCreatedByMigrations().size).toBeGreaterThan(300)
    expect(tablesModelled().size).toBeGreaterThan(300)
  })

  it('🛑 no migration creates a table without a model', () => {
    const modelled = tablesModelled()
    const orphans = [...tablesCreatedByMigrations()]
      .filter(([table]) => !modelled.has(table))
      .filter(([table]) => !(table in KNOWN_ORPHANS))
      .map(([table, dir]) => `${table} (${dir})`)

    // Named, not counted: "expected 1 to be 0" would not say which migration, and the fix depends
    // entirely on which one.
    expect(orphans).toEqual([])
  })

  it('⚠ every known orphan is still real — the list must not outlive the drift', () => {
    const created = tablesCreatedByMigrations()
    const modelled = tablesModelled()
    const stale = Object.keys(KNOWN_ORPHANS).filter((t) => !created.has(t) || modelled.has(t))
    // An entry that has been fixed, or whose migration is gone, is dead weight that hides the next
    // real one. This is what stops the allowlist becoming a place things go to be forgotten.
    expect(stale).toEqual([])
  })
})
