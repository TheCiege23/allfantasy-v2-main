import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every `/core/<segment>` link in the app must reach a real screen.
 *
 * An unknown segment on the /core catch-all redirects to /core (2026-09-16). Before that it
 * rendered the home in place. Either way a link to a segment the page does not know lands on
 * the home screen with nothing saying so — `/core/import` shipped exactly that way. The redirect
 * makes the fallback cheap; this suite makes it impossible to link into by accident.
 *
 * A segment is known when the catch-all lists it in SCREEN_KEYS, matches it by name before the
 * session gate (`segment === '…'`), or a sibling route under app/core serves it
 * (app/core/connect-leagues wins over the catch-all).
 */

const ROOT = path.resolve(__dirname, '..', '..')
const PAGE = path.join(ROOT, 'app', 'core', '[[...screen]]', 'page.tsx')
const SCAN_DIRS = ['app', 'lib', 'components', 'hooks']
const SOURCE = /\.(tsx?|jsx?|mjs)$/

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (SOURCE.test(entry.name)) out.push(full)
  }
  return out
}

/** Block comments, and line comments that start a line or follow whitespace (so `https://` survives). */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/[^\n]*/g, '$1')
}

/** First path segment of every quoted `/core/<segment>` in the source, lowercased as the page does. */
export function linkedSegments(source: string): string[] {
  const out: string[] = []
  for (const m of stripComments(source).matchAll(/["'`]\/core\/([A-Za-z0-9_.-]+)/g)) out.push(m[1].toLowerCase())
  return out
}

/** The unknown-segment redirect in the page. A named branch only serves its segment if it runs first. */
export const UNKNOWN_SEGMENT_REDIRECT = 'if (!navKey) {'

export function knownSegments(pageSource: string, siblingRoutes: string[]): Set<string> {
  const known = new Set<string>(siblingRoutes)
  const block = /const SCREEN_KEYS[^=]*=\s*\{([\s\S]*?)\n\}/.exec(pageSource)
  if (!block) throw new Error('SCREEN_KEYS not found in the /core page')
  for (const m of stripComments(block[1]).matchAll(/^\s*'?([a-z0-9-]*)'?\s*:\s*'[a-z0-9-]+'\s*,?\s*$/gm)) known.add(m[1])
  /*
   * ⚠ ONLY THE BRANCHES ABOVE THE REDIRECT. A `segment === 'x'` below it never sees an x that is
   * missing from SCREEN_KEYS, because the redirect has already sent it to /core. Counting every
   * match in the file called `dashboard-v2` reachable with its SCREEN_KEYS entry deleted, because
   * the page still has a later `segment === 'dashboard-v2'` branch.
   */
  const cut = pageSource.indexOf(UNKNOWN_SEGMENT_REDIRECT)
  if (cut < 0) throw new Error('the unknown-segment redirect was not found in the /core page')
  for (const m of pageSource.slice(0, cut).matchAll(/segment === '([a-z0-9-]+)'/g)) known.add(m[1])
  return known
}

describe('/core segment links', () => {
  const pageSource = fs.readFileSync(PAGE, 'utf8')
  const siblings = fs
    .readdirSync(path.join(ROOT, 'app', 'core'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('['))
    .map((e) => e.name)
  const known = knownSegments(pageSource, siblings)

  it('reads the page and the sibling routes it relies on', () => {
    // Controls: an empty or broken parse would make the check below pass vacuously.
    for (const segment of ['', 'trades', 'my-team', 'dashboard-v2', 'hubs', 'partners', 'import', 'connect-leagues']) {
      expect(known.has(segment), `known segments should include "${segment}"`).toBe(true)
    }
    expect(known.has('contact_support')).toBe(false)
  })

  it('counts a named branch only when it runs before the redirect', () => {
    const page = [
      "const SCREEN_KEYS: Record<string, K> = {\n  '': 'home',\n  listed: 'home',\n}",
      "if (segment === 'early') return null",
      `${UNKNOWN_SEGMENT_REDIRECT} redirect('/core') }`,
      "if (segment === 'late') return null",
    ].join('\n')
    const parsed = knownSegments(page, ['sibling'])
    expect([...parsed].sort()).toEqual(['', 'early', 'listed', 'sibling'])
    expect(() => knownSegments(page.replace(UNKNOWN_SEGMENT_REDIRECT, ''), [])).toThrow(/redirect was not found/)
  })

  it('finds links in code and ignores the ones inside comments', () => {
    expect(linkedSegments(`const a = '/core/trades?x=1'\nconst b = \`/core/My-Team\``)).toEqual(['trades', 'my-team'])
    expect(linkedSegments(`// see '/core/nope'\n/* '/core/nope2' */\nconst url = 'https://x.test/core'`)).toEqual([])
    expect(linkedSegments(`{/* <a href="/core/nope3"> */}<a href="/core/live">`)).toEqual(['live'])
  })

  it('links only to segments the /core page or a sibling route serves', () => {
    const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)))
    const unknown = new Map<string, string[]>()
    let linkCount = 0
    for (const file of files) {
      const segments = linkedSegments(fs.readFileSync(file, 'utf8'))
      linkCount += segments.length
      for (const segment of segments) {
        if (known.has(segment)) continue
        const rel = path.relative(ROOT, file).replace(/\\/g, '/')
        unknown.set(segment, [...(unknown.get(segment) ?? []), rel])
      }
    }
    // Control: the scan must actually find the product's links (there are hundreds).
    expect(linkCount).toBeGreaterThan(100)
    expect(Object.fromEntries(unknown), 'links to /core segments nothing serves').toEqual({})
  })
})
