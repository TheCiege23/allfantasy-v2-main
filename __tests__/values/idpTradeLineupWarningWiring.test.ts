import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

/**
 * `components/idp/IdpTradeLineupWarning.tsx` had ZERO importers for its whole life.
 *
 * 🛑 THE REASON THAT SURVIVED SO LONG IS THE REASON THIS FILE IS NOT A COMPONENT TEST.
 * A component test renders the thing in isolation and passes perfectly well while nothing
 * in the product imports it — it asserts the component works, never that anyone uses it.
 * Rendering was never the broken half. So this asserts the EDGE: some real module imports
 * the component, and some real module renders it.
 *
 * ⚠ AND THE CENSUS HAS TO COVER ALL FOUR IMPORT FORMS. CLAUDE.md records four separate
 * occasions where a `from '@/lib/x'` grep alone gave the wrong answer about who reaches a
 * module, missing relative imports, `await import(...)`, re-export facades and test mocks.
 * A guard that only knows the '@/' spelling would call a live component dead the moment
 * someone imported it as './IdpTradeLineupWarning'.
 */
const ROOT = process.cwd()
const COMPONENT = 'IdpTradeLineupWarning'

/** Product source only — a test importing it is not a consumer. */
const SCAN_DIRS = ['app', 'components', 'lib']
const SKIP = new Set(['node_modules', '.next', '__tests__', 'e2e'])

function sourceFiles(dir: string): string[] {
  const abs = resolve(ROOT, dir)
  let entries: string[]
  try {
    entries = readdirSync(abs)
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of entries) {
    if (SKIP.has(entry)) continue
    const full = join(abs, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(join(dir, entry)))
    else if (/\.(ts|tsx|js|jsx)$/.test(entry)) out.push(join(dir, entry))
  }
  return out
}

const FILES = sourceFiles('app')
  .concat(sourceFiles('components'), sourceFiles('lib'))
  .filter((f) => !f.endsWith(join('components', 'idp', 'IdpTradeLineupWarning.tsx')))

const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8').replace(/\r/g, '')

/** Static `import ... from`, `await import(...)`, and `require(...)` — every form. */
const IMPORTERS = FILES.filter((f) => {
  const src = read(f)
  if (!src.includes(COMPONENT)) return false
  return (
    /import\s+[^;]*\bIdpTradeLineupWarning\b[^;]*from\s*['"][^'"]*IdpTradeLineupWarning['"]/.test(src) ||
    /import\s*\(\s*['"][^'"]*IdpTradeLineupWarning['"]\s*\)/.test(src) ||
    /require\s*\(\s*['"][^'"]*IdpTradeLineupWarning['"]\s*\)/.test(src)
  )
})

describe('the IDP lineup warning component is actually wired into the product', () => {
  /** 🛑 THE ASSERTION THE DEAD COMPONENT WOULD HAVE FAILED FROM THE DAY IT WAS WRITTEN. */
  it('has at least one non-test importer in app/, components/ or lib/', () => {
    expect(IMPORTERS).not.toHaveLength(0)
  })

  /**
   * An import alone is not consumption — an unused import is dead weight a linter strips.
   * At least one importer has to put it in its JSX.
   */
  it('is rendered as an element by a module that imports it', () => {
    const renders = IMPORTERS.filter((f) => /<IdpTradeLineupWarning[\s/>]/.test(read(f)))
    expect(renders).not.toHaveLength(0)
  })

  /**
   * The server pays for this: a `getTotalIdpStarterSlots` DB read plus roster reconstruction
   * for BOTH sides. That cost is only justified if the string reaches the one surface that
   * calls the route — `app/trade-evaluator/page.tsx` is the sole fetch caller of
   * /api/trade-evaluator; the other trade surfaces only <Link> to this page.
   */
  it('is fed the field the route computes, on the page that calls the route', () => {
    const page = read('app/trade-evaluator/page.tsx')
    expect(page).toContain('idpLineupWarning: payload.tradeInsights?.idpLineupWarning ?? null')
    expect(page).toContain('<IdpTradeLineupWarning idpLineupWarning={result.idpLineupWarning} />')
  })

  /**
   * ⚠ IT MUST NOT ALSO BE IN `buildWarnings`. It used to be, which is how the server cost was
   * being paid for while the component sat dead — and if both render, a manager sees the same
   * sentence twice.
   */
  it('is not duplicated into the generic red warnings list', () => {
    const page = read('app/trade-evaluator/page.tsx')
    const build = page.slice(page.indexOf('function buildWarnings'))
    expect(build.slice(0, build.indexOf('}'))).not.toContain('idpLineupWarning')
  })
})
