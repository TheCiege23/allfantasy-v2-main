'use client'

import { useState } from 'react'
import { roadToGloryLeagues, type RoadToGloryLeague } from '@/lib/league-import/fantrax/roadToGloryLeagues'
import { CommissionerLeagueResults } from './CommissionerLeagueResults'

export function CommissionerRoadToGloryResults({ leagueId, source }: { leagueId: string; source?: RoadToGloryLeague }) {
  const [selected, setSelected] = useState<string>(roadToGloryLeagues[0].key)
  const league = source ?? roadToGloryLeagues.find(entry => entry.key === selected) ?? roadToGloryLeagues[0]

  return (
    <div className="space-y-3">
      {!source && (
        <label className="inline-flex flex-wrap items-center gap-2 text-sm">
          Fantrax league
          <select className="afh-btn" value={selected} onChange={event => setSelected(event.target.value)}>
            {roadToGloryLeagues.map(entry => <option key={entry.key} value={entry.key}>{entry.title}</option>)}
          </select>
        </label>
      )}
      <CommissionerLeagueResults
        key={league.key}
        endpoint={`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/road-to-glory/${league.key}`}
        title={league.title}
        provider="Fantrax"
        sourceUrl={`https://www.fantrax.com/fantasy/league/${league.sourceId}/home`}
      />
    </div>
  )
}
