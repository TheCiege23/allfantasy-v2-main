'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { defineMessages } from '@/lib/i18n/messages'
import { RISING_THROUGH, type DynastyRosterMarker } from '@/lib/core-app/dynastyRosterMarkers'
import '@/components/core-app/af-my-team-dynasty.css'

/**
 * Dynasty roster markers (lib/core-app/dynastyRosterMarkers.ts): an age chip toned by the player's
 * career arc, a ROOKIE badge and — devy / C2C leagues — a violet PROSPECT tag, beside a player's name
 * in a dynasty league, plus the one-line key that explains the tones.
 *
 * Provided once at the screen root rather than threaded through every row — the same reasoning MyTeam
 * gives for `PlayerCardLeagueScope`. A non-dynasty league provides null, and every marker renders
 * nothing. Used by My Team, the Waivers "Worth adding" board and Player Finder results; the player card
 * carries its own marker in its payload and draws it with `DynastyMarkerChips`.
 */

const dynastyRosterMessages = defineMessages({
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
    prospect: 'Prospect',
    prospectTitle: 'College prospect on a devy roster: not yet in the pros.',
    keyProspect: 'College prospect',
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
    prospect: 'Prospecto',
    prospectTitle: 'Prospecto universitario en una plantilla devy: aún no es profesional.',
    keyProspect: 'Prospecto universitario',
  },
})

const MarkersContext = createContext<Record<string, DynastyRosterMarker> | null>(null)

export function DynastyMarkersScope({ markers, children }: { markers: Record<string, DynastyRosterMarker> | null | undefined; children: ReactNode }) {
  return <MarkersContext.Provider value={markers ?? null}>{children}</MarkersContext.Provider>
}

/** Whether this screen shows markers at all (a dynasty league with at least one on file). */
function useHasDynastyMarkers(): boolean {
  const markers = useContext(MarkersContext)
  return !!markers && Object.keys(markers).length > 0
}

/** This row's marker from the screen's scope, or null (non-dynasty league, or nothing agreed on file). */
function useDynastyMarker(key: string | null | undefined): DynastyRosterMarker | null {
  const markers = useContext(MarkersContext)
  return key ? (markers?.[key] ?? null) : null
}

/** The markers for one row, beside the player's name. Nothing when there is nothing agreed on file. */
export function DynastyRowMarkers({ sleeperId }: { sleeperId: string | null | undefined }) {
  const mark = useDynastyMarker(sleeperId)
  return <DynastyMarkerChips mark={mark} />
}

/**
 * A player's name with the chips after it, for a list row (Waivers, Player Finder). Without a marker it
 * renders `children` exactly as given — no wrapper — so a non-dynasty row's DOM is unchanged.
 */
export function DynastyNameLine({ markerKey, children }: { markerKey: string | null | undefined; children: ReactNode }) {
  const mark = useDynastyMarker(markerKey)
  if (!mark) return <>{children}</>
  return (
    <span className="af-dyn-name-line">
      {children}
      <DynastyMarkerChips mark={mark} />
    </span>
  )
}

/**
 * The chips themselves, from one marker — for a surface that holds its marker directly rather than in a
 * screen scope (the player card, whose payload carries its own). Null renders nothing.
 */
export function DynastyMarkerChips({ mark, className }: { mark: DynastyRosterMarker | null | undefined; className?: string }) {
  const m = useMessages(dynastyRosterMessages)
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
    <span className={`af-mt-dyn${className ? ` ${className}` : ''}`} data-testid="dynasty-row-markers">
      {mark.age != null ? (
        <span className="af-mt-dyn-age" data-tone={mark.tone ?? undefined} title={title} aria-label={title ?? m.ageAria(mark.age)}>
          {mark.age}
        </span>
      ) : null}
      {/* A prospect has not turned pro, which is a different fact from "no pro season yet". */}
      {mark.prospect ? (
        <span className="af-mt-dyn-prospect" title={m.prospectTitle} data-testid="dynasty-prospect">
          {m.prospect}
        </span>
      ) : mark.rookie ? (
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
  const markers = useContext(MarkersContext)
  const m = useMessages(dynastyRosterMessages)
  if (!has) return null
  const hasProspect = Object.values(markers ?? {}).some((mk) => mk.prospect)
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
      {/* Devy / C2C only: shown when the screen has a prospect on it. */}
      {hasProspect ? (
        <span className="af-mt-dyn-key-item">
          <span className="af-mt-dyn-prospect" aria-hidden>
            {m.prospect}
          </span>
          {m.keyProspect}
        </span>
      ) : null}
    </p>
  )
}
