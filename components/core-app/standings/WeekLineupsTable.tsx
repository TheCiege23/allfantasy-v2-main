"use client"

import type { StandingsLineups } from '@/lib/core-app/standingsLineups'
import '@/components/core-app/af-standings.css'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { PROJECTION_PROVIDER_LABEL } from '@/lib/core-app/projectionProvider'

/**
 * This week's lineups, projected — every team, AllFantasy's engine (AF) beside Sleeper's (labelled
 * "API" until 2026-10-03; see projectionProvider.ts).
 * Shared by the Standings screen and the league Season Outlook.
 *
 * ⚠ A PROJECTION OF THE COMING WEEK, NOT A STANDING. The caller's `caveat` says what this is NOT
 * (the points table, the simulated odds). A total built from part of a lineup shows its coverage
 * rather than passing for a whole one, and an unpriced side is a dash, never 0.
 *
 * `import type` only from the server module: this file is client-safe.
 */
export function WeekLineupsTable({ lineups, caveat }: { lineups: StandingsLineups; caveat: string }) {
  const language = useOptionalLanguage().language
  const copy = (value: string) => coreUiCopy(value, language)
  return (
    <section className="af-st-section af-st-lineups" aria-labelledby="af-st-lu-h">
      <h2 className="af-label af-st-seclabel" id="af-st-lu-h">
        {copy('This week’s lineups, projected')} · {copy('week')} {lineups.week}
      </h2>
      <WeekLineupsBody lineups={lineups} caveat={caveat} />
    </section>
  )
}

/** The note and the table without the section and heading — for a host that supplies its own. */
export function WeekLineupsBody({ lineups, caveat }: { lineups: StandingsLineups; caveat: string }) {
  const language = useOptionalLanguage().language
  const copy = (value: string) => coreUiCopy(value, language)
  const cell = (v: number | null, from: number, of: number) =>
    v == null ? (
      <span className="af-st-lu-none">—</span>
    ) : (
      <>
        {v.toFixed(1)}
        {from < of ? <span className="af-st-lu-cov"> {from}/{of}</span> : null}
      </>
    )
  return (
    <>
      <p className="af-st-lu-note">
        {language === 'es'
          ? `La alineación actual de cada equipo, proyectada para la semana ${lineups.week} con las reglas de esta liga. AF es la proyección de AllFantasy; ${PROJECTION_PROVIDER_LABEL} es la de ${PROJECTION_PROVIDER_LABEL}. Es un pronóstico: ${copy(caveat)}`
          : `Each team’s lineup as currently set, projected for week ${lineups.week} under this league’s scoring. AF is AllFantasy’s own projection engine; ${PROJECTION_PROVIDER_LABEL} is ${PROJECTION_PROVIDER_LABEL}’s own projection. A forecast of the coming week — ${caveat}`}
      </p>
      <table className="af-st-lu-table">
        <thead>
          <tr>
          <th scope="col">{copy('Team')}</th>
            <th scope="col" className="af-num">AF</th>
            <th scope="col" className="af-num">{PROJECTION_PROVIDER_LABEL}</th>
          </tr>
        </thead>
        <tbody>
          {lineups.rows.map((r) => (
            <tr key={r.rosterId} data-you={r.isYou ? 'true' : undefined}>
              <th scope="row">
                {r.name ?? `${copy('Team')} ${r.rosterId}`}
                {r.isYou ? <span className="af-st-lu-you"> · {copy('you')}</span> : null}
              </th>
              <td className="af-num af-st-lu-af">{cell(r.af, r.afFrom, r.starterCount)}</td>
              <td className="af-num">{cell(r.api, r.apiFrom, r.starterCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
