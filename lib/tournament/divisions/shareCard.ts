/**
 * Share card content for any finisher, drawn from the hub view (never from a
 * pre-made image). Champions get CHAMPION; everyone else gets the headline for how
 * far they went.
 */
import type { HubGame, HubView } from './hubView'
import { leagueDisplayName } from './identity'

export const SHARE_SIZES = {
  post: { label: 'Post 4:5', width: 1080, height: 1350, use: 'feeds' },
  story: { label: 'Story 9:16', width: 1080, height: 1920, use: 'stories and status' },
  square: { label: 'Square', width: 1080, height: 1080, use: 'chats and profile posts' },
} as const
export type ShareSize = keyof typeof SHARE_SIZES

export type PathRow = { label: string; opponent: string; score: string; won: boolean | null }

export type ShareCard = {
  headline: string
  champion: boolean
  team: string
  divisionIndex: 0 | 1
  conferenceIndex: number
  subtitle: string
  stats: Array<{ value: string; label: string }>
  path: PathRow[]
  eyebrow: string
}

const fmt = (n: number | null) => (n === null ? '—' : n.toFixed(1))

export function buildShareCard(view: HubView, teamId: string): ShareCard | null {
  const found = view.divisions.findIndex(d => d.rows.some(r => r.id === teamId))
  if (found < 0) return null
  const divisionIndex = found as 0 | 1
  const division = view.divisions[divisionIndex]
  const row = division.rows.find(r => r.id === teamId)!
  const conf = view.identity.conferences[row.conferenceIndex]
  const league = conf ? leagueDisplayName(conf.name, division.name) : division.name

  const path: PathRow[] = []
  const acc: { wins: number; losses: number; lastScore: number | null; seed: number | null; region: string | null } = { wins: 0, losses: 0, lastScore: null, seed: null, region: null }
  const add = (g: HubGame | undefined, label: string, opponentLabel: (o: NonNullable<HubGame['a']>) => string) => {
    if (!g || !(g.a?.id === teamId || g.b?.id === teamId)) return false
    const mine = g.a?.id === teamId ? 'a' : 'b'
    const me = mine === 'a' ? g.a! : g.b!
    const opp = mine === 'a' ? g.b : g.a
    acc.seed = me.seedLine; acc.region = me.region
    const ms = mine === 'a' ? g.scoreA : g.scoreB, os = mine === 'a' ? g.scoreB : g.scoreA
    const won = g.winnerId ? g.winnerId === teamId : null
    if (won === true) acc.wins++
    if (won === false) acc.losses++
    if (ms !== null) acc.lastScore = ms
    path.push({ label, opponent: opp ? opponentLabel(opp) : 'TBD', score: ms !== null && os !== null ? `${fmt(ms)}-${fmt(os)}` : '', won })
    return true
  }
  const weeks = view.calendar.weeks
  for (const regionName of Object.keys(division.regions) as Array<keyof typeof division.regions>) {
    const rounds = division.regions[regionName] ?? []
    rounds.forEach((games, ri) => {
      const g = games.find(x => x.a?.id === teamId || x.b?.id === teamId)
      const label = weeks[ri]?.label === 'Region finals' ? `${regionName} final` : (weeks[ri]?.label ?? `Round ${ri + 1}`)
      add(g, label, o => `${o.seedLine} · ${o.name}`)
    })
  }
  division.finals.forEach((games, fi) => {
    const g = games.find(x => x.a?.id === teamId || x.b?.id === teamId)
    add(g, fi === division.finals.length - 1 ? `${division.name} final` : 'Final four', o => `${o.region} · ${o.name}`)
  })
  const champ = view.championship
  add(champ ?? undefined, 'Championship', () => view.divisions[divisionIndex === 0 ? 1 : 0].name + ' · ' + ((champ?.a?.id === teamId ? champ?.b?.name : champ?.a?.name) ?? 'TBD'))

  const isChampion = Boolean(champ?.winnerId && champ.winnerId === teamId)
  const divisionChampion = division.champion?.id === teamId
  const finalFour = division.finals[0]?.some(g => g.a?.id === teamId || g.b?.id === teamId)
  const madeBracket = path.length > 0
  const headline = isChampion ? 'CHAMPION' : divisionChampion ? 'Division champion' : finalFour ? 'Final four' : madeBracket ? 'Made the bracket' : 'Regular season'
  const record = `${row.wins}-${row.losses}${row.ties ? '-' + row.ties : ''}`
  return {
    headline, champion: isChampion, team: row.name, divisionIndex, conferenceIndex: row.conferenceIndex,
    eyebrow: `${view.identity.divisions[0].name} vs ${view.identity.divisions[1].name}${view.tournament.season ? ' ' + view.tournament.season : ''}`,
    subtitle: [league, acc.seed ? `${acc.seed} seed` : `#${row.rank} in ${division.name}`, acc.region ? `${acc.region} region` : null].filter(Boolean).join(' · '),
    stats: [
      { value: fmt(acc.lastScore ?? row.points), label: acc.lastScore !== null ? (isChampion ? 'Title score' : 'Last score') : 'Season points' },
      { value: record, label: 'Season' },
      { value: madeBracket ? `${acc.wins}-${acc.losses}` : '—', label: 'Bracket' },
    ],
    path,
  }
}
