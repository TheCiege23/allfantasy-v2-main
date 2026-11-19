/**
 * No-AI customer-copy regression guard — dashboard surface (narrow scope, deliberately).
 *
 * Three separate screenshots this pass (Toolset, My Leagues, Rankings) each turned up a bare
 * "AI" label somewhere in dashboard customer-facing copy — the brand rule is to say Chimmy, never
 * AI. Three strikes is a systemic gap, not bad luck, so this scans the dashboard surface once
 * instead of waiting for the next screenshot. Mirrors customer-copy-neutrality.test.ts's
 * file-scan + allowlist mechanism, generalized from a hand-curated file list to a real directory
 * walk so newly-added dashboard components are covered automatically.
 *
 * Scope is deliberately narrow, not the whole app. A full-surface scan (components and app
 * generally) found 342 files with pre-existing "AI" copy — including a root-layout SEO title,
 * whole product areas literally named around "AI" (components/ai-hub, components/ai-tools,
 * app/ai, app/waiver-ai), and pages that likely need to say "AI" on purpose (app/ai-transparency,
 * app/mission). That's a real, separate product-branding decision, not a bug to auto-fix here.
 * This guard covers exactly what's already been fixed and the dashboard surface around it, so it
 * ships now and prevents regression there; expanding coverage elsewhere is a deliberate, later,
 * surface-by-surface decision — not an auto-apply.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

/**
 * WIDENED TO THE WHOLE APP 2026-11-17, owner's decision ("remove the AI wording from the rest of the
 * app"): every screen, component and translation says Chimmy. The header above describes the narrow
 * first version and why it was narrow; the product-branding decision it deferred has now been made.
 *
 * Kept OUT of scope, deliberately and by the same decision:
 *   - legal and disclosure pages (components/legal, app/ai-transparency, app/ai — the provider
 *     explainer), where "AI Output" / "AI Features" are defined terms and the use of AI is disclosed;
 *   - search-engine metadata (`metadata`, `generateMetadata`, openGraph/twitter, keywords), which keeps
 *     "AI" as a search keyword while the page itself says Chimmy — see `isMetadataLine` below;
 *   - app/api, whose remaining "AI" strings are instructions sent to the model, never rendered;
 *   - app/e2e test harnesses.
 */
const SCAN_ROOTS = ['app', 'components', 'lib/i18n']

/** Specific files outside SCAN_ROOTS that are part of the same dashboard surface (already fixed
 *  this pass) or return literal strings rendered to users despite living under app/api. */
const ADDITIONAL_INCLUDES = ['app/api/user/rank/route.ts', 'components/rankings/af-rankings-ui/AfRankingsUiKit.tsx']

const SCAN_EXTENSIONS = new Set(['.ts', '.tsx'])
const EXCLUDED_SEGMENTS = ['admin', 'dev', 'internal', '__tests__', 'node_modules', 'api', 'e2e', 'legal', 'ai-transparency']
/** Directories excluded by full path (a bare segment name would be too broad). */
const EXCLUDED_DIRS = new Set(['app/ai'])

/** Individual files that are dev/ops-only despite not living under an excluded directory —
 *  e.g. flag-gated debug panels. Reviewed case by case, not a blanket filename pattern. */
const EXCLUDED_FILES = new Set([
])

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (EXCLUDED_SEGMENTS.includes(entry.name)) continue
      if (EXCLUDED_DIRS.has(path.relative(ROOT, abs).split(path.sep).join('/'))) continue
      walk(abs, out)
    } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      if (entry.name.includes('.test.')) continue
      const rel = path.relative(ROOT, abs).split(path.sep).join('/')
      if (EXCLUDED_FILES.has(rel)) continue
      out.push(rel)
    }
  }
  return out
}

function isCommentOrImport(line: string): boolean {
  const t = line.trim()
  return t.startsWith('*') || t.startsWith('//') || t.startsWith('/*') || t.startsWith('import ') || t.startsWith('* ')
}

/** console.* arguments are server/debug-only, never rendered to a customer — a log line
 *  mentioning an internal feature name (e.g. "legacy AI report query failed") is not copy. */
