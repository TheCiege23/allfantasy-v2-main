import 'server-only'
import type { ChimmyLeagueSnapshot } from './chimmy-league-snapshot'
import type { ReadyTradeScenario } from './tradeScenarioTypes'
import { tradeSeasonEstimate } from './tradeSeasonEstimate'

/** Called only after shared decision membership verification; one bounded read for all offers. */
export function tradeSeasonOutlook(snapshot: ChimmyLeagueSnapshot, userId: string) {
  let pending: Promise<import('@/lib/core-app/seasonOutlook').OutlookLeague | null> | undefined
  return async (scenario: ReadyTradeScenario): Promise<ReadyTradeScenario> => {
    const no = (reason: string) => ({ ...scenario, playoffOdds: { available: false as const, reason } })
    if (snapshot.sport !== 'NFL') return no('Trade season estimates currently require NFL league data.')
    if (!snapshot.lastSyncedAt || Date.now() - new Date(snapshot.lastSyncedAt).getTime() > 30 * 60_000) return no('League data is stale or its sync time is unknown. Sync before computing trade playoff effects.')
    if (!scenario.lineup || !scenario.value.grade || scenario.unpricedExcluded) return scenario
    try {
      pending ??= (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          return await Promise.race([
            import('@/lib/core-app/seasonOutlook').then(({ getSeasonOutlook }) => getSeasonOutlook(userId, [snapshot], snapshot.id)).then(o => o.leagues.find(l => l.leagueId === snapshot.id) ?? null),
            new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 10_000) }),
          ])
        } finally { if (timer) clearTimeout(timer) }
      })()
      const outlook = await pending
      if (!outlook?.focus || outlook.assumptions.playoffTeams.source !== 'league' || outlook.assumptions.byes.source === 'default' || !outlook.assumptions.regularSeasonEndWeek)
        return no('Verified playoff format, scoring history, schedule and roster projections are not all available.')
      const model = outlook.focus.scenario
      if (model.leagueId !== snapshot.id || model.basisWeek?.season !== String(snapshot.season) || outlook.you?.rosterId !== model.youRosterId)
        return no('The season model does not match this league, season and viewer roster.')
      const playerAges = (['give', 'get'] as const).flatMap(side => scenario[side].flatMap(asset => {
        const matches = model.teams.flatMap(t => t.players).filter(p => p.id === asset.playerId)
        const age = matches.length === 1 ? matches[0].age : null
        return age != null && Number.isFinite(age) && age >= 18 && age <= 60 ? [{ name: asset.name, age, side }] : []
      }))
      return { ...scenario, playerAges, playoffOdds: tradeSeasonEstimate(scenario, model, outlook.assumptions.computedAt) }
    } catch { return no('The season model could not be loaded. No post-trade playoff probability was computed.') }
  }
}
