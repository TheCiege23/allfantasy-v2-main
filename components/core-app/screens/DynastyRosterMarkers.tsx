'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { defineMessages } from '@/lib/i18n/messages'
import { RISING_THROUGH, type DynastyRosterMarker } from '@/lib/core-app/dynastyRosterMarkers'
import '@/components/core-app/af-my-team-dynasty.css'

/**
 * My Team's dynasty roster markers (lib/core-app/dynastyRosterMarkers.ts): an age chip toned by the
 * player's career arc and a ROOKIE badge, on every row of a dynasty league's lineup, bench, IR and
 * taxi squad, plus the one-line key that explains the tones.
 *
 * Provided once at the screen root rather than threaded through PlayerCell, BenchRow and every call
 * site — the same reasoning MyTeam gives for `PlayerCardLeagueScope`. A non-dynasty league provides
 * null, and every marker renders nothing.
 */

export const dynastyRosterMessages = defineMessages({
  en: {
    rookie: 'Rookie',
    rookieTitle: 'No completed pro season on file.',
    ageAria: (age: number) => `Age ${age}`,
    risingTitle: (age: number) => `Age ${age}: ${RISING_THROUGH} or younger, still rising.`,
    primeTitle: (age: number) => `Age ${age}: in his prime years.`,
    agingTitle: (age: number, from: number) => `Age ${age}: at or past ${from}, when this position’s production usually starts to fall. A rule of thumb, not a projection.`,
    keyLabel: 'Dynasty age',
    keyRising: (n: number) => `${n} and under · rising`,
    keyPrime: 'Prime',
    keyAging: 'Past usual peak for the position',
    keyRookie: 'No pro season yet',
  },
  es: {
    rookie: 'Novato',
    rookieTitle: 'Sin temporadas profesionales completas registradas.',
    ageAria: (age) => `Edad ${age}`,
    risingTitle: (age) => `Edad ${age}: ${RISING_THROUGH} o menos, aún en ascenso.`,
    primeTitle: (age) => `Edad ${age}: en sus mejores años.`,
    agingTitle: (age, from) => `Edad ${age}: en o después de ${from}, cuando la producción de esta posición suele empezar a caer. Es una regla general, no una proyección.`,
    keyLabel: 'Edad dinastía',
    keyRising: (n) => `${n} o menos · en ascenso`,
    keyPrime: 'Plenitud',
    keyAging: 'Pasado su mejor edad para la posición',
    keyRookie: 'Aún sin temporada profesional',
  },
})

const MarkersContext = createContext<Record<string, DynastyRosterMarker> | null>(null)

export function DynastyMarkersScope({ markers, children }: { markers: Record<string, DynastyRosterMarker> | null | undefined; children: ReactNode }) {
  return <MarkersContext.Provider value={markers ?? null}>{children}</MarkersContext.Provider>
}

/** Whether this screen shows markers at all (a dynasty league with at least one on file). */
export function useHasDynastyMarkers(): boolean {
  const markers = useContext(MarkersContext)
  return !!markers && Object.keys(markers).length > 0
}

/** The markers for one row, beside the player's name. Nothing when there is nothing agreed on file. */
export function DynastyRowMarkers({ sleeperId }: { sleeperId: string }) {
  const markers = useContext(MarkersContext)
  const m = useMessages(dynastyRosterMessages)
  const mark = markers?.[sleeperId]
  if (!mark) return null
  const title =
    mark.age == null
      ? undefined
      : mark.tone === 'aging' && mark.agingFrom != null
        ? m.agingTitle(mark.age, mark.agingFrom)
        : mark.tone === 'rising'
          ? m.risingTitle(mark.age)
          : m.primeTitle(mark.age)
  return (
    <span className="af-mt-dyn" data-testid="dynasty-row-markers">
      {mark.age != null ? (
        <span className="af-mt-dyn-age" data-tone={mark.tone ?? undefined} title={title} aria-label={title ?? m.ageAria(mark.age)}>
          {mark.age}
        </span>
      ) : null}
      {mark.rookie ? (
        <span className="af-mt-dyn-rookie" title={m.rookieTitle}>
          {m.rookie}
        </span>
      ) : null}
    </span>
  )
}

/** One line under the Starters heading that says what the tones mean. */
export function DynastyAgeKey() {
  const has = useHasDynastyMarkers()
  const m = useMessages(dynastyRosterMessages)
  if (!has) return null
  return (
    <p className="af-mt-dyn-key" data-testid="dynasty-age-key">
      <span className="af-mt-dyn-key-label">{m.keyLabel}</span>
      <span className="af-mt-dyn-key-item">
        <span className="af-mt-dyn-age" data-tone="rising" aria-hidden>
          23
        </span>
        {m.keyRising(RISING_THROUGH)}
      </span>
      <span className="af-mt-dyn-key-item">
        <span className="af-mt-dyn-age" data-tone="prime" aria-hidden>
          27
        </span>
        {m.keyPrime}
      </span>
      <span className="af-mt-dyn-key-item">
        <span className="af-mt-dyn-age" data-tone="aging" aria-hidden>
          30
        </span>
        {m.keyAging}
      </span>
      <span className="af-mt-dyn-key-item">
        <span className="af-mt-dyn-rookie" aria-hidden>
          {m.rookie}
        </span>
        {m.keyRookie}
      </span>
    </p>
  )
}
