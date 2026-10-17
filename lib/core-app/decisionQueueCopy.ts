import type { CoreIssue, CoreIssueParts } from './outstandingIssues'
import { coreUiCopy } from './coreUiCopy'
import { kickoffText, weekdayEs } from './kickoffText'
import { kickoffClock } from './lineupLock'
import { verificationStamp } from './lineupVerification'
import { ageText } from './shellCopy'

/**
 * The /core home's decision queue in Spanish (2026-10-04).
 *
 * Every issue is written on the SERVER (`deriveOutstandingIssues`, `mergeDash34Issues`), which does not
 * know the reader's language, so each one carries `parts` — the values its English sentence was built
 * from — and this rebuilds the sentence in Spanish at render, in the client, where the language is known.
 *
 * ⚠ NO SENTENCE IS TRANSLATED BY PATTERN. The kickoff travels as an instant and is formatted here with
 * the same pinned `kickoffClock` the server used, then put through `kickoffText`, the one /core kickoff
 * translator; an injury designation goes through `coreUiCopy`'s table; the age through shellCopy's `ageText`.
 *
 * An issue without `parts` (a producer this does not know) returns null and the queue renders its
 * English as written — a whole English row, never half of one. PURE, client-safe.
 */

export type IssueText = { title: string; meta: string; actionLabel: string | null }

const EN_WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const EN_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** The draft row's UTC instant — the English row prints `toUTCString()` ("Sat, 04 Oct 2026 17:00"). */
function draftWhenEs(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  // "Oct 4" → "4 oct" through the shared translator, so the month names live in one table.
  const dayMonth = kickoffText(`${EN_MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`, 'es')
  return `${weekdayEs(EN_WEEKDAY[d.getUTCDay()]!)}, ${dayMonth} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

function stamp(checkedAt: string | null): string {
  return checkedAt ? ` · ${verificationStamp(checkedAt, 'es')}` : ''
}

function textOf(p: CoreIssueParts): IssueText | null {
  switch (p.kind) {
    case 'draft-upcoming': {
      const when = draftWhenEs(p.at)
      if (!when) return null
      return {
        title: `${p.today ? 'Draft hoy' : 'Draft próximo'} — ${p.leagueName}`,
        meta: `${p.platform} › Draft · ${when} UTC`,
        actionLabel: p.actionPlatform ? `Abrir en ${p.actionPlatform}` : null,
      }
    }
    case 'stale': {
      const ago = p.lastReadAgo ? ageText(p.lastReadAgo, 'es') : null
      return {
        title: `Datos de la liga desactualizados — ${p.leagueName}`,
        meta: `${p.platform} › Sincronización · ${ago ? `última lectura ${ago}` : 'nunca leída'}`,
        actionLabel: p.actionPlatform ? `Abrir en ${p.actionPlatform}` : null,
      }
    }
    case 'stale-aggregate':
      return {
        title: p.neverRead ? `${p.count} ligas nunca se han leído` : `${p.count} ligas tienen datos desactualizados`,
        meta: `${p.platforms.length === 1 ? p.platforms[0] : `${p.platforms.length} plataformas`} › Sincronización · todavía no se ha leído nada de estas ligas`,
        actionLabel: null,
      }
    case 'empty-slot':
      return {
        title: `${p.count} ${p.count === 1 ? 'puesto titular vacío' : 'puestos titulares vacíos'} — ${p.leagueName}`,
        meta: `${p.platform} › Alineación · un puesto sin nadie anota cero${stamp(p.checkedAt)}`,
        actionLabel: 'Completar el puesto',
      }
    case 'best-ball':
      return {
        title: `Cobertura del plantel best ball — ${p.leagueName}`,
        meta: `El plantel elegible no cubre ${p.missing.join(', ')}. Revisa reemplazos en agentes libres; tu alineación se elige automáticamente.`,
        actionLabel: 'Revisar agentes libres',
      }
    case 'starter-out': {
      const multiple = p.flaggedCount > 1
      const status = p.flagged ? coreUiCopy(p.flagged.status, 'es') : null
      const clock = p.kickoffAt ? kickoffClock(p.kickoffAt) : ''
      return {
        title: multiple
          ? `${p.flaggedCount} titulares que no pueden jugar — ${p.leagueName}`
          : p.flagged
            ? `${p.flagged.name} · ${p.flagged.slot} · ${status} — ${p.leagueName}`
            : `Titular que no puede jugar — ${p.leagueName}`,
        meta:
          `${p.platform} › Alineación${p.week != null ? ` · Semana ${p.week}` : ''} · ` +
          (multiple ? 'Revisa todos los puestos titulares señalados' : p.flagged ? `Figura como ${status} en tu alineación titular` : 'un titular está descartado') +
          (clock ? ` · ${multiple ? 'el primer titular señalado ' : ''}empieza ${kickoffText(clock, 'es')}` : '') +
          stamp(p.checkedAt),
        actionLabel: multiple ? 'Revisar titulares señalados' : p.flagged ? `Revisar a ${p.flagged.name}` : 'Ver quién está señalado',
      }
    }
    case 'drafting':
      return {
        title: `El draft está en vivo — ${p.leagueName}`,
        meta: `${p.platform} › Draft · en curso ahora`,
        actionLabel: `Abrir el ${coreUiCopy('Draft HQ', 'es')}`,
      }
    default:
      return null
  }
}

/** The issue in the reader's language: Spanish rebuilt from its parts, or its English as written. */
export function issueText(issue: CoreIssue, language: string): IssueText {
  const english: IssueText = { title: issue.title, meta: issue.meta, actionLabel: issue.action?.label ?? null }
  if (language !== 'es' || !issue.parts) return english
  const es = textOf(issue.parts)
  if (!es) return english
  // An action the parts cannot name keeps its English label rather than dropping the button's text.
  return { ...es, actionLabel: issue.action ? (es.actionLabel ?? issue.action.label) : null }
}
