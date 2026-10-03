// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * `npm run db:resolve:prod` (scripts/prisma-resolve-prod.cjs) and the Railway wrapper's `resolve` route.
 *
 * 🛑 WHY: two of the four production `_prisma_migrations` rows with CRLF checksums on 2026-10-03 came
 * from a hand-run `prisma migrate resolve`, which no guard could see.
 *
 * ⚠ THE SCRIPT IS RUN FOR REAL, AND CANNOT REACH A DATABASE: every case runs in an empty temp dir with
 * a scrubbed environment, and no case ever supplies a production URL — so every run must stop at a
 * named refusal. Each refusal is asserted by its own wording, and the LF control proves the CRLF
 * refusal is the guard (it gets PAST that check and stops one step later, on the missing URL).
 */

const ROOT = resolve(__dirname, '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'prisma-resolve-prod.cjs')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseResolveArgs } = require(SCRIPT)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { childFor } = require(join(ROOT, 'scripts', 'railway-prod-migrate.cjs'))

const NAME = '20260101000000_add_thing'
const SQL = 'ALTER TABLE "t" ADD COLUMN "c" TEXT;\n'

const dirs: string[] = []
function repo(opts: { sql?: string; envFile?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'af-resolve-'))
  dirs.push(dir)
  if (opts.sql != null) {
    mkdirSync(join(dir, 'prisma', 'migrations', NAME), { recursive: true })
    writeFileSync(join(dir, 'prisma', 'migrations', NAME, 'migration.sql'), opts.sql)
  }
  if (opts.envFile != null) writeFileSync(join(dir, '.env.prod-deploy'), opts.envFile)
  return dir
}

function run(cwd: string, args: string[], allow = true) {
  const env: Record<string, string> = allow ? { ALLOW_PROD_MIGRATION: '1' } : {}
  for (const k of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) if (process.env[k]) env[k] = process.env[k]!
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env, encoding: 'utf8', timeout: 20_000 })
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('parseResolveArgs', () => {
  it('takes exactly one mode and one migration folder name', () => {
    expect(parseResolveArgs(['--applied', NAME])).toEqual({ mode: '--applied', name: NAME })
    expect(parseResolveArgs(['--rolled-back', '20260831_tournament_grants'])).toEqual({ mode: '--rolled-back', name: '20260831_tournament_grants' })
  })
  it('refuses anything else', () => {
    for (const argv of [[], ['--applied'], ['--applied', '--rolled-back', NAME], ['--applied', NAME, '--rolled-back', NAME], ['--applied', 'x; rm -rf /'], ['--applied', NAME, 'extra']]) {
      expect(parseResolveArgs(argv).error).toBeTruthy()
    }
  })
})

describe('railway-prod-migrate childFor', () => {
  it('no arguments is the deploy it always was; `resolve …` goes to the guarded resolve', () => {
    expect(childFor([])).toEqual({ script: 'prisma-migrate-deploy.cjs', args: ['--prod'] })
    expect(childFor(['resolve', '--applied', NAME])).toEqual({ script: 'prisma-resolve-prod.cjs', args: ['--applied', NAME] })
  })
  it('refuses unknown arguments instead of silently running a full deploy', () => {
    expect(childFor(['--applied', NAME]).error).toBeTruthy()
  })
})

describe('db:resolve:prod, run for real', () => {
  it('refuses without ALLOW_PROD_MIGRATION=1', () => {
    const r = run(repo({ sql: SQL }), ['--applied', NAME], false)
    expect(r.status).toBe(1)
    expect(r.out).toContain('ALLOW_PROD_MIGRATION=1 is not set')
  })

  it('refuses a migration that is not in prisma/migrations', () => {
    const r = run(repo(), ['--applied', NAME])
    expect(r.status).toBe(1)
    expect(r.out).toContain('does not exist')
  })

  it('refuses a CRLF migration.sql before reading any credential', () => {
    const r = run(repo({ sql: SQL.replace(/\n/g, '\r\n') }), ['--applied', NAME])
    expect(r.status).toBe(1)
    expect(r.out).toContain('CR byte')
    expect(r.out).not.toContain('.env.prod-deploy')
  })

  it('CONTROL: an LF migration passes that check and stops one step later, on the missing URL', () => {
    const r = run(repo({ sql: SQL }), ['--applied', NAME])
    expect(r.status).toBe(1)
    expect(r.out).not.toContain('CR byte')
    expect(r.out).toContain('no DIRECT_URL in .env.prod-deploy')
  })

  it('refuses a .env.prod-deploy that is not production — and never connects to find out', () => {
    const r = run(repo({ sql: SQL, envFile: 'DIRECT_URL=postgresql://u:p@127.0.0.1:1/not_prod\n' }), ['--applied', NAME])
    expect(r.status).toBe(1)
    expect(r.out).toContain('does not point at production')
    expect(r.out).not.toContain('u:p@')
  })
})
