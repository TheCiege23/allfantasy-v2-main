import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { renderDriftSummary } from '../scripts/schema-drift-summary.mjs'

/**
 * Pins what .github/workflows/schema-drift.yml is allowed to do.
 *
 * The workflow runs against the production DATABASE_URL on a schedule, unattended. The two ways it
 * could go wrong without anything turning red are: a step that WRITES (applies SQL, pushes the
 * schema, or rewrites the baseline so the ratchet opens itself), and a summary that renders a
 * failure to measure as "✅". Both are asserted here.
 */

const ROOT = process.cwd()
const workflowText = readFileSync(join(ROOT, '.github', 'workflows', 'schema-drift.yml'), 'utf8')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wf = yaml.load(workflowText) as any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const steps: any[] = wf.jobs.drift.steps
const runs = steps.filter((s) => typeof s.run === 'string')
const stepNamed = (name: string) => {
  const s = steps.find((x) => x.name === name)
  if (!s) throw new Error(`no step named ${name}`)
  return s
}

describe('schema-drift workflow: triggers and permissions', () => {
  it('runs on a schedule, on schema changes to main, and by hand', () => {
    // js-yaml parses the bare `on:` key as the string "on"; guard against a loader that maps it to true.
    const on = wf.on ?? wf[true as unknown as string]
    expect(on.schedule.length).toBeGreaterThanOrEqual(1)
    expect(on.push.branches).toEqual(['main'])
    expect(on.push.paths).toEqual(
      expect.arrayContaining(['prisma/schema.prisma', 'scripts/schema-drift-baseline.json', 'scripts/check-schema-drift.ts']),
    )
    expect(on.workflow_dispatch).toBeTruthy()
    expect(on.pull_request).toBeUndefined()
  })

  it('asks for nothing beyond reading the repo and writing one issue', () => {
    expect(wf.permissions).toEqual({ contents: 'read', issues: 'write' })
  })
})

