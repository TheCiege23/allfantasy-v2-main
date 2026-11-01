import type { ImportAuditSummary } from '@/lib/devy/mergeExecutionEngine'
import { translations } from '@/lib/i18n/translations'
import { tInterpolate } from '@/lib/i18n/tInterpolate'
import { localizeMergeMessage } from '@/app/devy/lib/importWizardModel'

export type ImportAuditTextOptions = {
  /** The reader's language. Omitted or 'en' gives the English file this function has always written. */
  language?: string
  /** The page's `t` (from useOptionalLanguage). Without it the bundled dictionary is read directly. */
  t?: (key: string) => string
}

function dictionaryT(language: string): (key: string) => string {
  return (key: string) => translations[language]?.[key] ?? translations.en[key] ?? key
}

/**
 * The downloadable audit `.txt`, in the reader's language.
 *
 * Labels come from `devyImport.auditText.*`. In English the values are written exactly as before:
 * the raw status and confidence codes and the engine's own notes. In any other language those
 * values are translated too (status, confidence level, the notes the merge engine is known to
 * write); a value with no translation is written as it is.
 */
export function formatImportAuditPlainText(
  audit: ImportAuditSummary,
  session: { id: string; status: string; mergedAt: string | null; summary?: unknown },
  options: ImportAuditTextOptions = {},
): string {
  const language = options.language ?? 'en'
  const t = options.t ?? dictionaryT(language)
  const tr = (key: string, vars?: Record<string, string | number>) => tInterpolate(t, key, vars ?? {})
  const localizeValues = language !== 'en'
  const value = (key: string, raw: string) => {
    if (!localizeValues) return raw
    const out = t(key)
    return out && out !== key ? out : raw
  }
  const note = (n: string) => (localizeValues ? localizeMergeMessage(n, tr) : n)

  const title = tr('devyImport.auditText.title')
  const none = tr('devyImport.auditText.none')
  const lines: string[] = [
    title,
    '='.repeat(title.length),
    '',
    tr('devyImport.auditText.sessionId', { id: session.id }),
    tr('devyImport.auditText.status', { status: value(`devyImport.status.${session.status}`, session.status) }),
    tr('devyImport.auditText.mergedAt', { date: session.mergedAt ?? '—' }),
    '',
    tr('devyImport.auditText.summary'),
    tr('devyImport.auditText.confidence', {
      level: value(`devyImport.audit.level.${audit.dataConfidenceScore}`, audit.dataConfidenceScore),
    }),
    tr('devyImport.auditText.playersImported', { count: audit.playersImported }),
    tr('devyImport.auditText.conflictsResolved', { count: audit.conflictsResolved }),
    tr('devyImport.auditText.conflictsPending', { count: audit.conflictsPending }),
    tr('devyImport.auditText.managersMatched', { count: audit.managersMatched }),
    tr('devyImport.auditText.seasons', { count: audit.historySeasonsImported }),
    tr('devyImport.auditText.picks', { count: audit.picksImported }),
    '',
    tr('devyImport.auditText.unmatchedPlayers'),
  ]
  if (audit.unmatchedPlayers.length === 0) lines.push(none)
  else for (const p of audit.unmatchedPlayers) lines.push(`- ${p.name} (${p.id})`)

  lines.push('', tr('devyImport.auditText.managersNeedingLink'))
  if (audit.managersUnmatched.length === 0) lines.push(none)
  else for (const m of audit.managersUnmatched) lines.push(`- ${m.label} (${m.id})`)

  lines.push('', tr('devyImport.auditText.notes'))
  if (audit.notes.length === 0) lines.push(none)
  else for (const n of audit.notes) lines.push(`- ${note(n)}`)

  if (audit.missingImages.length || audit.missingSchoolLogos.length) {
    lines.push('', tr('devyImport.auditText.assets'))
    lines.push(tr('devyImport.auditText.missingImages', { count: audit.missingImages.length }))
    lines.push(tr('devyImport.auditText.missingSchoolLogos', { count: audit.missingSchoolLogos.length }))
  }

  if (session.summary != null) {
    lines.push('', tr('devyImport.auditText.rawSummary'))
    try {
      lines.push(JSON.stringify(session.summary, null, 2))
    } catch {
      lines.push(String(session.summary))
    }
  }

  lines.push('', tr('devyImport.auditText.end'))
  return lines.join('\n')
}
