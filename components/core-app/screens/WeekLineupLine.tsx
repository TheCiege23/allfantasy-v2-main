'use client'

import { lineupPairText, lineupProjectionFor, type WeekLineups } from '@/lib/core-app/weekLineups'
import '@/components/core-app/af-week-lineup.css'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { PROJECTION_PROVIDER_LABEL } from '@/lib/core-app/projectionProvider'
import { messagesFor } from '@/lib/i18n/messages'
import { corePartsMessages } from '@/lib/core-app/messages/coreParts'

/**
 * One line of this week's LINEUP projections under a Your Week matchup: "Lineup proj · AF
 * 121.5–115.0 · Sleeper 118.2–112.4" (it read "API" until 2026-10-03). Renders nothing when neither source priced the matchup for its own
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
  plain = false,
}: {
  lineups: WeekLineups | null | undefined
  leagueId: string
  season: number
  week: number
  /**
   * 2026-11-14, Your week (one league): "Projected: 184.7–233.3" — one source, AF's when it has one. Two
   * projections side by side ("AF 184.7–233.3 · Sleeper 186.8–231.8") read as a puzzle; the second is in
   * the tooltip. The other screens keep both.
   */
  plain?: boolean
}) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  const v = lineupProjectionFor(lineups, leagueId, season, week)
  if (!v) return null
  const parts = messagesFor(corePartsMessages, language)
  if (plain) {
    const shown = v.af ?? v.api
    if (!shown) return null
    const both = [v.af ? `AF ${lineupPairText(v.af, v.unpaired)}` : null, v.api ? `${PROJECTION_PROVIDER_LABEL} ${lineupPairText(v.api, v.unpaired)}` : null]
      .filter(Boolean)
      .join(' · ')
    return (
      <span className="af-wk-lineup af-num" data-testid="week-lineup-plain" title={`${parts.lineupProjectionTitle(PROJECTION_PROVIDER_LABEL, v.partial)} ${both}`}>
        <span className="af-wk-lineup-k">{parts.lineupPlainLabel}:</span> {lineupPairText(shown, v.unpaired)}
        {v.partial ? <span className="af-wk-lineup-partial"> · {copy('partial')}</span> : null}
      </span>
    )
  }
  return (
    <span
      className="af-wk-lineup af-num"
      title={messagesFor(corePartsMessages, language).lineupProjectionTitle(PROJECTION_PROVIDER_LABEL, v.partial)}
    >
      <span className="af-wk-lineup-k">{copy('Lineup proj')}</span>
      {v.af ? (
        <>
          {' · '}
          <b className="af-wk-lineup-af">AF {lineupPairText(v.af, v.unpaired)}</b>
        </>
      ) : null}
      {v.api ? <>{` · ${PROJECTION_PROVIDER_LABEL} ${lineupPairText(v.api, v.unpaired)}`}</> : null}
      {v.partial ? <span className="af-wk-lineup-partial"> · {copy('partial')}</span> : null}
    </span>
  )
}
