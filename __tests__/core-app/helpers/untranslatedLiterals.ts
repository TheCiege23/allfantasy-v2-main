/**
 * English prose literals in a server builder that no Spanish branch covers (2026-10-05).
 *
 * A builder that takes the reader's language writes each sentence as `es ? '…' : '…'`. This finds the
 * English literals that are NOT under such a choice — the sentence someone added without its Spanish.
 * A literal counts as covered when an ancestor is a conditional on the language (`es ? …`,
 * `isEs(…) ? …`, `language === 'es' ? …`), an `L(english, spanish)` call from `pickLanguage`, or a
 * value in a label map that has an `_ES` twin.
 */
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const LANG_CONDITION = /^(es|isEs\([^)]*\)|(input\.|league\.)?language === 'es')$/

function text(node: ts.Node, sf: ts.SourceFile): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((s) => `7${s.literal.text}`).join('')
  return null
}

/** English-looking prose: two or more words of letters, at least one of them a common English word. */
const ENGLISH_PROSE = /\b(the|and|this|that|has|have|with|no|not|is|are|was|be|of|for|to|in|on|at|yet|now|any|every|league|team|teams|manager|managers|move|moves|days?|ago|read|could|synced|open|review|set|run|waiver|waivers|trade|trades|draft|lineup|lineups|dues|vote|votes|score|data|activity|deadline|week|season|playoff|playoffs|claimed|active|needs|health|sync|you|owner)\b/i

export function untranslatedLiterals(file: string, opts: { ignore?: RegExp[] } = {}): string[] {
  const src = readFileSync(resolve(process.cwd(), file), 'utf8')
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const out: string[] = []
  const maps = new Set<string>()
  sf.forEachChild((n) => {
    if (ts.isVariableStatement(n)) for (const d of n.declarationList.declarations) if (ts.isIdentifier(d.name)) maps.add(d.name.text)
  })

  const covered = (node: ts.Node): boolean => {
    for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
      if (ts.isConditionalExpression(p) && LANG_CONDITION.test(p.condition.getText(sf).trim())) return true
      // `L(english, spanish)` from `pickLanguage` — covered only with BOTH arguments present.
      if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === 'L' && p.arguments.length === 2) return true
      if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && maps.has(`${p.name.text}_ES`)) return true
      if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && /_ES$/.test(p.name.text)) return true
    }
    return false
  }

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) return
    const t = text(node, sf)
    const parent = node.parent
    const isKey = parent && ts.isPropertyAssignment(parent) && parent.name === node
    if (t != null && !isKey && /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(t) && ENGLISH_PROSE.test(t) && !covered(node)) {
      if (!(opts.ignore ?? []).some((re) => re.test(t))) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
        out.push(`${file}:${line + 1}: ${t.slice(0, 120)}`)
      }
    }
    if (!ts.isTemplateExpression(node)) node.forEachChild(visit)
    else node.templateSpans.forEach((s) => visit(s.expression))
  }
  visit(sf)
  return out
}
