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

/** Deliberately narrow — see file header. Recursively walked. */
const SCAN_ROOTS = ['app/dashboard']

/** Specific files outside SCAN_ROOTS that are part of the same dashboard surface (already fixed
 *  this pass) or return literal strings rendered to users despite living under app/api. */
const ADDITIONAL_INCLUDES = ['app/api/user/rank/route.ts', 'components/rankings/af-rankings-ui/AfRankingsUiKit.tsx']

const SCAN_EXTENSIONS = new Set(['.ts', '.tsx'])
const EXCLUDED_SEGMENTS = ['admin', 'dev', 'internal', '__tests__', 'node_modules']

/** Individual files that are dev/ops-only despite not living under an excluded directory —
 *  e.g. flag-gated debug panels. Reviewed case by case, not a blanket filename pattern. */
const EXCLUDED_FILES = new Set([
  // Gated by NEXT_PUBLIC_CHIMMY_INTELLIGENCE_DEBUG=1, returns null otherwise; own header comment
  // calls it a "Developer/admin debug surface." Never rendered to a customer in production.
  'app/dashboard/components/DashboardIntelligenceDebugPanel.tsx',
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
  // "Waiver AI" and "AI Trade Analyzer" are used consistently as peer feature names (see
  // app/trade-evaluator/page.tsx's own "AI Trade Analyzer" badge next to its "Trade Hub" heading)
  // — these read like established feature names, not a generic AI label that clearly should say
  // Chimmy instead. Open product-naming question, not fixed in this pass; allowlisted rather than
  // guessed at.
  'app/dashboard/components/AIToolsModal.tsx': ['Pick a league for waiver AI targets.', 'Open AI Trade Analyzer'],
  'app/dashboard/components/LegacyToolsetGrid.tsx': ['Waiver AI'],
}

function isAllowlisted(file: string, quoted: string): boolean {
  const entries = ALLOWLIST[file]
  if (!entries) return false
  return entries.some((allowed) => quoted.includes(allowed) || allowed.includes(quoted))
}

describe('no-AI customer-copy regression guard (dashboard surface)', () => {
  const files = [...new Set([...SCAN_ROOTS.flatMap((root) => walk(path.join(ROOT, root))), ...ADDITIONAL_INCLUDES])]

  it('scanned a non-trivial dashboard surface (sanity check the walk itself)', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  for (const rel of files) {
    it(`${rel} renders no bare "AI" label in customer-facing copy`, () => {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
      const offenders: string[] = []
      const lines = src.split(/\r?\n/)
      for (const raw of lines) {
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
      }
      expect(offenders, offenders.join('\n')).toEqual([])
    })
  }
})
