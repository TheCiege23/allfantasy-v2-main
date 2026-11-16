import 'server-only'
const headers = { 'User-Agent': 'Mozilla/5.0', Origin: 'https://www.nba.com', Referer: 'https://www.nba.com/' }
async function json(url: string) {
  const response = await fetch(url, { headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw Error('OFFICIAL_NBA_HTTP_' + response.status)
  const body = await response.text()
  if (body.length > 16000000) throw Error('OFFICIAL_NBA_RESPONSE_TOO_LARGE')
  try { return JSON.parse(body) as unknown } catch { throw Error('OFFICIAL_NBA_INVALID_JSON') }
}
/** Official NBA schedule and live box feeds; no manager request path performs this I/O. */
export const fetchOfficialNbaSchedule = () => json('https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json')
export function fetchOfficialNbaLiveBox(gameId: string) {
  if (!/^002\d{7}$/.test(gameId)) throw Error('OFFICIAL_NBA_INVALID_GAME_ID')
  return json('https://cdn.nba.com/static/json/liveData/boxscore/boxscore_' + gameId + '.json')
}
