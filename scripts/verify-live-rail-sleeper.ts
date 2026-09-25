import { parseLiveMatchups, summarizeLiveScores } from '../lib/core-app/liveRailScores'

async function read(path: string) {
  const response = await fetch(`https://api.sleeper.app/v1/${path}`, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`Sleeper returned ${response.status}`)
  return response.json()
}

async function main() {
  const state = await read('state/nfl')
  const user = await read('user/theciege24')
  if (!user?.user_id || state.season_type !== 'regular') throw new Error('Current user/week unavailable')
  const leagues = await read(`user/${user.user_id}/leagues/nfl/${state.season}`)
  // Public, read-only examples from the user's approved Sleeper account.
  const chosen = [...leagues].sort((a, b) => Number(/chopped|guillotine/i.test(b.name)) - Number(/chopped|guillotine/i.test(a.name))).slice(0, 6)
  const results = []
  for (const league of chosen) {
    const rosters = await read(`league/${league.league_id}/rosters`)
    const mine = rosters.find((roster: { owner_id: string }) => roster.owner_id === user.user_id)
    if (!mine) continue
    const rows = parseLiveMatchups(await read(`league/${league.league_id}/matchups/${state.week}`))
    if (!rows) continue
    results.push({ name: league.name, leagueId: league.league_id, ...summarizeLiveScores(rows, String(mine.roster_id)) })
  }
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), season: state.season, week: state.week, results }, null, 2))
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
