import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every request-handling writer to EarlyAccessSignup must carry the
 * reserved-domain guard.
 *
 * ⚠ THIS TEST EXISTS BECAUSE A HAND AUDIT MISSED ONE. Two writers live under
 * `app/api/`; a third lives under `server/api-route-modules/`. An audit scoped
 * to `app/` reported the table fully guarded while a public, unauthenticated
 * endpoint was still adding any address it was handed. The fix for that is not
 * "look harder next time" — it is to enumerate the writers mechanically, from
 * the whole tree, on every run.
 *
 * So this walks the source directories rather than taking a hardcoded list: a
 * NEW writer added tomorrow fails this test the day it appears, which a
 * hardcoded list would not do.
 */

const ROOTS = ['app', 'server', 'lib', 'pages']
const SKIP = new Set(['node_modules', '.next', '.git', 'dist', 'build', '.claude'])

/** Creates a row, so it needs the guard. `update`/`updateMany` cannot. */
const CREATES = /earlyAccessSignup\s*\.\s*(create|upsert|createMany)\b/

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

describe('EarlyAccessSignup writers', () => {
  const files = ROOTS.flatMap((r) => walk(r))
  const writers = files.filter((f) => CREATES.test(readFileSync(f, 'utf8')))

  it('finds the writers at all (positive control)', () => {
    // Silent-empty greps have produced false "all clear" results in this repo
    // before, so prove the scan actually sees something before trusting it.
    expect(files.length).toBeGreaterThan(100)
    expect(writers.length).toBeGreaterThan(0)
  })

  it('guards every row-creating writer with isUndeliverableEmailDomain', () => {
    const unguarded = writers.filter(
      (f) => !readFileSync(f, 'utf8').includes('isUndeliverableEmailDomain'),
    )
    expect(
      unguarded,
      `These create EarlyAccessSignup rows without the reserved-domain guard, so ` +
        `test addresses can reach the marketing list:\n  ${unguarded.join('\n  ')}\n` +
        `Import isUndeliverableEmailDomain from @/lib/email/undeliverableDomains ` +
        `and skip the write when it returns true.`,
    ).toEqual([])
  })
})
