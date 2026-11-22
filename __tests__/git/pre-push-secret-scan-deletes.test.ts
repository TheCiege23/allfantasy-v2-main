import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/*
 * The pre-push hook ran the whole-tree secret scan for every push, including a push that only
 * deletes branches. A deletion publishes nothing, so it now skips the scan. These run the REAL hook
 * in a throwaway repo whose scanner is a stand-in that records the call and FAILS, so a scan that
 * should have run shows up as a blocked push.
 */

const HOOK = resolve(__dirname, '../../.githooks/pre-push')
const ZERO = '0000000000000000000000000000000000000000'
const SHA = '1111111111111111111111111111111111111111'

let repo = ''
const marker = () => join(repo, 'scan-ran')

function runHook(payload: string, env: Record<string, string> = {}) {
  rmSync(marker(), { force: true })
  const res = spawnSync('sh', [HOOK, 'origin', 'https://example.invalid/repo.git'], {
    cwd: repo,
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, AF_SKIP_SECRET_SCAN: '', AF_SKIP_PREPUSH_HOOK: '', ...env },
  })
  return { status: res.status, scanned: existsSync(marker()), stderr: res.stderr }
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'af-prepush-'))
  execFileSync('git', ['init', '-q', repo])
  mkdirSync(join(repo, 'scripts'))
  // Stand-in scanner: records that it ran, then fails as if it found a credential.
  writeFileSync(join(repo, 'scripts', 'secret-scan.mjs'), `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(join(repo, 'scan-ran'))}, '1')\nprocess.exit(1)\n`)
  // Present so the hook uses this repo's scripts rather than falling back to the primary checkout.
  writeFileSync(join(repo, 'scripts', 'check-inflight-prod-build.mjs'), 'process.exit(0)\n')
})

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true })
})

describe('pre-push secret scan and branch deletions', () => {
  it('skips the scan when every ref is a deletion', () => {
    const r = runHook(`(delete) ${ZERO} refs/heads/old-a ${SHA}\n(delete) ${ZERO} refs/heads/old-b ${SHA}\n`)
    expect(r.scanned).toBe(false)
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('only deletes branches')
  })

  it('[control] scans a push that publishes a commit', () => {
    const r = runHook(`refs/heads/feature ${SHA} refs/heads/feature ${ZERO}\n`)
    expect(r.scanned).toBe(true)
    expect(r.status).toBe(1)
  })

  it('scans a mixed push: one deletion does not excuse the ref that publishes', () => {
    const r = runHook(`(delete) ${ZERO} refs/heads/old ${SHA}\nrefs/heads/feature ${SHA} refs/heads/feature ${ZERO}\n`)
    expect(r.scanned).toBe(true)
    expect(r.status).toBe(1)
  })

  it('still fails closed on an empty payload', () => {
    const r = runHook('')
    expect(r.scanned).toBe(true)
    expect(r.status).toBe(1)
  })
})
