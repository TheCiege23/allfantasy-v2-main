/**
 * Schema drift guard: what would `prisma/schema.prisma` do to the database it points at?
 *
 *   npm run db:drift             human report, compared against the committed baseline
 *   npm run db:drift:ci          exit 1 if the diff contains anything the baseline does not
 *   npm run db:drift:baseline    re-measure and rewrite scripts/schema-drift-baseline.json
 *   add --json for machine output
 *
 * Exit codes: 0 no new drift · 1 new drift (--ci only) · 2 COULD NOT MEASURE. 2 is never a verdict.
 *
 * READ-ONLY. `prisma migrate diff --from-schema-datasource` introspects the database and prints
 * SQL; it never applies it. Nothing here writes to any database.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 * `prisma migrate status` compares migration folders with `_prisma_migrations` rows. It does not
 * look at tables. On 2026-09-13 it said "up to date" while the ledger held 180 rows for 157
 * folders, and while schema.prisma would have DROPPED two live tables (manager_psych_profile_seasons,
 * 3,295 rows; tournament_shell_grants) on the next `migrate dev` or `db push`. Only a diff of real
 * objects shows that, and nothing in the repo ran one. lib/prisma/schema-drift.ts detects P2022 at
 * runtime — the opposite direction, and only after a query has already failed.
 *
 * ── 🛑 THE FIRST VERSION OF THIS SCRIPT COULD NOT FAIL, AND IT NEVER LANDED ─────────────────────
 * It was written 2026-06-27 and stranded in the unreviewed wip commit 425ed4689. Recovered with four
 * defects fixed, each of which made it report "✅ No drift" or stay permanently red:
 *
 * 1. It ran `npx prisma …`. `npx` exits 0 on failure in this environment, so a run that never
 *    reached Prisma produced empty stdout, and empty stdout was printed as "No drift". This calls
 *    the CLI with `node` directly, passes `--exit-code` (0 empty · 2 not empty · 1 error), and
 *    additionally requires Prisma's own "This is an empty migration." marker before calling a run
 *    clean. An exit 0 without that marker is an error, not a pass.
 * 2. Its destructive filter was `DROP (TABLE|COLUMN|CONSTRAINT)`. It could not see DROP INDEX,
 *    SET DATA TYPE or a primary-key rebuild — 33 of the destructive items measured on 2026-09-13.
 *    Unrecognised statement shapes are now classified destructive: fail closed.
 * 3. `--ci` failed on ANY drift. Production carries 213 statements of known drift that each need a
 *    human decision, so it would have been red forever and ignored. It now fails only on items
 *    absent from a committed baseline — a ratchet, like scripts/ts-error-baseline.json.
 * 4. It never said which database it read, and it loaded `.env`, which points at PRODUCTION on
 *    this machine. The target is now identified by scripts/db-target-identity.cjs
 *    (endpoint + database) and printed without credentials before anything connects.
 *
 * ── ⚠ COMPARISON IS PER CLAUSE, NOT PER STATEMENT ──────────────────────────────────────────────
 * Prisma folds every change to one table into a single `ALTER TABLE … , … , …`. Compared whole, a
 * NEW `DROP COLUMN` on a table that already had baseline drift would change that statement's text,
 * and the baseline would read it as "one resolved, one added" of equal weight. Split per clause,
 * the new drop is a new item with its own classification.
 *
 * ── ⚠ A BASELINE BELONGS TO ONE DATABASE ───────────────────────────────────────────────────────
 * Staging and production have different drift. Comparing one against the other's baseline reports
 * nonsense in both directions, so a target mismatch is exit 2, not a comparison.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describeDbTarget, findRepoRoot, identifyDbTarget, readEnvFile } from './_db-target-identity'
import { redactAndCap } from '../lib/security/redactSecrets'

export type DriftKind =
  | 'drop-table'
  | 'drop-column'
  | 'drop-primary-key'
  | 'drop-constraint'
  | 'drop-index'
  | 'type-change'
  | 'drop-other'
  | 'unrecognised'
  | 'create-table'
  | 'create-index'
  | 'add-column'
  | 'add-constraint'
  | 'rename-index'
  | 'rename-constraint'
  | 'type-definition'
  | 'column-default'
  | 'nullability'

export interface DriftItem {
  text: string
  kind: DriftKind
  destructive: boolean
}

/** Prisma's own output for an empty `--script` diff, verified against 5.22.0. */
export const EMPTY_MIGRATION_MARKER = 'This is an empty migration.'