describe('🛑 schema-drift workflow never writes to a database or the baseline', () => {
  const FORBIDDEN =
    /--update-baseline|db:drift:baseline|db\s+push|db:push|migrate\s+(deploy|dev|reset|resolve)|db:migrate|db\s+execute|psql\b|writeFileSync\([^)]*baseline/i

  it.each(runs.map((s) => [s.name ?? '(unnamed)', s.run]))('step "%s" contains no write command', (_name, run) => {
    expect(run).not.toMatch(FORBIDDEN)
  })

  it('the forbidden-command pattern is not vacuous', () => {
    // Positive control: each shape a future edit might add must actually match.
    for (const bad of [
      'node node_modules/tsx/dist/cli.mjs scripts/check-schema-drift.ts --update-baseline',
      'npx prisma db push --accept-data-loss',
      'node node_modules/prisma/build/index.js migrate deploy',
      'npm run db:drift:baseline',
    ]) {
      expect(bad).toMatch(FORBIDDEN)
    }
  })

  it('runs the guard in --ci mode and never with a secret interpolated into the script text', () => {
    const check = stepNamed('Measure drift')
    expect(check.run).toMatch(/scripts\/check-schema-drift\.ts --ci/)
    for (const s of runs) expect(s.run).not.toMatch(/\$\{\{\s*secrets\./)
    expect(check.env.DATABASE_URL).toBe('${{ secrets.DATABASE_URL }}')
  })

  it('masks the derived URL before its first use', () => {
    const run: string = stepNamed('Measure drift').run
    const mask = run.indexOf('::add-mask::')
    const use = run.indexOf('scripts/check-schema-drift.ts')
    expect(mask).toBeGreaterThan(-1)
    expect(mask).toBeLessThan(use)
  })
})

/**
 * 🛑 A STEP THAT READS `$?` MUST CLEAR errexit FIRST, AND NOT SETTING `-e` IS NOT CLEARING IT.
 *
 * GitHub invokes every `run:` as `bash -e {0}`. `set -uo pipefail` leaves errexit ON, so the
 * step dies on the guard's non-zero exit before `RC=$?` — `rc` is never written, and the alert
 * reports "could not measure (exit missing)" for what was really "new drift beyond the
 * baseline". Measured 2026-09-20: four consecutive red runs, every one of them mislabelled, over
 * four migrations that were genuinely missing from production.
 */
describe('🛑 a step that captures an exit code disables errexit', () => {
  const capturing = runs.filter((s) => /\$\?/.test(s.run))

  it('at least one step captures $? — otherwise this suite asserts nothing', () => {
    expect(capturing.length).toBeGreaterThan(0)
  })

  it.each(capturing.map((s) => [s.name ?? '(unnamed)', s.run]))(
    'step "%s" clears errexit before the command whose status it reads',
    (_name, run: string) => {
      const clear = run.indexOf('set +e')
      expect(clear, 'the runner supplies `bash -e`; `set -uo pipefail` does not clear it').toBeGreaterThan(-1)
      expect(clear).toBeLessThan(run.indexOf('$?'))
    },
  )

  it('the guard exit still reaches the later steps through an output', () => {
    const check = stepNamed('Measure drift')
    expect(check.run).toMatch(/RC=\$\?/)
    expect(check.run).toMatch(/echo "rc=\$RC" >> "\$GITHUB_OUTPUT"/)
    for (const name of ['Summarise', 'Open, update or close the alert issue']) {
      expect(stepNamed(name).env.RC).toBe('${{ steps.check.outputs.rc }}')
    }
  })
})

describe('schema-drift workflow installs the lockfile versions', () => {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'))
  it.each(['prisma', 'tsx'])('%s matches package-lock.json', (pkg) => {
    const version = lock.packages[`node_modules/${pkg}`].version
    expect(stepNamed('Install prisma and tsx').run).toContain(`${pkg}@${version}`)
  })
})

describe('the pooler strip leaves the password alone', () => {
  // Mirrors the workflow's sed. A password containing "-pooler." is the case that would break a
  // naive replace, and a broken replace changes the credential, not just the host.
  const strip = (u: string) => u.replace(/(@[^/@.]+)-pooler\./, '$1.')
  it('drops -pooler from the host only', () => {
    expect(strip('postgresql://o:p-pooler.x@ep-a-b-c-pooler.neon.tech/db')).toBe('postgresql://o:p-pooler.x@ep-a-b-c.neon.tech/db')
    expect(strip('postgresql://o:pw@ep-a-b-c.neon.tech/db')).toBe('postgresql://o:pw@ep-a-b-c.neon.tech/db')
  })
  it('the workflow uses that same expression', () => {
    expect(stepNamed('Measure drift').run).toContain(`sed -E 's#(@[^/@.]+)-pooler\\.#\\1.#'`)
  })
})

describe('renderDriftSummary: only readable exit 0 / exit 1 are verdicts', () => {
  const report = {
    target: 'ep-curly-block-ad0dlt9o/neondb (PRODUCTION)',
    items: 243,
    destructive: 23,
    added: [
      { text: 'CREATE INDEX "x_idx" ON "x"("a")', kind: 'create-index', destructive: false },
      { text: 'ALTER TABLE "manager_psych_profile_seasons" DROP COLUMN "format"', kind: 'drop-column', destructive: true },
    ],
    resolved: [],
  }

  it('exit 0 with a readable report is clean', () => {
    const s = renderDriftSummary({ rc: '0', report: { ...report, added: [] }, stderr: '' })
    expect(s.verdict).toBe('clean')
    expect(s.markdown).toContain('No new schema drift')
  })

  it('exit 1 lists destructive items first', () => {
    const s = renderDriftSummary({ rc: '1', report, stderr: '' })
    expect(s.verdict).toBe('drift')
    const body = s.markdown
    expect(body.indexOf('DROP COLUMN "format"')).toBeLessThan(body.indexOf('CREATE INDEX "x_idx"'))
    expect(body).toContain('2 new schema drift item(s)')
  })

  it.each([
    ['exit 2', { rc: '2', report: null, stderr: '[check-schema-drift] COULD NOT MEASURE: prisma exited 1: P1001' }],
    ['exit 0 but the report is unreadable', { rc: '0', report: null, stderr: '' }],
    ['exit 1 but the report is unreadable', { rc: '1', report: 'not json', stderr: '' }],
    ['a missing exit code', { rc: 'missing', report, stderr: '' }],
    ['exit 1 with nothing added', { rc: '1', report: { ...report, added: [] }, stderr: '' }],
  ])('%s is "could not measure", never clean', (_label, input) => {
    const s = renderDriftSummary(input)
    expect(s.verdict).toBe('unmeasured')
    expect(s.markdown).not.toContain('✅')
  })
})
