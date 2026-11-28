// @vitest-environment node
/**
 * 🛑 "AF Intelligence" IS "CHIMMY INTELLIGENCE" WHEREVER A PERSON READS IT (owner's decision 2026-11-28).
 *
 * Only the DISPLAY name changed. The internal identifiers stay — `af_intelligence` (the entitlement key,
 * analytics sources such as `lock_af_intelligence`, stored rows), `afIntelligence*` code names and the
 * `af-intelligence` event channel — because analytics and stored rows depend on them. Code comments may
 * still say "AF Intelligence" (they describe the key's history); this suite strips comments first and
 * then requires that no source string a user can see says it, in English or Spanish.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOTS = ['app', 'components', 'lib', 'server', 'hooks', 'emails']
const EXT = /\.(tsx?|jsx?|json|html|mjml)$/

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (EXT.test(name)) out.push(full)
  }
  return out
}

/** Source with comments removed: block comments (incl. JSX `{/* … *\/}`) and `//` line comments (not `://`). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')
}

/** The retired display name, English or Spanish. Internal ids (`af_intelligence`, `afIntelligence`) never match. */
const OLD_NAME = /\bAF[  ]+intelligence\b|\binteligencia[  ]+(?:de[  ]+)?AF\b|\bAF[  ]+inteligencia\b/i

describe('the display name is Chimmy Intelligence', () => {
  it('the matcher finds the old name in a string and ignores it in comments and internal ids (control)', () => {
    expect(OLD_NAME.test(stripComments(`const t = 'AF Intelligence Hub'`))).toBe(true)
    expect(OLD_NAME.test(stripComments(`<p>Inteligencia de AF</p>`))).toBe(true)
    expect(OLD_NAME.test(stripComments(`// AF Intelligence: a comment\nconst k = 'af_intelligence'`))).toBe(false)
    expect(OLD_NAME.test(stripComments(`/* AF Intelligence */ {/* AF Intelligence */} const x = afIntelligence`))).toBe(false)
    expect(OLD_NAME.test(stripComments(`const u = 'https://x.y/'; const t = "AF intelligence"`))).toBe(true)
  })

  it('no user-facing source string says "AF Intelligence" (or its Spanish) any more', () => {
    const files = ROOTS.flatMap((r) => walk(r))
    expect(files.length).toBeGreaterThan(1000)
    const hits: string[] = []
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'))
      code.split('\n').forEach((line, i) => {
        if (OLD_NAME.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(hits).toEqual([])
  })

  it('the renamed surfaces say Chimmy Intelligence', () => {
    const says = (file: string, text: string) => expect([file, readFileSync(file, 'utf8').includes(text)]).toEqual([file, true])
    says('app/ai/tools/page.tsx', "title: 'Chimmy Intelligence Hub |")
    says('app/ai/tools/AIToolsPageClient.tsx', 'Chimmy Intelligence Hub')
    says('app/ai-transparency/page.tsx', 'Chimmy Intelligence Hub')
    says('components/landing/SeoLandingFooter.tsx', "label: 'Chimmy Intelligence Hub'")
    says('app/admin/growth/page.tsx', 'title="Chimmy Intelligence locks"')
    says('lib/admin-dashboard/growthRevenue.ts', "'All Chimmy Intelligence locks'")
    says('app/c2c/components/C2CPlayerModal.tsx', 'Chimmy Analysis (Chimmy Intelligence)')
    says('app/idp/components/IDPPlayerModal.tsx', 'Chimmy Analysis (Chimmy Intelligence)')
  })

  it('the internal identifiers did NOT change', async () => {
    const { ENTITLEMENTS } = await import('@/lib/monetization/entitlements')
    expect(ENTITLEMENTS.af_intelligence.key).toBe('af_intelligence')
    expect(ENTITLEMENTS.af_intelligence.highlightParam).toBe('af_intelligence')
    expect(readFileSync('lib/admin-dashboard/growthRevenue.ts', 'utf8')).toContain('af_intelligence_all:')
  })
})