export function stripSqlComments(sql: string): string {
  return sql
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
}

/** Statements with comments removed and whitespace collapsed to single spaces. */
export function splitStatements(sql: string): string[] {
  return stripSqlComments(sql)
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0)
}

/** One item per ALTER TABLE clause; every other statement is one item. */
export function toItems(statement: string): string[] {
  const m = /^ALTER TABLE ("[^"]+"(?:\."[^"]+")?) (.*)$/i.exec(statement)
  if (!m) return [statement]
  return m[2]
    .split(/,\s*(?=(?:ADD|DROP|ALTER|RENAME)\b)/i)
    .map((clause) => `ALTER TABLE ${m[1]} ${clause.trim()}`)
}

const RULES: ReadonlyArray<readonly [RegExp, DriftKind, boolean]> = [
  [/^DROP TABLE\b/, 'drop-table', true],
  [/^DROP INDEX\b/, 'drop-index', true],
  [/^(DROP (TYPE|SCHEMA|VIEW|MATERIALIZED VIEW|SEQUENCE|EXTENSION|FUNCTION|TRIGGER)|TRUNCATE|DELETE)\b/, 'drop-other', true],
  [/^ALTER TABLE \S+ DROP COLUMN\b/, 'drop-column', true],
  [/^ALTER TABLE \S+ DROP CONSTRAINT "[^"]*_PKEY"/, 'drop-primary-key', true],
  [/^ALTER TABLE \S+ DROP CONSTRAINT\b/, 'drop-constraint', true],
  [/^ALTER TABLE \S+ ALTER COLUMN \S+ (SET DATA )?TYPE\b/, 'type-change', true],
  [/^CREATE TABLE\b/, 'create-table', false],
  [/^CREATE (UNIQUE )?INDEX\b/, 'create-index', false],
  [/^ALTER TABLE \S+ ADD COLUMN\b/, 'add-column', false],
  [/^ALTER TABLE \S+ ADD CONSTRAINT\b/, 'add-constraint', false],
  [/^ALTER INDEX \S+ RENAME TO\b/, 'rename-index', false],
  [/^ALTER TABLE \S+ RENAME CONSTRAINT\b/, 'rename-constraint', false],
  [/^(CREATE|ALTER) TYPE\b/, 'type-definition', false],
  [/^ALTER TABLE \S+ ALTER COLUMN \S+ (SET|DROP) DEFAULT\b/, 'column-default', false],
  [/^ALTER TABLE \S+ ALTER COLUMN \S+ (SET|DROP) NOT NULL\b/, 'nullability', false],
]

/** Anything no rule recognises is destructive. A new statement shape must be looked at, not waved through. */
export function classifyItem(text: string): DriftItem {
  const upper = text.toUpperCase()
  for (const [pattern, kind, destructive] of RULES) {
    if (pattern.test(upper)) return { text, kind, destructive }
  }
  return { text, kind: 'unrecognised', destructive: true }
}

export function classifyDiff(sql: string): DriftItem[] {
  return splitStatements(sql).flatMap(toItems).map(classifyItem)
}

export interface DiffRun {
  status: number | null
  signal?: string | null
  stdout: string
  stderr: string
  error?: Error
}

export type DiffVerdict =
  | { verdict: 'clean' }
  | { verdict: 'drift'; items: DriftItem[] }
  | { verdict: 'error'; reason: string }