function isConsoleCall(line: string): boolean {
  return /console\.(log|error|warn|info|debug)\s*\(/.test(line)
}

/** Case-sensitive on the AI token deliberately — this is what keeps the guard precise instead of
 *  blanket: lowercase substrings like email/available/again/detail/maintain/chain must never
 *  match. A few known phrases are checked case-insensitively as a backstop for template-built
 *  strings that might lowercase the token. */
const AI_TOKEN = /\bAI\b/
const KNOWN_PHRASES = /(AI Grade|AI insight|AI Import|AI-powered|AI recommendations?)/i

function findForbidden(quoted: string): boolean {
  return AI_TOKEN.test(quoted) || KNOWN_PHRASES.test(quoted)
}

/** JSX text content directly between tags on one line, e.g. `<span>AI</span>`. Deliberately simple
 *  (no JSX/AST parse, matching the mechanism of customer-copy-neutrality.test.ts). */
const JSX_TEXT = />([^<>{}\n]+)</g

/** JSX text nodes commonly land on their own line under Prettier, e.g.:
 *    <div ...>
 *      AI Grade
 *    </div>
 *  which JSX_TEXT's same-line match can't see (the `>` and `<` are on different lines) — this is
 *  the exact shape the original "AI Grade" bug took. A line with none of `<>{}"'`` on it, after
 *  comment/import/console lines are already excluded, is almost never anything but bare JSX text
 *  or a stray plain-text line — real code nearly always carries at least one of those characters. */
function isBareTextLine(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  return !/[<>{}"'`]/.test(t)
}

/**
 * REVIEWED exceptions. Every entry says why it's here — either a deliberate customer-facing "AI"
 * usage, or a specific, named open question (never a silent, undocumented pass).
 */
const ALLOWLIST: Record<string, string[]> = {
  // Disclosure copy: the trust block names and links the legal AI Transparency page, and says plainly
  // that recommendations are machine-generated. Same reasoning as brand-voice-chimmy-labels.test.ts.
  'app/ai/tools/AIToolsPageClient.tsx': ['AI Transparency', 'league management, AI analysis, and', 'AI recommendations are designed to support your decisions'],
  'app/war-room/page.tsx': ['AI Transparency'],
  // The mission page's transparency section: says the AI features are optional and links the legal page.
  'app/mission/page.tsx': ['AI Transparency', 'Our AI features are optional guidance', 'fully useful with AI turned off'],
  'components/landing/SeoLandingFooter.tsx': ['AI Transparency'],
}

/**
 * Search-engine metadata keeps "AI" (owner's decision, 2026-11-17). Skips the body of a `metadata`
 * export, a `generateMetadata` function and any openGraph / twitter / keywords block, by brace depth.
 * Returns a per-line mask: true means the line is metadata.
 */
const METADATA_START = /export const metadata\b|export (async )?function generateMetadata|\bopenGraph\s*:|\btwitter\s*:|\bkeywords\s*:|\b(title|description)\s*:\s*['"`].*\|\s*AllFantasy/
function metadataMask(lines: string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false)
  let depth: number | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (depth === null && !METADATA_START.test(line)) continue
    mask[i] = true
    const d = (depth ?? 0) + (line.match(/[{[]/g)?.length ?? 0) - (line.match(/[}\]]/g)?.length ?? 0)
    depth = d > 0 ? d : null
  }
  return mask
}

/**
 * JSX text that shares its line with tags or `{expressions}` — `<Bot /> AI Commissioner`,
 * `AI explanation ({result.type})`, `<span>📈</span> Waiver AI`. The three checks above cannot see
 * it: it is not quoted, it is not between `>` and `<` on one line, and the braces disqualify it as a
 * bare text line. 36 such labels survived the 2026-11-17 rewrite and this guard until it was added.
 *
 * Quoted strings are blanked first (their own check reads them), and only a standalone token counts:
 * `AI_FEATURES`, `isAI`, `.AI`, `AI(` and `AI:` / `AI =` (a key or a binding) are code.
 */
const BARE_AI_TOKEN = /(?<![.\w$])AI(?![\w$(])(?!\s*[:=.])/
function unquotedText(line: string): string | null {
  const t = line.trim()
  if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('import ') || isConsoleCall(line)) return null
  const code = line.split(' // ')[0]!.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""').replace(/\{\/\*.*?\*\/\}/g, '')
  return BARE_AI_TOKEN.test(code) ? code : null
}

/** Lines inside a multi-line `/* … *\/` or `{/* … *\/}` comment. */
function blockCommentMask(lines: string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false)
  let open = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (open) {
      mask[i] = true
      if (line.includes('*/')) open = false
      continue
    }
    const start = line.indexOf('/*')
    if (start >= 0 && !line.slice(start).includes('*/')) {
      open = true
      mask[i] = true
    }
  }
  return mask
}

function isAllowlisted(file: string, quoted: string): boolean {
  const entries = ALLOWLIST[file]
  if (!entries) return false
  return entries.some((allowed) => quoted.includes(allowed) || allowed.includes(quoted))
}

describe('no-AI customer-copy regression guard (whole app)', () => {
  const files = [...new Set([...SCAN_ROOTS.flatMap((root) => walk(path.join(ROOT, root))), ...ADDITIONAL_INCLUDES])]

  it('scanned a non-trivial dashboard surface (sanity check the walk itself)', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  for (const rel of files) {
    it(`${rel} renders no bare "AI" label in customer-facing copy`, () => {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
      const offenders: string[] = []
      const lines = src.split(/\r?\n/)
      const isMeta = metadataMask(lines)
      const inBlockComment = blockCommentMask(lines)
      for (const [idx, raw] of lines.entries()) {
        if (isMeta[idx]) continue
        if (isCommentOrImport(raw) || isConsoleCall(raw)) continue

        const quotedMatches = raw.match(/["'`]([^"'`]*)["'`]/g) ?? []
        for (const q of quotedMatches) {
          const inner = q.slice(1, -1)
          if (findForbidden(inner) && !isAllowlisted(rel, inner)) offenders.push(`quoted: ${inner.trim()}`)
        }

        let m: RegExpExecArray | null
        const jsxRe = new RegExp(JSX_TEXT.source, 'g')
        while ((m = jsxRe.exec(raw)) !== null) {
          const text = m[1]!.trim()
          if (!text) continue
          if (findForbidden(text) && !isAllowlisted(rel, text)) offenders.push(`jsx text: ${text}`)
        }

        if (isBareTextLine(raw)) {
          const text = raw.trim()
          if (findForbidden(text) && !isAllowlisted(rel, text)) offenders.push(`bare text line: ${text}`)
        }

        if (rel.endsWith('.tsx') && !inBlockComment[idx]) {
          const text = unquotedText(raw)
          if (text !== null && !isAllowlisted(rel, raw.trim())) offenders.push(`jsx text beside code: ${raw.trim()}`)
        }
      }
      expect(offenders, offenders.join('\n')).toEqual([])
    })
  }
})
