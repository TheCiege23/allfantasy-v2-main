import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every provider name `packet.ts` looks up must be one `ChimmyContextEngine` actually registers.
 *
 * ── 🛑 THE FAILURE THIS PINS SHIPPED, AND NOTHING COULD SEE IT ───────────────────────────────
 * `grade()` took a plain `string` and did `servedBy.get(name)`. Two of the eight were wrong:
 *
 *     packet.ts asked for      engine registers
 *     'rankings'               'ranking'
 *     'importHistory'          'importedHistory'
 *
 * Every registered provider gets a `meta.providers` entry whether it succeeds, returns nothing, or
 * rejects — so `servedBy.get()` returning `undefined` means ONLY that the name is wrong. But an
 * unknown name and a healthy provider were handled by the same `p?.` chain, so a miss degraded
 * into two quiet falsehoods rather than an error:
 *
 *   - `p?.cached` undefined → `servedFrom` reported `'live'` for what may have been a cache hit
 *   - `p?.error` undefined  → a provider that THREW was reported as "no data is available for this
 *                             league", carrying the remedy for an empty league instead of the
 *                             remedy for a broken one
 *
 * Both wrong in the reassuring direction — the same shape as the `pgrep`-127 and `\s+`→`s+`
 * failures in CLAUDE.md, where a lookup that fails hands back a plausible value.
 *
 * ── ⚠ AND THE UNIT TEST AGREED WITH THE BUG ─────────────────────────────────────────────────
 * `grounding-degradation.test.ts`'s bundle fixture listed the CALLER's spellings, so `servedBy`
 * hit in the suite and missed in production. That is why this guard reads the engine's source
 * rather than any fixture: a mock cannot be the authority on the thing it is mocking.
 *
 * ── WHY SOURCE TEXT AND NOT TYPES ───────────────────────────────────────────────────────────
 * `ChimmyContextEngine.providers` is `private`, so `keyof …["providers"]` is unreachable from
 * `packet.ts`, and the exported `ProviderName` in `intent/ProviderSelector.ts` is a DIFFERENT,
 * shorter list (no `replayInsights`, no `devy`) — adopting it would have type-errored the two
 * slices that were spelled correctly. So the union is duplicated, deliberately, and pinned here.
 */

const ENGINE = path.join(process.cwd(), 'lib/chimmy-context/ChimmyContextEngine.ts')
const PACKET = path.join(process.cwd(), 'lib/decision-os/grounding/packet.ts')

/** The `["name", this.providers.name as AnyProvider]` registry rows, which decide `meta.providers`. */
function registeredProviderNames(): Set<string> {
  const src = readFileSync(ENGINE, 'utf8')
  const out = new Set<string>()
  for (const m of src.matchAll(/\["(\w+)",\s*this\.providers\.\w+/g)) out.add(m[1]!)
  return out
}

/** Every literal `grade('x', …)` in the packet builder. */
function gradedNames(): string[] {
  const src = readFileSync(PACKET, 'utf8')
  return [...src.matchAll(/\bgrade\('([^']+)'/g)].map((m) => m[1]!)
}

/** The `EngineProviderName` union members the packet declares. */
function declaredUnion(): Set<string> {
  const src = readFileSync(PACKET, 'utf8')
  const block = src.match(/type EngineProviderName =\n([\s\S]*?)\n\n/)
  expect(block, 'EngineProviderName union not found — did it get renamed?').toBeTruthy()
  return new Set([...block![1]!.matchAll(/\|\s*'([^']+)'/g)].map((m) => m[1]!))
}

describe('packet.ts provider names match the engine registry', () => {
  it('the parsers find real numbers — a broken regex would pass everything vacuously', () => {
    // Without this, an `\w` that stops matching makes every assertion below trivially true.
    expect(registeredProviderNames().size).toBeGreaterThanOrEqual(12)
    expect(gradedNames().length).toBeGreaterThanOrEqual(8)
    expect(declaredUnion().size).toBeGreaterThanOrEqual(8)
  })

  it('🛑 every graded name is one the engine registers', () => {
    const registered = registeredProviderNames()
    // Named, not counted: "expected 2 to be 0" would not say WHICH name, and the fix is the name.
    expect(gradedNames().filter((n) => !registered.has(n))).toEqual([])
  })

  it('🛑 the declared union is a subset of the registry too', () => {
    const registered = registeredProviderNames()
    expect([...declaredUnion()].filter((n) => !registered.has(n))).toEqual([])
  })

  it('⚠ the positive control: the exact two typos that shipped are rejected', () => {
    // Pins the regression itself. A future refactor that reintroduces either spelling goes red
    // here even if the union above is loosened back to `string`.
    const registered = registeredProviderNames()
    expect(registered.has('rankings')).toBe(false)
    expect(registered.has('importHistory')).toBe(false)
    expect(registered.has('ranking')).toBe(true)
    expect(registered.has('importedHistory')).toBe(true)
  })
})
