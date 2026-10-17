/** Sport-qualified ids prevent ESPN football/baseball league collisions. */
export function isEspnMlbSource(input: string): boolean {
  const s = input.trim()
  if (/^(?:\d{4}:)?MLB:/i.test(s)) return true
  try {
    const url = new URL(s)
    return (url.hostname === 'fantasy.espn.com' || url.hostname === 'lm-api-reads.fantasy.espn.com') &&
      (/^\/baseball(?:\/|$)/.test(url.pathname) || url.pathname.includes('/games/flb/'))
  } catch { return false }
}

export function parseEspnMlbSource(input: string): { leagueId: string; season: number } {
  let leagueId = ''; let season = new Date().getFullYear()
  if (input.trim().startsWith('https://')) {
    const u = new URL(input.trim())
    if (!isEspnMlbSource(input)) throw new Error('Use an ESPN baseball league URL.')
    leagueId = u.searchParams.get('leagueId') ?? u.pathname.match(/\/leagues\/(\d+)/)?.[1] ?? ''
    const year = u.searchParams.get('seasonId') ?? u.pathname.match(/\/seasons\/(\d{4})/)?.[1]
    if (year) season = Number(year)
  } else {
    const m = input.trim().match(/^(?:(\d{4}):)?MLB:(?:(\d{4}):)?(\d+)$/i)
    if (m && !(m[1] && m[2])) { leagueId = m[3]; season = Number(m[1] ?? m[2] ?? season) }
  }
  if (!/^\d+$/.test(leagueId) || !Number.isInteger(season) || season < 2010 || season > 2100)
    throw new Error('Enter an ESPN baseball URL or MLB:2026:123456 league id.')
  return { leagueId, season }
}
