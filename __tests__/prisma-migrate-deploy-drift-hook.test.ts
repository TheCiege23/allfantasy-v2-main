import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Pins the post-apply schema drift check in scripts/prisma-migrate-deploy.cjs.
 *
 * That script's job is applying migrations to PRODUCTION. The drift check was added to it because
 * applying a migration is the moment drift is created, and that is not a git event — nothing in
 * .github/workflows/schema-drift.yml can trigger on it, so before this the only coverage was two
 * scheduled slots a day.
 *
 * Bolting a reporter onto a deploy path has exactly three ways to go wrong without anything
 * turning red, and all three are asserted here:
 *
 *   1. It changes the exit code. The migration is ALREADY APPLIED by the time it runs, so a
 *      non-zero would be read as "the migration failed" — the opposite of what happened — and
 *      would invite a re-run of a deploy that succeeded.
 *   2. It runs against the wrong database. The baseline belongs to ONE endpoint and records it,
 *      so a dev target is a mismatch (exit 2) on every dev deploy. A guard that cries wolf on the
 *      common path is one people learn to skip.
 *   3. It rewrites the baseline. `--update-baseline` on an automated path is the ratchet opening
 *      itself: every future drift would be accepted at birth and nothing would ever report again.
 */

const ROOT = process.cwd()
// Newlines normalised because this repo carries CRLF files, and a `\n`-anchored search against a
// CRLF source silently returns -1. `slice(-1)` on that is a one-character string, not an error —
// which fails a `toContain` loudly but passes every `not.toMatch` VACUOUSLY. The controls below
// exist because that asymmetry is the whole failure mode this file is written to avoid.
const source = readFileSync(join(ROOT, 'scripts', 'prisma-migrate-deploy.cjs'), 'utf8').replace(
  /\r\n/g,
  '\n',
)

/** The function body, from its declaration to the first line that closes it at column 0. */
function driftFunctionBody(): string {
  const start = source.indexOf('function runPostApplyDriftCheck() {')
  if (start === -1) return ''
  const end = source.indexOf('\n}', start)
  if (end === -1) return ''
  return source.slice(start, end + 2)
}

const callSiteIndex = source.indexOf('\nif (\n  result.status === 0 &&')
const callSite = callSiteIndex === -1 ? '' : source.slice(callSiteIndex)

describe('post-apply drift check: the assertions are not vacuous', () => {
  // Without this, every assertion below passes against a script that has no drift check at all —
  // an empty string contains no `process.exit`, and `expect('').not.toMatch(...)` is green.
  it('the drift check exists in the deploy script', () => {
    expect(source).toContain('function runPostApplyDriftCheck() {')
    expect(source).toContain('runPostApplyDriftCheck()')
    expect(driftFunctionBody().length).toBeGreaterThan(200)
  })

  it('the call-site slice actually found the call site', () => {
    expect(callSiteIndex, 'a -1 here makes every not.toMatch below pass against nothing').toBeGreaterThan(-1)
    expect(callSite.length).toBeGreaterThan(80)
  })
})

describe('🛑 the post-apply drift check is ADVISORY and cannot fail the deploy', () => {
  it('never exits the process from inside the check', () => {
    expect(
      driftFunctionBody(),
      'the migration is already applied when this runs; a non-zero exit reads as "the migration failed"',
    ).not.toMatch(/process\.exit/)
  })

  it('never throws its way out either', () => {
    expect(driftFunctionBody()).not.toMatch(/\bthrow\b/)
  })

  it('the deploy still exits on the migration result, unconditionally', () => {
    expect(source).toMatch(/if \(typeof result\.status === "number"\) \{\s*process\.exit\(result\.status\);/)
  })
})

describe('🛑 it only measures the database the baseline belongs to', () => {
  it('runs only after a SUCCESSFUL apply, and only for --prod', () => {
    expect(callSite).toContain('result.status === 0')
    expect(callSite, 'the baseline records one endpoint; a dev target is exit 2 every time').toContain(
      'targetsProd',
    )
  })

  it('has an escape hatch that is opt-OUT, not opt-in', () => {
    expect(callSite).toContain('AF_SKIP_POST_MIGRATE_DRIFT !== "1"')
  })
})

describe('🛑 it never rewrites the baseline, and reads a trustworthy exit code', () => {
  it('runs the guard in --ci mode and never updates the baseline', () => {
    const body = driftFunctionBody()
    expect(body).toContain('"--ci"')
    expect(body, 'an automated re-baseline accepts every future drift at birth').not.toMatch(
      /--update-baseline/,
    )
  })

  it('does not read an exit status through npx', () => {
    const body = driftFunctionBody()
    expect(body).toContain('process.execPath')
    // npx exits 0 on failure in this environment — defect #1 in check-schema-drift.ts's own
    // header, the bug that made that guard's first version unable to fail.
    expect(body).not.toMatch(/["']npx["']/)
  })

  it('treats anything other than 0 or 1 as "not a verdict"', () => {
    const body = driftFunctionBody()
    expect(body).toContain('driftResult.status === 0')
    expect(body).toContain('driftResult.status === 1')
    expect(body).toMatch(/could not measure/i)
    expect(body).toMatch(/UNMEASURED, not absent/)
  })
})
