'use client'

import { CoreDepthLock, FreeUntilNote } from '@/components/core-app/CoreDepthLock'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import type { DraftEdge } from '@/lib/competitive-edge/draftEdge'
import type { EdgeFact } from '@/lib/competitive-edge/tradeEdge'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'

/*
 * Competitive Edge on Draft HQ: what each other manager has actually taken in this league's past
 * drafts (lib/competitive-edge/draftEdge.ts holds the contract). Counts, never a label, and never a
 * guess at what they will take next.
 *
 * The page loads it only for a viewer whose plan includes it; the lock here only decides what is drawn.
 */

export type DraftEdgeState = { available: true; data: DraftEdge } | { available: false; reason: string }

function range(seasons: number[]): string {
  if (seasons.length === 0) return ''
  return seasons[0] === seasons[seasons.length - 1] ? `${seasons[0]}` : `${seasons[0]}–${seasons[seasons.length - 1]}`
}

function factCopy(fact: EdgeFact, language: string): string {
  if (language !== 'es') return fact.text
  if (fact.key === 'draft.record') {
    if (fact.text.endsWith("has no picks on file in this league's drafts.")) {
      return `${fact.text.slice(0, -" has no picks on file in this league's drafts.".length)} no tiene selecciones registradas en los drafts de esta liga.`
    }
    const match = fact.text.match(/^(.+) drafted in (\d+) of the (\d+) drafts on file \(([^)]+)\), (\d+) picks? in all\.$/)
    if (match) return `${match[1]} participó en ${match[2]} de los ${match[3]} drafts registrados (${match[4]}), con ${match[5]} selecciones en total.`
  }
  if (fact.key.startsWith('draft.first_round.')) {
    const match = fact.text.match(/^Their first-round pick was at (.+) in (\d+) of their (\d+) drafts\.$/)
    if (match) return `Su primera selección fue de ${match[1]} en ${match[2]} de sus ${match[3]} drafts.`
  }
  if (fact.key.startsWith('draft.early.')) {
    const match = fact.text.match(/^In rounds 1–(\d+), (\d+) of their (\d+) picks were (.+)\.$/)
    if (match) return `En las rondas 1 a ${match[1]}, ${match[2]} de sus ${match[3]} selecciones fueron de ${match[4].replace(/s$/, '')}.`
  }
  if (fact.key === 'draft.qb_early') {
    const none = fact.text.match(/^They haven't taken a QB in rounds 1–(\d+) in any of their (\d+) drafts\.$/)
    if (none) return `No eligió un QB en las rondas 1 a ${none[1]} en ninguno de sus ${none[2]} drafts.`
    const match = fact.text.match(/^They took a QB in rounds 1–(\d+) in (\d+) of their (\d+) drafts\.$/)
    if (match) return `Eligió un QB en las rondas 1 a ${match[1]} en ${match[2]} de sus ${match[3]} drafts.`
  }
  return fact.text
}

function reasonCopy(reason: string, language: string): string {
  if (language !== 'es') return reason
  const platform = reason.match(/^Competitive Edge reads Sleeper draft history today\. (.+) leagues aren't connected yet\.$/)
  if (platform) return `Competitive Edge utiliza el historial de drafts de Sleeper. Las ligas de ${platform[1]} todavía no están conectadas.`
  return coreUiCopy(reason, language)
}

export function DraftCompetitiveEdge({
  access,
  edge,
}: {
  access: CoreDepthAccess | null
  edge: DraftEdgeState | null | undefined
}) {
  const language = useOptionalLanguage().language
  const copy = (value: string) => coreUiCopy(value, language)
  if (access && !access.unlocked) return <CoreDepthLock access={access} what="Competitive Edge" />
  if (!edge) return null

  const head = (
    <header className="af-dh-section-head">
      <h2 className="af-label">{copy('Competitive Edge · how the others draft')}</h2>
      {access ? <FreeUntilNote access={access} /> : null}
    </header>
  )

  if (!edge.available) {
    return (
      <section className="af-frame af-dh-section af-dh-edge" data-testid="draft-competitive-edge">
        {head}
        <p className="af-dh-unavailable">{reasonCopy(edge.reason, language)}</p>
      </section>
    )
  }

  const { rivals, coverage } = edge.data
  return (
    <section className="af-frame af-dh-section af-dh-edge" data-testid="draft-competitive-edge">
      {head}
      {coverage.seasons.length === 0 ? (
        <p className="af-dh-unavailable">
          {copy("No picks in this league's drafts are matched to their managers yet, so there is nothing to count.")}
        </p>
      ) : (
        <ul className="af-dh-edge-rivals">
          {rivals.map((r) => (
            <li key={r.manager.teamExternalId} className="af-dh-edge-rival" data-testid={`draft-edge-rival-${r.manager.teamExternalId}`}>
              <div className="af-dh-edge-name">{r.manager.name}</div>
              <ul className="af-dh-edge-facts">
                {r.facts.map((f) => (
                  <li key={f.key}>{factCopy(f, language)}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <p className="af-dh-edge-note" data-testid="draft-competitive-edge-basis">
        {language === 'es'
          ? `Datos de los drafts de Sleeper de esta liga${coverage.seasons.length > 0 ? ` (${range(coverage.seasons)})` : ''}, asignados al mánager de cada equipo en esa temporada.${coverage.unattributedSeasons.length > 0 ? ` Las selecciones de ${coverage.unattributedSeasons.join(', ')} aún no se pueden asignar y quedan fuera.` : ''} Muestra lo que hicieron, no lo que elegirán.`
          : `Counted from this league's Sleeper drafts${coverage.seasons.length > 0 ? ` (${range(coverage.seasons)})` : ''}, matched to the manager who owned each team that season.${coverage.unattributedSeasons.length > 0 ? ` Picks from ${coverage.unattributedSeasons.join(', ')} aren't matched to a manager yet, so those drafts are left out.` : ''} It shows what they did, not what they'll take.`}
      </p>
    </section>
  )
}
