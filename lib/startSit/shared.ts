/**
 * Start/Sit popup — shared demo generators + sport key mapping.
 * (Original brief referenced `shared.js`; this repo uses TypeScript under `lib/`.)
 */

export const DEMO_SOURCE_LABEL =
  'Rolling Insights → API-Sports → ClearSports → TheSportsDB → Sleeper (demo fallback)'

const SPORT_ENUM_TO_KEY: Record<string, string> = {
  NFL: 'nfl',
  NBA: 'nba',
  MLB: 'mlb',
  NHL: 'nhl',
  SOCCER: 'soccer',
  NCAAF: 'cfb',
  NCAAB: 'cbb',
}

/** Map Prisma `LeagueSport` to popup API keys. */
export function prismaSportToUiKey(sport: string): string {
  return SPORT_ENUM_TO_KEY[sport] || 'nfl'
}

/** Map UI sport key to internal normalized sport for data layer. */
export function uiKeyToDataSport(key: string): string {
  const m: Record<string, string> = {
    nfl: 'NFL',
    nba: 'NBA',
    mlb: 'MLB',
    nhl: 'NHL',
    soccer: 'SOCCER',
    cfb: 'NCAAF',
    cbb: 'NCAAB',
    all: 'NFL',
  }
  return m[key] || 'NFL'
}

function hashSeed(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i += 1) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

const NFL_NAMES: [string, string, string][] = [
  ['Josh Allen', 'QB', 'BUF'],
  ['Saquon Barkley', 'RB', 'PHI'],
  ["Ja'Marr Chase", 'WR', 'CIN'],
  ['Travis Kelce', 'TE', 'KC'],
  ['Bijan Robinson', 'RB', 'ATL'],
  ['CeeDee Lamb', 'WR', 'DAL'],
  ['Amon-Ra St. Brown', 'WR', 'DET'],
  ['Lamar Jackson', 'QB', 'BAL'],
]

export function createDemoRoster(sportKey: string, leagueLabel: string, week: string) {
  const sk = sportKey === 'all' ? 'nfl' : sportKey
  const base = hashSeed(`${sk}:${leagueLabel}:${week}`)
  const pool = sk === 'nfl' ? NFL_NAMES : NFL_NAMES.map((r, i) => [`Player ${i + 1}`, r[1], r[2]] as [string, string, string])
  const n = Math.min(8, pool.length)
  return Array.from({ length: n }, (_, i) => {
    const [name, pos, team] = pool[i % pool.length]!
    const jitter = ((base + i * 17) % 40) / 10
    const projected = Math.round(8 + jitter + (i % 3) * 2)
    const floor = Math.max(3, Math.round(projected - 4 - (i % 2)))
    const ceiling = Math.min(45, Math.round(projected + 12 + (i % 4)))
    const confidence = Math.min(95, 52 + ((base + i) % 40))
    const trends = ['up', 'down', 'flat'] as const
    const status = i === 1 && sk === 'nfl' ? 'Questionable' : 'Active'
    return {
      id: `demo-${sk}-${i}-${base}`,
      name: `${name}`,
      position: pos,
      team,
      opponent: ['@ NYJ', 'vs MIA', '@ KC', 'vs LAC'][i % 4],
      projected,
      floor,
      ceiling,
      confidence,
      trend: trends[(base + i) % 3],
      status,
      note:
        i === 0
          ? 'Strong matchup — opposing defense ranks bottom third vs position.'
          : 'Check inactive report 90 minutes before kickoff.',
      matchupRank: 3 + ((base + i) % 28),
    }
  })
}

export function createDemoWeather(_sportKey: string) {
  return [
    {
      game: 'BUF @ MIA',
      venue: 'Outdoor / dome check',
      icon: '⛅',
      temp: '62°F',
      wind: '12 mph',
      impact: 'Moderate',
      impactColor: '#f5a623',
    },
  ]
}

export function createDemoMatchups(_sportKey: string) {
  return ['QB', 'RB', 'WR', 'TE'].map((position, i) => ({
    position,
    opponent: ['ARI', 'DAL', 'KC', 'SF'][i % 4],
    score: 45 + ((i * 13) % 45),
    rankLabel: ['Tough', 'Neutral', 'Plus', 'Smash'][i % 4],
  }))
}

export function createDemoChimmyReply(userMessage: string) {
  const m = (userMessage || '').toLowerCase()
  if (m.includes('injury')) {
    return 'From the injury feed: prioritize players listed Active; treat Questionable as game-time calls and have a bench pivot ready.'
  }
  if (m.includes('ceiling') || m.includes('upside')) {
    return 'Upside lens: lean into ceiling projections when you need a swing — pair one volatile WR/RB with safer floor plays elsewhere.'
  }
  return `I'm on demo mode (set OPENAI_API_KEY for live AI). You asked: "${(userMessage || '').slice(0, 200)}". Use the roster cards for START/FLEX/SIT — they mirror the ${DEMO_SOURCE_LABEL} cascade when APIs are wired.`
}
