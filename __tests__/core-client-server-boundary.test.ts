/**
 * A `'use client'` component may not take a RUNTIME import from a `server-only`
 * module.
 *
 * 🛑 THIS IS A BUNDLING ERROR, AND NOTHING ELSE IN THIS REPO CAN SEE IT.
 * `next.config.js` sets `typescript.ignoreBuildErrors: true`, and a client/server
 * boundary violation is not a type error in the first place — so neither a
 * typecheck nor a green build reports it. It surfaces as a 500 on a live request:
 *
 *   Error: You're importing a component that needs "server-only"
 *
 * Measured 2026-09-10. `components/core-app/screens/DiscordBridge.tsx` imported
 * `BRIDGE_SCOPES_REQUESTED`, `BRIDGE_SCOPES_REFUSED` and `flagsFromDirection` —
 * three runtime VALUES — from `lib/core-app/discordBridge.ts`. That is why the
 * module could not carry a `server-only` marker, which in turn is why a database
 * read sat in a file reachable from the client. Adding the marker without
 * splitting the module took `/core` down outright.
 *
 * ⚠ TYPE-ONLY IMPORTS ARE FINE AND MUST STAY FINE, WHICH IS THE WHOLE DIFFICULTY.
 * `import type { MyTeamData } from '@/lib/core-app/myTeam'` is erased before the
 * bundler ever sees it, and roughly twenty client screens depend on exactly that
 * — `MyTeam`, `Trades`, `Waivers`, `Matchup`, `Career` and the rest all name a
 * `server-only` loader for its types. A guard that flagged those would be wrong
 * about every one of them and would be deleted within a day. The distinction the
 * bundler makes is VALUE vs TYPE, so that is the distinction asserted here.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(__dirname, '..')
const CLIENT_ROOT = join(REPO, 'components', 'core-app')
const LIB_DIR = join(REPO, 'lib', 'core-app')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) out.push(full)
  }
  return out
}

/** True when the file opens with a 'use client' directive. */
function isClientComponent(source: string): boolean {
  const firstCode = source.split('\n').find((l) => l.trim() && !l.trim().startsWith('//'))
  return Boolean(firstCode && /^['"]use client['"]/.test(firstCode.trim()))
}

type CoreImport = { module: string; runtime: boolean; statement: string }

/**
 * Every `@/lib/core-app/<x>` import in the file, classified value-vs-type.
 *
 * ⚠ `import { type A, b }` IS A RUNTIME IMPORT. An inline `type` modifier erases
 * that ONE specifier; the statement still emits as long as any sibling is a
 * value. Treating a statement as type-only because it contains the word `type`
 * is how this check would quietly stop working.
 */
function coreImports(source: string): CoreImport[] {
  const out: CoreImport[] = []
  /*
   * ⚠ `[^'"]` IS LOAD-BEARING, AND THE FIRST DRAFT USED `[\s\S]*?` AND WAS WRONG.
   * A lazy any-character clause happily spans EARLIER import statements, so
   * `import { useState } from 'react'` followed by `import type { X } from
   * '@/lib/core-app/y'` was captured as one statement whose clause contained
   * `useState` — a value — and every type-only import in the repo was reported
   * as a violation. Ten files "failed" on their first run. Forbidding quotes
   * between `import` and `from` cannot cross a preceding module specifier.
   */
  const re = /^import\s+([^'"]*?)\s*from\s*['"]@\/lib\/core-app\/([A-Za-z0-9_]+)['"]/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    const clause = m[1].trim()
    const statement = m[0].replace(/\s+/g, ' ')
    if (/^type\b/.test(clause)) {
      out.push({ module: m[2], runtime: false, statement })
      continue
    }
    const braces = clause.match(/\{([\s\S]*)\}/)
    if (!braces) {
      // A default or namespace import — always a runtime import.
      out.push({ module: m[2], runtime: true, statement })
      continue
    }
    const before = clause.slice(0, clause.indexOf('{')).replace(/,/g, '').trim()
    const specifiers = braces[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const anyValue = Boolean(before) || specifiers.some((s) => !/^type\s/.test(s))
    out.push({ module: m[2], runtime: anyValue, statement })
  }
  return out
}

function isServerOnly(moduleName: string): boolean {
  for (const ext of ['.ts', '.tsx']) {
    try {
      const src = readFileSync(join(LIB_DIR, moduleName + ext), 'utf8')
      return /^import\s+['"]server-only['"]/m.test(src)
    } catch {
      /* try the next extension */
    }
  }
  return false
}

describe('client components and server-only lib/core-app modules', () => {
  const clientFiles = walk(CLIENT_ROOT).filter((f) => isClientComponent(readFileSync(f, 'utf8')))

  it('finds client components that import lib/core-app at all', () => {
    /*
     * 🛑 THE POSITIVE CONTROL FOR THE SUITE ITSELF. Every assertion below is
     * "nothing is wrong", which passes just as happily when the walk found no
     * files, the directory moved, or the import regex stopped matching. Pin the
     * corpus so an empty scan is a failure rather than a pass.
     */
    expect(clientFiles.length).toBeGreaterThan(10)
    const withCoreImports = clientFiles.filter((f) => coreImports(readFileSync(f, 'utf8')).length)
    expect(withCoreImports.length).toBeGreaterThan(10)
  })

  it('sees BOTH kinds of import, or it is not distinguishing anything', () => {
    /*
     * The rule permits type imports and forbids value imports of the SAME
     * modules. If the corpus only ever contained one kind, a check that always
     * answered "type" would pass every assertion here.
     */
    const all = clientFiles.flatMap((f) => coreImports(readFileSync(f, 'utf8')))
    expect(all.some((i) => i.runtime), 'no runtime imports found').toBe(true)
    expect(all.some((i) => !i.runtime), 'no type-only imports found').toBe(true)
    expect(all.some((i) => !i.runtime && isServerOnly(i.module))).toBe(true)
  })

  it('no client component takes a runtime import from a server-only module', () => {
    const violations: string[] = []
    for (const file of clientFiles) {
      for (const imp of coreImports(readFileSync(file, 'utf8'))) {
        if (imp.runtime && isServerOnly(imp.module)) {
          violations.push(
            `${file.slice(REPO.length + 1)} -> lib/core-app/${imp.module} (server-only)\n    ${imp.statement}`
          )
        }
      }
    }
    expect(violations, `runtime import of a server-only module:\n  ${violations.join('\n  ')}`).toEqual([])
  })
})