/** Only 0-with-marker is clean and only 2-with-statements is drift. Everything else is "could not measure". */
export function interpretDiffRun(run: DiffRun): DiffVerdict {
  if (run.error) return { verdict: 'error', reason: `prisma did not start: ${redactAndCap(run.error, 400)}` }
  if (run.status === null) {
    return { verdict: 'error', reason: `prisma was killed (${run.signal ?? 'no signal'}); a timeout reads like this` }
  }
  const statements = splitStatements(run.stdout)
  if (run.status === 0) {
    if (statements.length > 0) {
      return { verdict: 'error', reason: `prisma exited 0 (empty) but printed ${statements.length} statement(s)` }
    }
    if (!run.stdout.includes(EMPTY_MIGRATION_MARKER)) {
      return { verdict: 'error', reason: 'prisma exited 0 without its empty-migration marker; refusing to call silence clean' }
    }
    return { verdict: 'clean' }
  }
  if (run.status === 2) {
    if (statements.length === 0) {
      return { verdict: 'error', reason: 'prisma exited 2 (not empty) but no statements could be parsed' }
    }
    return { verdict: 'drift', items: statements.flatMap(toItems).map(classifyItem) }
  }
  const detail = run.stderr.trim() || run.stdout.trim() || '(no output)'
  return { verdict: 'error', reason: `prisma exited ${run.status}: ${redactAndCap(detail, 600)}` }
}

export interface DriftBaseline {
  version: 1
  measuredAt: string
  target: { endpoint: string | null; database: string | null; kind: string }
  items: string[]
}

export function compareToBaseline(items: DriftItem[], baselineItems: readonly string[]) {
  const base = new Set(baselineItems)
  const current = new Set(items.map((i) => i.text))
  const seen = new Set<string>()
  const added = items.filter((i) => !base.has(i.text) && !seen.has(i.text) && seen.add(i.text))
  const resolved = [...base].filter((t) => !current.has(t)).sort()
  return { added, resolved }
}

/** Same precedence the Prisma CLI applies: environment first, then `.env`; DIRECT_URL before DATABASE_URL. */
export function resolveDriftTargetUrl(
  env: Record<string, string | undefined>,
  envFile: Record<string, string>,
): { url: string; source: string } | null {
  if (env.DIRECT_URL) return { url: env.DIRECT_URL, source: 'environment DIRECT_URL' }
  if (env.DATABASE_URL) return { url: env.DATABASE_URL, source: 'environment DATABASE_URL' }
  if (envFile.DIRECT_URL) return { url: envFile.DIRECT_URL, source: '.env DIRECT_URL' }
  if (envFile.DATABASE_URL) return { url: envFile.DATABASE_URL, source: '.env DATABASE_URL' }
  return null
}

function sameTarget(a: DriftBaseline['target'], endpoint: string | null, database: string | null): boolean {
  return a.endpoint === endpoint && a.database === database
}

