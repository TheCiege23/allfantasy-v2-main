import type { SeasonBlueprint } from '@/lib/tournament/seasonBlueprint'
import { buildSeasonLeagueLayout } from '@/lib/tournament/seasonLeagueLayout'
import { SEASON_DRAFT_DEADLINE_POLICY } from '@/lib/tournament/seasonRules'

export function SeasonDraftScheduleRows({ config, format }: { config: SeasonBlueprint; format: (date: string) => string }) {
  const calendar = config.rules?.calendar
  if (!calendar) return null
  const layout = calendar.draftOverrides?.length ? buildSeasonLeagueLayout(config) : []
  return <>
    {calendar.drafts.filter(row => row.startsAt && row.completeBy).map(row => <li key={'default-' + row.stage}>Stage {row.stage} default draft · {format(row.startsAt)} to {format(row.completeBy)}</li>)}
    {calendar.draftOverrides?.filter(row => row.startsAt && row.completeBy).map(row => {
      const name = row.scope === 'division' ? 'division ' + row.target : layout.find(stage => stage.stage === row.stage)?.leagues.find(pool => pool.key === row.target)?.name ?? row.target
      return <li key={JSON.stringify([row.stage, row.scope, row.target])}>Stage {row.stage} {name} draft · {format(row.startsAt)} to {format(row.completeBy)}</li>
    })}
    <li>Draft windows leave at least {config.redraftBufferHours} hours before the shared scoring lock.</li>
    {calendar.draftOverrides && <li>{SEASON_DRAFT_DEADLINE_POLICY}</li>}
  </>
}
