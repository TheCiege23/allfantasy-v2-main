'use client'

import { lineupPairText, lineupProjectionFor, type WeekLineups } from '@/lib/core-app/weekLineups'
import '@/components/core-app/af-week-lineup.css'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'

/**
 * One line of this week's LINEUP projections under a Your Week matchup: "Lineup proj · AF
 * 121.5–115.0 · API 118.2–112.4". Renders nothing when neither source priced the matchup for its own
 * week — see `lineupProjectionFor`.
 *
 * Labelled "Lineup proj" on purpose: the card above it prints the week model's team-average
 * projection and win probability, which is a different measure, and the two must not read as one.
 */
export function WeekLineupLine({
  lineups,
  leagueId,
  season,
  week,
}: {
  lineups: WeekLineups | null | undefined
  leagueId: string
  season: number
  week: number
}) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  const v = lineupProjectionFor(lineups, leagueId, season, week)
  if (!v) return null
  return (
    <span
      className="af-wk-lineup af-num"
      title={language === 'es'
        ? `Proyecciones de las alineaciones de esta semana: suman a los jugadores titulares con la puntuación de esta liga. AF es la proyección de AllFantasy; API es la del proveedor. Es una medida distinta de la probabilidad de ganar mostrada arriba.${v.partial ? ' Faltan proyecciones de algunos titulares, así que el total es parcial.' : ''}`
        : 'This week’s lineup projections: each side’s players summed over the lineup as set, under this league’s scoring. ' +
          'AF is AllFantasy’s own projection engine; API is the provider’s (Sleeper). ' +
          'Not the same measure as the team-average projection and win probability above.' +
          (v.partial ? ' Some starters have no projection, so a total is partial.' : '')}
    >
      <span className="af-wk-lineup-k">{copy('Lineup proj')}</span>
      {v.af ? (
        <>
          {' · '}
          <b className="af-wk-lineup-af">AF {lineupPairText(v.af, v.unpaired)}</b>
        </>
      ) : null}
      {v.api ? <>{` · API ${lineupPairText(v.api, v.unpaired)}`}</> : null}
      {v.partial ? <span className="af-wk-lineup-partial"> · {copy('partial')}</span> : null}
    </span>
  )
}