function main(): number {
  const args = process.argv.slice(2)
  const CI = args.includes('--ci')
  const JSON_OUT = args.includes('--json')
  const UPDATE = args.includes('--update-baseline')
  const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
  const log = (msg: string) => (JSON_OUT ? console.error(msg) : console.log(msg))
  const fail = (msg: string) => {
    console.error(`[check-schema-drift] COULD NOT MEASURE: ${msg}`)
    return 2
  }

  const root = findRepoRoot(process.cwd())
  const schema = path.resolve(root, arg('schema') ?? 'prisma/schema.prisma')
  const baselinePath = path.resolve(root, arg('baseline') ?? 'scripts/schema-drift-baseline.json')
  const cli = path.join(root, 'node_modules', 'prisma', 'build', 'index.js')
  if (!fs.existsSync(schema)) return fail(`schema not found: ${schema}`)
  if (!fs.existsSync(cli)) return fail(`prisma CLI not found at ${cli} (a worktree needs a node_modules junction)`)

  const resolved = resolveDriftTargetUrl(process.env, readEnvFile(path.join(root, '.env')))
  if (!resolved) return fail('no DIRECT_URL or DATABASE_URL in the environment or .env')
  const target = identifyDbTarget(resolved.url)
  if (target.kind === 'unparseable') return fail(`the ${resolved.source} connection string could not be parsed`)
  log(`[check-schema-drift] target: ${describeDbTarget(resolved.url)}, from ${resolved.source}. Read-only introspection.`)

  const run = spawnSync(
    process.execPath,
    [cli, 'migrate', 'diff', '--from-schema-datasource', schema, '--to-schema-datamodel', schema, '--script', '--exit-code'],
    {
      cwd: root,
      // Pinned both ways so the datasource's url AND directUrl resolve to the target named above,
      // and passed through the environment rather than argv, where `ps` could read the password.
      env: { ...process.env, DATABASE_URL: resolved.url, DIRECT_URL: resolved.url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 5 * 60 * 1000,
      windowsHide: true,
    },
  )
  const verdict = interpretDiffRun({
    status: run.status,
    signal: run.signal,
    stdout: run.stdout ?? '',
    stderr: run.stderr ?? '',
    error: run.error,
  })
  if (verdict.verdict === 'error') return fail(verdict.reason)
  const items = verdict.verdict === 'drift' ? verdict.items : []

  if (UPDATE) {
    const baseline: DriftBaseline = {
      version: 1,
      measuredAt: new Date().toISOString(),
      target: { endpoint: target.endpoint, database: target.database, kind: target.kind },
      items: [...new Set(items.map((i) => i.text))].sort(),
    }
    fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`)
    log(`[check-schema-drift] wrote ${baseline.items.length} baseline items to ${path.relative(root, baselinePath)}`)
    return 0
  }

  let baseline: DriftBaseline | null = null
  if (fs.existsSync(baselinePath)) {
    try {
      baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as DriftBaseline
    } catch (e) {
      return fail(`baseline is unreadable: ${redactAndCap(e, 200)}`)
    }
    if (!Array.isArray(baseline?.items)) return fail('baseline has no items array')
  } else if (CI) {
    return fail(`no baseline at ${path.relative(root, baselinePath)}; run npm run db:drift:baseline first`)
  }
  if (baseline && !sameTarget(baseline.target, target.endpoint, target.database)) {
    const theirs = `${baseline.target.endpoint}/${baseline.target.database}`
    if (CI) return fail(`baseline was measured on ${theirs}, not on this target`)
    log(`⚠ baseline belongs to ${theirs}; showing the raw diff without comparison`)
    baseline = null
  }

  const comparison = baseline ? compareToBaseline(items, baseline.items) : null
  const byKind: Record<string, number> = {}
  for (const i of items) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1
  const destructive = items.filter((i) => i.destructive)

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          target: describeDbTarget(resolved.url),
          verdict: verdict.verdict,
          items: items.length,
          destructive: destructive.length,
          byKind,
          baseline: baseline ? { measuredAt: baseline.measuredAt, items: baseline.items.length } : null,
          added: comparison?.added ?? null,
          resolved: comparison?.resolved ?? null,
        },
        null,
        2,
      ),
    )
  } else {
    console.log('──── SCHEMA DRIFT (live database → prisma/schema.prisma) ────')
    if (items.length === 0) {
      console.log('✅ Empty diff — the database matches the schema.')
    } else {
      console.log(`${items.length} clause(s), ${destructive.length} destructive`)
      for (const [kind, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(n).padStart(4)}  ${kind}`)
      }
    }
    if (comparison) {
      console.log(`\nBaseline ${baseline!.measuredAt}: ${baseline!.items.length} item(s)`)
      if (comparison.added.length === 0) {
        console.log('✅ Nothing new since the baseline.')
      } else {
        console.log(`🛑 ${comparison.added.length} NEW item(s) not in the baseline:`)
        const ordered = [...comparison.added].sort((a, b) => Number(b.destructive) - Number(a.destructive))
        for (const i of ordered) console.log(`  ${i.destructive ? '!' : '+'} [${i.kind}] ${i.text.slice(0, 220)}`)
      }
      if (comparison.resolved.length > 0) {
        console.log(`\n${comparison.resolved.length} baseline item(s) no longer in the diff. Tighten with npm run db:drift:baseline.`)
      }
    }
    if (destructive.length > 0) {
      console.log('\n🛑 NEVER apply this diff whole. The destructive items above remove live objects.')
    }
  }

  return CI && comparison && comparison.added.length > 0 ? 1 : 0
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  process.exit(main())
}
