/**
 * Every Draft HQ call into `resolvePlayerNames` passes the league's sport.
 *
 * ⚠ The resolver scopes PlayerProviderIdentity (`sportKey`), SportsPlayer and the Fantrax registry by
 * sport only when it is handed one, and none of the four Draft HQ call sites handed one — so a
 * Fantrax id or an ESPN id was matched across every sport. Source inspection, in the same style as
 * `draft-hq-provider-scoped-ids.test.ts`, because each call site sits inside a loader that needs a
 * whole league context to run.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const FILE = readFileSync(resolve(process.cwd(), 'lib/core-app/draftHq.ts'), 'utf8').replace(/\r\n/g, '\n')

/** The argument text of every `resolvePlayerNames(…)` call (not the definition), up to its matching `)`. */
function callArgs(src: string): string[] {
  const out: string[] = []
  const re = /(?<!function )resolvePlayerNames\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    let depth = 1, i = m.index + m[0].length
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth += 1
      else if (src[i] === ')') depth -= 1
      i += 1
    }
    out.push(src.slice(m.index + m[0].length, i - 1))
  }
  return out
}

describe('Draft HQ resolvePlayerNames call sites', () => {
  it('finds every call (a control: the parser must see them all)', () => {
    expect(callArgs(FILE).length).toBe(4)
  })

  it('passes a sport argument at every call', () => {
    for (const args of callArgs(FILE)) {
      expect(args).toMatch(/\.sport\b/)
    }
  })
})
