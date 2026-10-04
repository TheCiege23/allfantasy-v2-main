import type { CardFreshnessStamp } from './cardFreshness'
import { ageText } from './shellCopy'

/**
 * The /core home's freshness stamps in the reader's language (2026-10-04).
 *
 * Every stamp is built on the SERVER (HomeCards.tsx, `leagueDataStamp`), which does not know the
 * reader's language, so its `source` is English and it carries `parts` — what that source was built
 * from. This rebuilds the Spanish at render, in the client, where the language is known. The age goes
 * through shellCopy's `ageText`, the one /core translator for "… ago".
 *
 * A stamp without `parts`, or with a missing-label this does not know, returns null and the caller
 * renders it in English as written — a whole English stamp, never half of one. PURE, client-safe.
 */

export type StampText = {
  /** What the time describes. */
  source: string
  /** The word before the age: "updated" / "actualizado(s)" / "revisado". */
  updated: string
  /** After the age — Spanish puts the excluded-connections clause last; English carries it in `source`. */
  after: string
  /** What to say when the stamp holds no time. */
  missing: string
  /** The screen-reader note on a stale stamp. */
  outOfDate: string
  /** The age in this language. */
  age: (english: string) => string
}

const MISSING_ES: Record<string, string> = {
  'not read yet': 'aún sin leer',
  'none yet': 'todavía no hay',
  'history retained': 'historial conservado',
}

export function stampText(stamp: CardFreshnessStamp, language: string): StampText | null {
  if (language !== 'es') {
    return { source: stamp.source, updated: 'updated', after: '', missing: stamp.missingLabel, outOfDate: 'out of date', age: (a) => a }
  }
  const p = stamp.parts
  const missing = MISSING_ES[stamp.missingLabel]
  if (!p || !missing) return null
  const base = { after: '', missing, outOfDate: 'desactualizado', age: (a: string) => ageText(a, 'es') }
  switch (p.kind) {
    case 'injuries':
      return { ...base, source: 'Parte de lesiones', updated: 'revisado' }
    case 'summary':
      return { ...base, source: 'Resumen', updated: 'actualizado' }
    case 'scores':
      return { ...base, source: 'Marcador', updated: 'actualizado' }
    case 'sync-paused':
      return { ...base, source: 'Sincronización de la cuenta en pausa', updated: 'actualizada' }
    case 'league-data': {
      const unread = p.neverRead > 0 ? `${p.neverRead} ${p.neverRead === 1 ? 'liga nunca leída' : 'ligas nunca leídas'} · ` : ''
      const what = `${p.active ? 'Datos de ligas activas' : 'Datos de liga'}${p.oldest ? ' más antiguos' : ''}`
      const after =
        p.paused > 0 ? ` · ${p.paused} ${p.paused === 1 ? 'conexión en pausa excluida' : 'conexiones en pausa excluidas'}` : ''
      return { ...base, source: `${unread}${what}`, updated: 'actualizados', after }
    }
    default:
      return null
  }
}
