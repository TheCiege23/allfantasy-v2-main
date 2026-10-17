// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * A production `migrate deploy` from a CRLF checkout is refused (scripts/migration-line-endings.cjs).
 *
 * 🛑 THE BUG THIS PINS: Prisma records the sha256 of the bytes on disk, and a Windows checkout has
 * CRLF bytes — four production `_prisma_migrations` rows carried CRLF checksums on 2026-10-03, each
 * written by a careful, target-checked deploy, each corrected by hand afterwards.
 *
 * ⚠ THE SCRIPT IS RUN FOR REAL, AND THAT IS SAFE BY CONSTRUCTION: every case runs in an empty temp
 * directory with no `.env.prod-deploy`, and `--prod` ignores ambient database variables. So with
 * the guard present the run stops at the guard, and WITHOUT it the run stops one step later on
 * "no database URL" — never at a database. That second outcome is the positive control: the LF
 * case must reach it, which proves the refusal in the CRLF case came from the guard and not from
 * the script failing for some other reason first.
 */

const ROOT = resolve(__dirname, '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'prisma-migrate-deploy.cjs')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { findCrMigrations } = require(join(ROOT, 'scripts', 'migration-line-endings.cjs'))

const REFUSAL = 'have CRLF line endings'
const NO_URL = 'db:migrate:deploy error'
const SQL = 'CREATE TABLE "t" (\n  "id" TEXT NOT NULL\n);\n'

const dirs: string[] = []
function repoWith(migrations: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'af-lf-guard-'))
  dirs.push(dir)
  for (const [name, sql] of Object.entries(migrations)) {
    mkdirSync(join(dir, 'prisma', 'migrations', name), { recursive: true })
    writeFileSync(join(dir, 'prisma', 'migrations', name, 'migration.sql'), sql)
  }
  return dir
}

function deploy(cwd: string, args: string[]) {
  /* A scrubbed environment: no database variable can leak in from the developer's shell. */
  const env: Record<string, string> = { ALLOW_PROD_MIGRATION: '1' }
  for (const k of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) if (process.env[k]) env[k] = process.env[k]!
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env, encoding: 'utf8', timeout: 20_000 })
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('findCrMigrations', () => {
  it('names exactly the migrations whose SQL holds a CR byte, with the count', () => {
    const dir = repoWith({
      '20260101000000_lf': SQL,
      '20260102000000_crlf': SQL.replace(/\n/g, '\r\n'),
      '20260103000000_one_stray_cr': 'SELECT 1;\r',
    })
    expect(findCrMigrations(join(dir, 'prisma', 'migrations'))).toEqual([
      { name: '20260102000000_crlf', crBytes: 3 },
      { name: '20260103000000_one_stray_cr', crBytes: 1 },
    ])
  })

  it('an absent directory is empty, not an error', () => {
    expect(findCrMigrations(join(tmpdir(), 'af-lf-guard-does-not-exist'))).toEqual([])
  })
})

describe('prisma-migrate-deploy --prod', () => {
  it('refuses a CRLF checkout before reading any credential, and says how to fix it', () => {
    const r = deploy(repoWith({ '20260101000000_a': SQL, '20260102000000_b': SQL.replace(/\n/g, '\r\n') }), ['--prod'])
    expect(r.status).toBe(1)
    expect(r.out).toContain(REFUSAL)
    expect(r.out).toContain('20260102000000_b')
    expect(r.out).toContain('git -c core.autocrlf=false checkout -- prisma/migrations')
    expect(r.out).not.toContain(NO_URL)
  })

  it('CONTROL: an LF checkout passes the guard and stops one step later, on the missing URL', () => {
    const r = deploy(repoWith({ '20260101000000_a': SQL }), ['--prod'])
    expect(r.status).toBe(1)
    expect(r.out).not.toContain(REFUSAL)
    expect(r.out).toContain(NO_URL)
  })

  it('a non-production run is not refused for line endings', () => {
    const r = deploy(repoWith({ '20260102000000_b': SQL.replace(/\n/g, '\r\n') }), [])
    expect(r.out).not.toContain(REFUSAL)
  })
})
