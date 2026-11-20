/**
 * A team's colour for the Round 1 pick card's colour sweep (2026-11-19). NFL clubs use their
 * primary colour; any other team code gets a stable colour picked from a small palette, so the
 * same team always sweeps the same colour and the card never falls back to grey.
 */
const NFL_PRIMARY: Record<string, string> = {
  ARI: '#97233F', ATL: '#A71930', BAL: '#241773', BUF: '#00338D', CAR: '#0085CA', CHI: '#0B162A',
  CIN: '#FB4F14', CLE: '#FF3C00', DAL: '#003594', DEN: '#FB4F14', DET: '#0076B6', GB: '#203731',
  HOU: '#03202F', IND: '#002C5F', JAX: '#006778', KC: '#E31837', LAC: '#0080C6', LAR: '#003594',
  LV: '#A5ACAF', MIA: '#008E97', MIN: '#4F2683', NE: '#002244', NO: '#D3BC8D', NYG: '#0B2265',
  NYJ: '#125740', PHI: '#004C54', PIT: '#FFB612', SEA: '#69BE28', SF: '#AA0000', TB: '#D50A0A',
  TEN: '#4B92DB', WAS: '#773141',
}

/** Old and alternate codes a feed may still send. */
const ALIASES: Record<string, string> = { JAC: 'JAX', WSH: 'WAS', OAK: 'LV', SD: 'LAC', STL: 'LAR', LA: 'LAR' }

const FALLBACK = ['#22d3ee', '#a78bfa', '#34d399', '#f59e0b', '#f472b6', '#60a5fa', '#f87171', '#facc15']

export function teamAccentColor(team: string | null | undefined, sport?: string | null): string {
  const code = String(team ?? '').trim().toUpperCase()
  const isNfl = !sport || String(sport).toUpperCase() === 'NFL'
  if (isNfl && code) {
    const nfl = NFL_PRIMARY[ALIASES[code] ?? code]
    if (nfl) return nfl
  }
  if (!code) return FALLBACK[0]!
  let h = 0
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return FALLBACK[h % FALLBACK.length]!
}
