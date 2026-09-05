import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 🛑 THE WHOLE FIX IS TWO INVARIANTS, AND BOTH LOOK LIKE THINGS WORTH "OPTIMISING".
 *
 * A first human load of /core/trades on a cold dev server returned 500 after 52 seconds with
 * "more than one copy of React" and `useMemo` null in AfCoreShell. The component is not at
 * fault — it declares 'use client', is imported once, exports named AND default, and there is
 * exactly one react/react-dom in node_modules.
 *
 * The dev server's own compile log carries the mechanism:
 *
 *     crash:   ○ Compiling /core/[[...screen]] …
 *              ✓ Compiled /api/meta/events in 38.2s     <- a DIFFERENT route; the page never ✓'d
 *     warmed:  ○ Compiling /core/[[...screen]] …
 *              ✓ Compiled /core/[[...screen]] in 42.5s  <- completes when nothing races it
 *
 * The page begins compiling, its bundle fires ~15 API requests, each starts its own compile,
 * the page's compile is superseded, and SSR runs against a half-built module graph.
 *
 * So the script fixes it by REMOVING CONCURRENCY. Rewrite it with `Promise.all` and it becomes
 * a faster reproduction of the bug; move the page route earlier and its compile races the API
 * routes again. Neither change would fail anything else, which is why they are asserted here.
 */

const SRC = readFileSync(resolve(process.cwd(), 'scripts/warm-dev-routes.mjs'), 'utf8')

describe('🛑 the dev warm-up must stay sequential and page-last', () => {
  it('[control] the scan is reading the right file', () => {
    /*
     * ⚠ ASSERTS SOMETHING THE FILE ACTUALLY CONTAINS. The first version checked for the string
     * 'warm-dev-routes' — the FILENAME, which the header never mentions — so the control failed
     * against a perfectly good file. A positive control that asserts a wrong fact is not a
     * control, and it caught me the same way the rosters-route one did earlier today.
     */
    expect(SRC).toContain('const ROUTES')
    expect(SRC).toContain('async function warm(')
    expect(SRC).toContain('PER_ROUTE_TIMEOUT_MS')
  })

  it('🛑 warms SEQUENTIALLY — Promise.all here rebuilds the exact race', () => {
    /*
     * The `for … await` is the fix. A concurrent version would be faster and would restore the
     * 500, which is the worst combination: it looks like an improvement.
     */
    expect(SRC).toMatch(/for \(const path of ROUTES\)[\s\S]{0,200}?await warm\(path\)/)
    expect(SRC).not.toMatch(/Promise\.all\(\s*ROUTES/)
  })

  it('🛑 compiles the PAGE route last, after the APIs its own bundle would trigger', () => {
    /*
     * Warming in the order a browser happens to request them puts the page first and every API
     * route into its compile window — which is the crash, reproduced deliberately.
     */
    const block = SRC.slice(SRC.indexOf('const ROUTES'), SRC.indexOf(']', SRC.indexOf('const ROUTES')))
    const routes = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
    expect(routes.length).toBeGreaterThan(3)
    expect(routes[routes.length - 1]).toBe('/core/trades')
    /* And the API routes must genuinely precede it, not merely exist somewhere in the list. */
    const apis = routes.filter((r) => r.startsWith('/api/'))
    expect(apis.length).toBeGreaterThan(0)
    for (const a of apis) expect(routes.indexOf(a)).toBeLessThan(routes.length - 1)
  })

  it('⚠ treats a 3xx as success — every gated route answers 307 unauthenticated', () => {
    /*
     * A warm-up that demanded 200 would report the whole app broken, because the routes worth
     * warming are exactly the ones behind the session gate. Only 5xx means the compile produced
     * something broken.
     */
    expect(SRC).toContain('r.status >= 500')
    expect(SRC).not.toMatch(/r\.status\s*!==\s*200/)
  })
})
