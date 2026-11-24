import 'server-only'
const headers = {
  'User-Agent': 'Mozilla/5.0',
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://www.nba.com',
  Referer: 'https://www.nba.com/',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
}
async function json(url: string) {
  const response = await fetch(url, { headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw Error('OFFICIAL_NBA_HTTP_' + response.status)
  const body = await response.text()
  if (body.length > 16000000) throw Error('OFFICIAL_NBA_RESPONSE_TOO_LARGE')
  try { return JSON.parse(body) as unknown } catch { throw Error('OFFICIAL_NBA_INVALID_JSON') }
}
/** Official NBA schedule and live box feeds; no manager request path performs this I/O. */
export const fetchOfficialNbaSchedule = () => json('https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json')

function statsTable(endpoint: string, params: Record<string, string>) {
  return json('https://stats.nba.com/stats/' + endpoint + '?' + new URLSearchParams(params))
}

function seasonLabel(season: number) {
  return season + '-' + String(season + 1).slice(-2)
}

export const fetchOfficialNbaRoster = (season: number) =>
  statsTable('commonallplayers', { LeagueID: '00', Season: seasonLabel(season), IsOnlyCurrentSeason: '1' })

export const fetchOfficialNbaGameLog = (season: number) =>
  statsTable('leaguegamelog', { Counter: '0', DateFrom: '', DateTo: '', Direction: 'DESC', LeagueID: '00',
    PlayerOrTeam: 'P', Season: seasonLabel(season), SeasonType: 'Regular Season', Sorter: 'DATE' })

export function fetchOfficialNbaPlayer(playerId: string) {
  if (!/^\d{5,10}$/.test(playerId)) throw Error('OFFICIAL_NBA_INVALID_PLAYER_ID')
  return statsTable('commonplayerinfo', { PlayerID: playerId })
}
export function fetchOfficialNbaLiveBox(gameId: string) {
  if (!/^002\d{7}$/.test(gameId)) throw Error('OFFICIAL_NBA_INVALID_GAME_ID')
  return json('https://cdn.nba.com/static/json/liveData/boxscore/boxscore_' + gameId + '.json')
}
